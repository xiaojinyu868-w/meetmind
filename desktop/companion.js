/**
 * Octo Buddy — 参数化宠物渲染器（v3）
 *
 * 原则：原画 100% 保留（精灵图不重绘），生命感全部来自连续参数：
 *   - 呼吸：绕底边锚点的 scale 振荡（弹簧叠加，不是硬循环）
 *   - 眨眼：sprite-map 给的眼位 + 同色眼皮遮罩，随机间隔 2.6–6.5s
 *   - 眼随：整只身体朝光标微微倾身（±3px + ±2°），弹簧回中
 *   - 果冻：拖拽/落地用 velocity 驱动 squash & stretch
 *   - 状态：sprite 之间 260ms 交叉淡入，绝不硬切
 *   - 听讲：身体周围泛开声波涟漪（loopback 旁听中）
 *   - 睡觉：超时/深夜自动 dim + 慢呼吸，靠近就醒
 */

const SPRITE_KEYS = ['idle', 'happy', 'excited', 'thinking', 'surprised', 'love', 'sleeping'];
const SPRITE_DIR = './assets/octo/';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const speechEl = document.getElementById('speech');

/* ---------- 小工具 ---------- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** 一维弹簧：x 向 target 收敛，返回当前值（每帧调用） */
function makeSpring(stiffness = 0.14, damping = 0.72) {
  let x = 0;
  let v = 0;
  let target = 0;
  return {
    set(t) { target = t; },
    snap(t) { x = v = 0; target = t; x = t; },
    kick(impulse) { v += impulse; },
    get target() { return target; },
    step() {
      v = (v + (target - x) * stiffness) * damping;
      x += v;
      return x;
    },
    get value() { return x; },
  };
}

/* ---------- 资源加载 ---------- */
const images = {};
let spriteMap = null;

async function loadAssets() {
  const [map, ...loaded] = await Promise.all([
    fetch(`${SPRITE_DIR}octo-sprite-map.json`).then((r) => r.json()),
    ...SPRITE_KEYS.map((key) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve([key, img]);
      img.onerror = () => resolve([key, null]);
      img.src = `${SPRITE_DIR}${key}.png`;
    })),
  ]);
  spriteMap = map;
  for (const [key, img] of loaded) images[key] = img;
}

/* ---------- 宠物状态 ---------- */
const pet = {
  sprite: 'idle',       // 当前表情
  prevSprite: null,     // 交叉淡化来源
  fade: 1,              // 淡化进度 0→1
  mode: 'idle',         // idle | listening | thinking | sleeping | celebrate | gulp
  listening: false,
  listeningSince: 0,
  asleep: false,
  lastInteraction: Date.now(),
};

// 弹簧组
const lean = makeSpring(0.12, 0.68);   // 身体朝光标倾身（px）
const leanY = makeSpring(0.12, 0.68);
const tilt = makeSpring(0.10, 0.66);   // 旋转（弧度）
const squashX = makeSpring(0.16, 0.62);
const squashY = makeSpring(0.16, 0.62);
const dim = makeSpring(0.05, 0.85);    // 睡眠/深夜压暗

squashX.snap(1);
squashY.snap(1);

// 眨眼
let blinkAt = Date.now() + rand(2600, 5200);
let blinkStart = -1;
const BLINK_MS = 150;

// 涟漪
const ripples = [];
let lastRippleAt = 0;

/* ---------- 说话 ---------- */
let speechTimer = null;
function say(line, duration = 1800) {
  speechEl.textContent = line;
  speechEl.dataset.visible = 'true';
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => { speechEl.dataset.visible = 'false'; }, duration);
}

/* 旁听时长：悬停时轻声报时（每 5s 刷新，不打扰） */
let listenSpeechTimer = null;
function updateListenSpeech() {
  if (!pet.listening) return;
  const totalSec = Math.floor((Date.now() - pet.listeningSince) / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  speechEl.textContent = `旁听中 ${mm}:${ss}`;
  speechEl.dataset.visible = 'true';
}

/* ---------- 状态切换（交叉淡化） ---------- */
function setSprite(next) {
  if (pet.sprite === next) return;
  pet.prevSprite = pet.sprite;
  pet.sprite = next;
  pet.fade = 0;
}

function setMode(next) {
  pet.mode = next;
  switch (next) {
    case 'idle': setSprite(pet.asleep ? 'sleeping' : 'idle'); break;
    case 'listening': setSprite('idle'); break;
    case 'thinking': setSprite('thinking'); break;
    case 'celebrate': setSprite('excited'); break;
    case 'gulp': setSprite('happy'); break;
    case 'sleeping': setSprite('sleeping'); break;
  }
}

/* ---------- 布局与绘制 ---------- */
const CANONICAL_W = 122; // 统一身体宽度（px），不同尺寸精灵归一
let dpr = 1;

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawSprite(key, alpha, baseX, baseY, scale) {
  const img = images[key];
  const map = spriteMap?.[key];
  if (!img || !map) return;
  const k = (CANONICAL_W * scale) / map.width;
  const w = map.width * k;
  const h = map.height * k;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, baseX - w / 2, baseY - h, w, h);
  ctx.globalAlpha = 1;
  return { k, left: baseX - w / 2, top: baseY - h };
}

