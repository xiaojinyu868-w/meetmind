/**
 * Octo Buddy — 参数化宠物渲染器（v3.1 人格回归版）
 *
 * 原则（向 shimeji 学的）：生命感 = 离散动作 × 丰富表情 × 克制的频率，
 * 不是持续的物理抖动。
 *   - 物理全部近临界阻尼：一下就是一下，绝不来回晃（v3 果冻发晕的教训）
 *   - 表情是主角：7 张精灵都有戏（开心/喜欢/惊讶/思考/睡着/兴奋）
 *   - 小动作离散且稀少：每 18–30s 才做一个（peek/wiggle/hop），做完就安静
 *   - 生物钟：40s 想你了 → 80s 犯困 → 140s 睡着；被点会醒
 *   - 呼吸/眨眼/眼随/涟漪/阴影：v3 的底子全部保留，只做更轻
 */

const SPRITE_KEYS = ['idle', 'happy', 'excited', 'thinking', 'surprised', 'love', 'sleeping'];
const SPRITE_DIR = './assets/octo/';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const speechEl = document.getElementById('speech');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** 一维弹簧。stiffness/damping 取近临界：快速收敛、几乎无过冲 */
function makeSpring(stiffness = 0.2, damping = 0.84) {
  let x = 0;
  let v = 0;
  let target = 0;
  return {
    set(t) { target = t; },
    snap(t) { x = t; v = 0; target = t; },
    kick(impulse) { v += impulse; },
    step() {
      v = (v + (target - x) * stiffness) * damping;
      x += v;
      return x;
    },
    get value() { return x; },
  };
}

/* ---------- 资源 ---------- */
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
  sprite: 'idle',
  prevSprite: null,
  fade: 1,
  listening: false,
  listeningSince: 0,
  asleep: false,
  lastInteraction: Date.now(),
  clickIntensity: 0,
  busy: false, // 正在做小动作/反应，不叠加
};

const lean = makeSpring(0.14, 0.78);   // 眼随倾身（慢半拍才像活的）
const leanY = makeSpring(0.16, 0.8);
const tilt = makeSpring(0.14, 0.78);
const squashX = makeSpring(0.24, 0.86); // 果冻：近临界，一下收敛
const squashY = makeSpring(0.24, 0.86);
const dim = makeSpring(0.05, 0.85);
squashX.snap(1);
squashY.snap(1);

let blinkAt = Date.now() + rand(2600, 5200);
let blinkStart = -1;
const BLINK_MS = 140;

const ripples = [];
let lastRippleAt = 0;

/* ---------- 说话 ---------- */
let speechTimer = null;
function say(line, duration = 1700) {
  speechEl.textContent = line;
  speechEl.dataset.visible = 'true';
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => { speechEl.dataset.visible = 'false'; }, duration);
}