function drawBlink(layout) {
  const map = spriteMap?.[pet.sprite];
  if (!map?.eyesOpen || blinkStart < 0 || !layout) return;
  const progress = (performance.now() - blinkStart) / BLINK_MS;
  if (progress >= 1) { blinkStart = -1; return; }
  // 下-上两相：前半闭眼，后半睁开
  const phase = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
  for (const eye of map.eyes) {
    const [r, g, b] = eye.lidColor || [139, 92, 246];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(
      layout.left + (eye.x - 1) * layout.k,
      layout.top + (eye.y - 1) * layout.k,
      (eye.w + 2) * layout.k,
      (eye.h + 1) * layout.k * phase,
    );
  }
}

function drawRipples(now, cx, cy, scale) {
  if (!pet.listening) { ripples.length = 0; return; }
  if (now - lastRippleAt > 1600) {
    ripples.push({ born: now });
    lastRippleAt = now;
  }
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    const age = (now - ripples[i].born) / 2400;
    if (age >= 1) { ripples.splice(i, 1); continue; }
    const radius = (34 + age * 46) * scale;
    const alpha = 0.34 * (1 - age);
    ctx.beginPath();
    ctx.arc(cx, cy - 30 * scale, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(139, 92, 246, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  // 听讲时一层极淡的橙：存在感但不吵
  const inner = (Math.sin(now / 600) + 1) / 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 30 * scale, 20 * scale, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 100, 36, ${(0.08 + inner * 0.08).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/* ---------- 主循环 ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !spriteMap) return;

  const t = now / 1000;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  // 睡眠调度
  const idleFor = Date.now() - pet.lastInteraction;
  const night = new Date().getHours() >= 23 || new Date().getHours() < 7;
  pet.asleep = idleFor > 120000;
  dim.set(pet.asleep ? 0.4 : night ? 0.22 : 0);
  if (pet.asleep && pet.sprite !== 'sleeping') setSprite('sleeping');

  // 呼吸：慢周期，幅度随睡眠加深
  const breatheAmp = pet.asleep ? 0.010 : pet.listening ? 0.020 : 0.015;
  const breatheRate = pet.asleep ? 2.8 : 1.9;
  const breathe = Math.sin((t * Math.PI * 2) / breatheRate);

  const lx = lean.step();
  const ly = leanY.step();
  const rot = tilt.step();
  const sx = squashX.step();
  const sy = squashY.step();
  const dimV = clamp(dim.step(), 0, 1);

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const baseX = W / 2 + lx;
  const baseY = H - 16 + ly + breathe * breatheAmp * 26;

  // 贴地阴影：随挤压反向变化，宠物落地不悬浮
  const shadowScale = clamp(1 - (sy - 1) * 1.8, 0.7, 1.25);
  ctx.beginPath();
  ctx.ellipse(baseX - lx * 0.5, H - 13, 36 * shadowScale, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(23, 23, 19, ${(0.17 * (1 - dimV * 0.55)).toFixed(3)})`;
  ctx.fill();

  ctx.translate(baseX, baseY);
  ctx.rotate(rot);
  ctx.scale(sx * (1 + breathe * breatheAmp * 0.55), sy * (1 - breathe * breatheAmp));
  ctx.translate(-baseX, -baseY);

  // 交叉淡化
  if (pet.fade < 1) pet.fade = clamp(pet.fade + 0.055, 0, 1);
  let layout = null;
  if (pet.prevSprite && pet.fade < 1) drawSprite(pet.prevSprite, 1 - pet.fade, baseX, baseY, 1);
  layout = drawSprite(pet.sprite, pet.prevSprite ? pet.fade : 1, baseX, baseY, 1);

  drawBlink(layout);
  drawRipples(now, baseX, baseY, 1);

  // 睡眠/深夜压暗
  if (dimV > 0.01) {
    ctx.fillStyle = `rgba(16, 14, 26, ${(dimV * 0.5).toFixed(3)})`;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();

  // 眨眼调度
  if (blinkStart < 0 && Date.now() > blinkAt && !pet.asleep) {
    blinkStart = now;
    blinkAt = Date.now() + rand(2600, 6500);
  }
}

/* ---------- 交互 ---------- */
let dragState = null;
let clickTimer = null;

function touch() {
  pet.lastInteraction = Date.now();
  if (pet.asleep) {
    pet.asleep = false;
    setSprite('surprised');
    say('醒啦', 1200);
    setTimeout(() => setSprite(pet.listening ? 'idle' : 'idle'), 1200);
  }
}

canvas.addEventListener('pointerenter', () => {
  touch();
  leanY.kick(-0.6);
  if (pet.listening) {
    updateListenSpeech();
    listenSpeechTimer = setInterval(updateListenSpeech, 5000);
  }
});

canvas.addEventListener('pointerleave', () => {
  if (listenSpeechTimer) {
    clearInterval(listenSpeechTimer);
    listenSpeechTimer = null;
    speechEl.dataset.visible = 'false';
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (dragState) return;
  const rect = canvas.getBoundingClientRect();
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2; // -1..1
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  lean.set(clamp(nx * 3.2, -3.2, 3.2));
  leanY.set(clamp(ny * 1.6, -1.6, 1.6));
  tilt.set(clamp(nx * 0.045, -0.045, 0.045));
});

canvas.addEventListener('pointerleave', () => {
  lean.set(0);
  leanY.set(0);
  tilt.set(0);
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  touch();
  squashX.set(0.9);
  squashY.set(1.1);
  dragState = { pointerId: event.pointerId, lastX: event.screenX, lastY: event.screenY, moved: false };
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const dx = event.screenX - dragState.lastX;
  const dy = event.screenY - dragState.lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    dragState.moved = true;
    window.meetmindCompanion?.moveBy(dx, dy);
    dragState.lastX = event.screenX;
    dragState.lastY = event.screenY;
  }
});

function releaseDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  canvas.releasePointerCapture(event.pointerId);
  const moved = dragState.moved;
  dragState = null;
  // 果冻回弹
  squashX.set(1);
  squashY.set(1);
  squashX.kick(0.24);
  squashY.kick(-0.2);
  if (!moved) handleTap();
}
canvas.addEventListener('pointerup', releaseDrag);
canvas.addEventListener('pointercancel', () => { dragState = null; squashX.set(1); squashY.set(1); });

/** 单击=随手问（小窗）；双击=旁听开关 */
function handleTap() {
  touch();
  squashY.kick(0.3);
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    toggleListening();
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    setSprite('happy');
    setTimeout(() => { if (pet.sprite === 'happy') setSprite('idle'); }, 1400);
    window.meetmindCompanion?.togglePanel();
  }, 280);
}

/** 旁听开关：IPC 到主进程 → 驱动隐藏主窗口里的网页 Recorder */
async function toggleListening() {
  touch();
  const bridge = window.meetmindCompanion;
  if (!bridge?.toggleListen) return;
  try {
    const result = await bridge.toggleListen();
    if (result?.listening) {
      pet.listening = true;
      pet.listeningSince = Date.now();
      setMode('listening');
      say('我在旁边听', 1600);
    } else {
      if (pet.listening) say('记下了，去整理', 1800);
      pet.listening = false;
      if (listenSpeechTimer) {
        clearInterval(listenSpeechTimer);
        listenSpeechTimer = null;
      }
      setMode('idle');
      if (result?.reason === 'not-logged-in') say('先在主窗口登录一下', 2200);
      if (result?.reason === 'hook-missing') say('主窗口还没准备好', 2000);
    }
  } catch {
    say('旁听没起来，再试一次', 1800);
  }
}

/** 右键：最小菜单（打开主窗口 / 退出） */
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  touch();
  window.meetmindCompanion?.showPetMenu();
});