let listenSpeechTimer = null;
function updateListenSpeech() {
  if (!pet.listening) return;
  const totalSec = Math.floor((Date.now() - pet.listeningSince) / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  speechEl.textContent = `旁听中 ${mm}:${ss}`;
  speechEl.dataset.visible = 'true';
}

/* ---------- 表情（交叉淡化） ---------- */
function setSprite(next) {
  if (pet.sprite === next) return;
  pet.prevSprite = pet.sprite;
  pet.sprite = next;
  pet.fade = 0;
}

/** 临时表情：show 一会儿，然后回 idle（或睡觉/听讲态） */
let moodResetTimer = null;
function showMood(sprite, ms = 2200) {
  setSprite(sprite);
  clearTimeout(moodResetTimer);
  moodResetTimer = setTimeout(() => {
    if (pet.asleep) setSprite('sleeping');
    else setSprite('idle');
  }, ms);
}

/* ---------- 离散小动作（每 18–30s 一个，做完就安静） ---------- */
let motionUntil = 0;
let motionKind = null;

function doPeek() {
  motionKind = 'peek';
  const side = Math.random() > 0.5 ? 1 : -1;
  lean.set(side * 2.6);
  tilt.set(side * 0.03);
  motionUntil = performance.now() + 900;
}

function doWiggle() {
  motionKind = 'wiggle';
  motionUntil = performance.now() + 720;
}

function doHop() {
  motionKind = 'hop';
  leanY.kick(-2.4);
  motionUntil = performance.now() + 320;
}

function scheduleAmbient() {
  const every = rand(18000, 30000);
  setTimeout(() => {
    scheduleAmbient();
    if (pet.busy || pet.listening || pet.asleep || dragState) return;
    if (document.hidden) return;
    const pick = Math.random();
    if (pick < 0.45) doPeek();
    else if (pick < 0.8) doWiggle();
    else doHop();
  }, every);
}

/* ---------- 生物钟 ---------- */
setInterval(() => {
  if (pet.listening || dragState) return;
  const idleFor = Date.now() - pet.lastInteraction;
  if (idleFor > 140000) {
    if (!pet.asleep) {
      pet.asleep = true;
      setSprite('sleeping');
    }
  } else if (idleFor > 80000) {
    if (!pet.asleep && pet.sprite === 'idle') setSprite('thinking');
  } else if (idleFor > 40000) {
    if (!pet.asleep && pet.sprite === 'idle') showMood('love', 3000);
  }
}, 4000);

function touch() {
  pet.lastInteraction = Date.now();
  if (pet.asleep) {
    pet.asleep = false;
    showMood('surprised', 1400);
    say('醒啦', 1200);
  }
}

/* ---------- 布局与绘制 ---------- */
const CANONICAL_W = 122;
let dpr = 1;

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawSprite(key, alpha, baseX, baseY) {
  const img = images[key];
  const map = spriteMap?.[key];
  if (!img || !map) return;
  const k = CANONICAL_W / map.width;
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

function drawRipples(now, cx, cy) {
  if (!pet.listening) { ripples.length = 0; return; }
  if (now - lastRippleAt > 1600) {
    ripples.push({ born: now });
    lastRippleAt = now;
  }
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    const age = (now - ripples[i].born) / 2400;
    if (age >= 1) { ripples.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 34 + age * 46, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(139, 92, 246, ${(0.34 * (1 - age)).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  const inner = (Math.sin(now / 600) + 1) / 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 30, 20, 0, Math.PI * 2);
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

  const night = new Date().getHours() >= 23 || new Date().getHours() < 7;
  dim.set(pet.asleep ? 0.4 : night ? 0.2 : 0);

  // 呼吸：很轻，睡着更深更慢
  const breatheAmp = pet.asleep ? 0.008 : pet.listening ? 0.016 : 0.011;
  const breatheRate = pet.asleep ? 3.0 : 2.1;
  const breathe = Math.sin((t * Math.PI * 2) / breatheRate);

  // 小动作的 tilt 波形
  if (motionKind === 'wiggle' && now < motionUntil) {
    tilt.set(Math.sin(now / 46) * 0.022);
  }
  if (motionKind && now >= motionUntil) {
    if (motionKind === 'peek') { lean.set(0); tilt.set(0); }
    if (motionKind === 'wiggle') tilt.set(0);
    if (motionKind === 'hop') squashY.kick(0.05);
    motionKind = null;
  }

  const lx = lean.step();
  const ly = leanY.step();
  const rot = tilt.step();
  const sx = squashX.step();
  const sy = squashY.step();
  const dimV = clamp(dim.step(), 0, 1);

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const baseX = W / 2 + lx;
  const baseY = H - 16 + ly + breathe * breatheAmp * 22;

  const shadowScale = clamp(1 - (sy - 1) * 1.8, 0.8, 1.2);
  ctx.beginPath();
  ctx.ellipse(baseX - lx * 0.5, H - 13, 36 * shadowScale, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(23, 23, 19, ${(0.17 * (1 - dimV * 0.55)).toFixed(3)})`;
  ctx.fill();

  ctx.translate(baseX, baseY);
  ctx.rotate(rot);
  ctx.scale(sx * (1 + breathe * breatheAmp * 0.45), sy * (1 - breathe * breatheAmp));
  ctx.translate(-baseX, -baseY);

  if (pet.fade < 1) pet.fade = clamp(pet.fade + 0.055, 0, 1);
  if (pet.prevSprite && pet.fade < 1) drawSprite(pet.prevSprite, 1 - pet.fade, baseX, baseY);
  const layout = drawSprite(pet.sprite, pet.prevSprite ? pet.fade : 1, baseX, baseY);

  drawBlink(layout);
  drawRipples(now, baseX, baseY);

  if (dimV > 0.01) {
    ctx.fillStyle = `rgba(16, 14, 26, ${(dimV * 0.5).toFixed(3)})`;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();

  if (blinkStart < 0 && Date.now() > blinkAt && !pet.asleep) {
    blinkStart = now;
    blinkAt = Date.now() + rand(2600, 6500);
  }
}

/* ---------- 交互 ---------- */
let dragState = null;
let clickTimer = null;
let intensityTimer = null;

canvas.addEventListener('pointerenter', () => {
  pet.lastInteraction = Date.now(); // hover 只是看你，不算打扰，也不说话
  leanY.kick(-0.5);
  if (pet.listening) {
    updateListenSpeech();
    listenSpeechTimer = setInterval(updateListenSpeech, 5000);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (dragState) return;
  const rect = canvas.getBoundingClientRect();
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  lean.set(clamp(nx * 3.0, -3.0, 3.0));
  leanY.set(clamp(ny * 1.4, -1.4, 1.4));
  tilt.set(clamp(nx * 0.03, -0.03, 0.03));
});

canvas.addEventListener('pointerleave', () => {
  lean.set(0);
  leanY.set(0);
  tilt.set(0);
  if (listenSpeechTimer) {
    clearInterval(listenSpeechTimer);
    listenSpeechTimer = null;
    speechEl.dataset.visible = 'false';
  }
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  touch();
  squashX.set(0.97);
  squashY.set(1.03);
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
  squashX.set(1);
  squashY.set(1);
  if (!moved) handleTap();
}
canvas.addEventListener('pointerup', releaseDrag);
canvas.addEventListener('pointercancel', () => { dragState = null; squashX.set(1); squashY.set(1); });

/** 点击反应（人格核心）：1 下开心、2 下喜欢、3 下惊讶、4+ 假装生气 */
function reactToTap() {
  pet.clickIntensity += 1;
  clearTimeout(intensityTimer);
  intensityTimer = setTimeout(() => { pet.clickIntensity = Math.max(0, pet.clickIntensity - 1); }, 1600);

  if (pet.clickIntensity <= 1) {
    showMood('happy');
    say('我在');
  } else if (pet.clickIntensity === 2) {
    showMood('love');
    say('今天也一起学');
  } else if (pet.clickIntensity === 3) {
    showMood('surprised');
    say('哎？');
  } else {
    showMood('surprised', 2600);
    doWiggle();
    say('别一直戳我', 2200);
    pet.clickIntensity = 0;
  }
}

/** 单击=随手问（小窗）；双击=旁听开关 */
function handleTap() {
  touch();
  squashY.kick(0.05);
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    pet.clickIntensity = 0;
    toggleListening();
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    reactToTap();
    window.meetmindCompanion?.togglePanel();
  }, 300);
}

async function toggleListening() {
  touch();
  const bridge = window.meetmindCompanion;
  if (!bridge?.toggleListen) return;
  try {
    const result = await bridge.toggleListen();
    if (result?.listening) {
      pet.listening = true;
      pet.listeningSince = Date.now();
      setSprite('idle');
      say('我在旁边听', 1600);
    } else {
      if (pet.listening) {
        showMood('happy', 1600);
        say('记下了，去整理', 1800);
      }
      pet.listening = false;
      if (listenSpeechTimer) {
        clearInterval(listenSpeechTimer);
        listenSpeechTimer = null;
      }
      setSprite('idle');
      if (result?.reason === 'not-logged-in') say('先在主窗口登录一下', 2200);
      if (result?.reason === 'hook-missing') say('主窗口还没准备好', 2000);
    }
  } catch {
    say('旁听没起来，再试一次', 1800);
  }
}

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  touch();
  window.meetmindCompanion?.showPetMenu();
});

/* ---------- 拖图片收下 ---------- */
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

/* ---------- 捕获成功的吞食动画 ---------- */
window.meetmindCompanion?.onGulp?.(() => {
  touch();
  setSprite('happy');
  squashX.set(1.05);
  squashY.set(0.94);
  setTimeout(() => { squashX.set(1); squashY.set(1); }, 140);
  say('收下了', 1300);
  setTimeout(() => { if (pet.sprite === 'happy') setSprite('idle'); }, 1300);
});

/* ---------- 启动 ---------- */
loadAssets().then(() => {
  requestAnimationFrame(frame);
  scheduleAmbient();
  setTimeout(() => say('同学在这', 2000), 900);
});