/** 拖文件到宠物身上 = 收下（当前只收图片） */
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', async (event) => {
  event.preventDefault();
  touch();
  const files = Array.from(event.dataTransfer?.files || []);
  const imagesOnly = files.filter((f) => f.type.startsWith('image/')).slice(0, 5);
  if (imagesOnly.length === 0) {
    say('我还只会收图片', 1800);
    return;
  }
  squashY.set(0.88);
  setTimeout(() => squashY.set(1), 180);
  say('张嘴接住…', 1200);
  try {
    const payload = await Promise.all(imagesOnly.map(async (file) => ({
      name: file.name,
      type: file.type,
      dataBase64: await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
    })));
    const result = await window.meetmindCompanion?.dropFiles?.(payload);
    if (result?.ok) {
      // 吞食动画由主进程 pet:gulp 触发，这里只兜底没桥接时的反馈
      say(`收下了 ${result.uploaded} 张`, 1600);
    } else if (result?.reason === 'not-logged-in') {
      say('先在主窗口登录一下', 2200);
    } else {
      say('没收进去，再试一次', 1800);
    }
  } catch {
    say('没收进去，再试一次', 1800);
  }
});

/** 捕获成功（截图/收下）→ 吞食动画 */
window.meetmindCompanion?.onGulp?.(() => {
  touch();
  setMode('gulp');
  squashY.set(0.78);
  squashX.set(1.14);
  setTimeout(() => { squashX.set(1); squashY.set(1); squashX.kick(-0.18); squashY.kick(0.22); }, 160);
  say('收下了', 1300);
  setTimeout(() => setMode(pet.listening ? 'listening' : 'idle'), 1300);
});

/* ---------- 启动 ---------- */
loadAssets().then(() => {
  requestAnimationFrame(frame);
  setTimeout(() => say('同学在这', 2000), 900);
});
