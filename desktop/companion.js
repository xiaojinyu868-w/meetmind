/**
 * Octo Buddy — 全参数化矢量宠物（v4）
 *
 * 不再有贴图：角色由 canvas 矢量绘制（squircle 方块头 / 双眼 / 微笑 / 四只触手），
 * 所有状态都是同一组几何参数的 lerp——没有"换图"这个概念，自然没有瞬变。
 *
 * 参数模型（全部连续插值）：
 *   eyeOpenL/R  眼皮（0 闭 1 开，眨眼是 1→0→1 的快速往返）
 *   eyeLook     瞳孔偏移（跟随光标，这才是"它在看你"）
 *   eyeCurve    眼形（0 圆眼 1 弯月笑眼）
 *   mouthOpen   嘴的开合（0 微笑 1 张开）
 *   mouthCurve  嘴角弧度（正=笑 负=惊讶 o 嘴）
 *   squashX/Y   身体挤压（果冻，近临界阻尼）
 *   dim         睡眠/深夜压暗
 *   触手        各自相位差轻摆（永不整齐划一）
 *
 * 安静是底线：呼吸幅度 0.4%、小动作 45–90s 一次、只有眨眼和眼随常在。
 */

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const speechEl = document.getElementById('speech');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- 连续参数（每帧向目标收敛） ---------- */
const P = {
  eyeOpenL: 1, eyeOpenR: 1,
  eyeLookX: 0, eyeLookY: 0,
  eyeCurve: 0,          // 0 圆眼 → 1 弯月
  mouthOpen: 0,         // 0 闭合微笑 → 1 张开
  mouthCurve: 1,        // 1 笑 0 平 -1 惊讶
  blush: 0,
  squashX: 1, squashY: 1,
  dim: 0,
  breathePhase: 0,
};
const T = { ...P }; // 目标值
const SPEED = {
  eyeOpen: 0.35, eyeLook: 0.08, eyeCurve: 0.12,
  mouth: 0.14, blush: 0.08, squash: 0.2, dim: 0.04,
};

/* ---------- 宠物状态 ---------- */
const pet = {
  listening: false,
  listeningSince: 0,
  asleep: false,
  lastInteraction: Date.now(),
  clickIntensity: 0,
  sleepStage: 0,
};

let blinkAt = Date.now() + rand(2600, 5200);
let blinkStart = -1;
const BLINK_MS = 130;

const ripples = [];
let lastRippleAt = 0;
const zeds = []; // 睡觉的 Z 粒子

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

/* ---------- 情绪（参数组 + 小动作签名） ---------- */
let moodResetTimer = null;
function showMood(name, ms = 2200) {
  applyMood(name);
  clearTimeout(moodResetTimer);
  moodResetTimer = setTimeout(() => applyMood(pet.asleep ? 'sleeping' : 'idle'), ms);
}

function applyMood(name) {
  switch (name) {
    case 'idle':
      T.eyeCurve = 0; T.mouthOpen = 0; T.mouthCurve = 1; T.blush = 0; T.eyeOpenL = 1; T.eyeOpenR = 1;
      break;
    case 'happy':
      T.eyeCurve = 1; T.mouthOpen = 0.7; T.mouthCurve = 1; T.blush = 0.5;
      break;
    case 'love':
      T.eyeCurve = 1; T.mouthOpen = 0.25; T.mouthCurve = 1; T.blush = 0.9;
      break;
    case 'surprised':
      T.eyeCurve = 0; T.mouthOpen = 0.9; T.mouthCurve = -1; T.blush = 0;
      break;
    case 'thinking':
      T.eyeCurve = 0.25; T.mouthOpen = 0; T.mouthCurve = 0.2; T.blush = 0;
      break;
    case 'sleeping':
      T.eyeOpenL = 0; T.eyeOpenR = 0; T.mouthOpen = 0; T.mouthCurve = 0.4; T.blush = 0;
      break;
  }
}

/* ---------- 生物钟：犯困 → 闭眼 → 睡着 ---------- */
setInterval(() => {
  if (pet.listening || dragState) return;
  const idleFor = Date.now() - pet.lastInteraction;
  if (idleFor > 140000 && pet.sleepStage < 3) enterSleep();
  else if (idleFor > 80000 && pet.sleepStage === 0) {
    pet.sleepStage = 1;
    applyMood('thinking');
  }
}, 4000);

function enterSleep() {
  if (pet.sleepStage === 3) return;
  pet.sleepStage = 2;
  // 眼皮慢慢垂下来（这是连续参数，不是换图）
  T.eyeOpenL = 0.25; T.eyeOpenR = 0.25;
  T.eyeCurve = 0; T.mouthCurve = 0.3;
  setTimeout(() => {
    pet.sleepStage = 3;
    pet.asleep = true;
    applyMood('sleeping');
  }, 1600);
}

function wakeUp() {
  if (pet.sleepStage === 0) return;
  pet.sleepStage = 0;
  pet.asleep = false;
  showMood('surprised', 1500);
  say('醒啦', 1200);
}

function touch() {
  pet.lastInteraction = Date.now();
  wakeUp();
}

/* ---------- 离散小动作（45–90s 一次，做完就静） ---------- */
function scheduleAmbient() {
  const every = rand(45000, 90000);
  setTimeout(() => {
    scheduleAmbient();
    if (pet.listening || pet.asleep || dragState || document.hidden) return;
    if (Math.random() < 0.5) {
      // 小跳一下
      T.squashY = 1.05; T.squashX = 0.96;
      setTimeout(() => { T.squashX = 1; T.squashY = 1; }, 180);
    } else {
      // 歪头看你
      T.eyeLookX = 0;
      tiltSpring.kick(0.04);
      setTimeout(() => tiltSpring.kick(-0.02), 700);
    }
  }, every);
}

const tiltSpring = (() => {
  let x = 0, v = 0, target = 0;
  return {
    kick(i) { v += i; },
    set(t) { target = t; },
    step() { v = (v + (target - x) * 0.12) * 0.8; x += v; return x; },
  };
})();

/* ---------- 画布 ---------- */
let dpr = 1;
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* ---------- 角色几何（设计坐标 150×140） ---------- */
const GEO = {
  cx: 75,
  baseY: 122,
  head: { x: 36, y: 42, w: 78, h: 64, r: 22 },
  eyeL: { x: 58, y: 72 }, eyeR: { x: 92, y: 72 },
  eyeW: 9, eyeH: 15,
  mouth: { x: 75, y: 92 },
  tentacles: [
    { x: 44, y: 104, phase: 0 },
    { x: 62, y: 108, phase: 1.6 },
    { x: 88, y: 108, phase: 3.1 },
    { x: 106, y: 104, phase: 4.4 },
  ],
};

function squirclePath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTentacle(tx, ty, sway) {
  ctx.beginPath();
  ctx.moveTo(tx - 11, ty);
  ctx.quadraticCurveTo(tx - 12 + sway, ty + 15, tx + sway * 0.6, ty + 17);
  ctx.quadraticCurveTo(tx + 12 + sway, ty + 15, tx + 11, ty);
  ctx.closePath();
  ctx.fill();
}

function drawBuddy(now) {
  const t = now / 1000;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const sx = (W / 150) * P.squashX;
  const sy = (H / 140) * P.squashY;
  const tilt = tiltSpring.step();

  const breathe = Math.sin(t * 2.2) * 0.004; // 0.4%，几乎不可见
  const cx = W / 2;
  const baseY = H - 16;

  // 贴地阴影
  ctx.beginPath();
  ctx.ellipse(cx, H - 14, 34 * P.squashX, 5.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(23, 23, 19, ${(0.16 * (1 - P.dim * 0.5)).toFixed(3)})`;
  ctx.fill();

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(tilt);
  ctx.scale(sx * (1 + breathe), sy * (1 - breathe));
  ctx.translate(-GEO.cx, -GEO.baseY);

  // 涟漪（旁听）
  if (pet.listening) drawRipples(now);

  // 触手（各自相位，永不整齐）
  ctx.fillStyle = '#6b4cd8';
  for (const tc of GEO.tentacles) {
    drawTentacle(tc.x, tc.y, Math.sin(t * 1.8 + tc.phase) * 1.6);
  }

  // 头：紫渐变 squircle
  const grad = ctx.createLinearGradient(GEO.head.x, GEO.head.y, GEO.head.x + GEO.head.w, GEO.head.y + GEO.head.h);
  grad.addColorStop(0, '#a68bfa');
  grad.addColorStop(1, '#7a52e8');
  squirclePath(GEO.head.x, GEO.head.y, GEO.head.w, GEO.head.h, GEO.head.r);
  ctx.fillStyle = grad;
  ctx.fill();

  // 顶部柔光（一点点体积感，不是描边）
  ctx.beginPath();
  ctx.ellipse(GEO.head.x + 22, GEO.head.y + 13, 20, 9, -0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.fill();

  // 腮红
  if (P.blush > 0.02) {
    ctx.fillStyle = `rgba(255, 148, 120, ${(P.blush * 0.32).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(50, 84, 6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(100, 84, 6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEye(GEO.eyeL, P.eyeOpenL, now);
  drawEye(GEO.eyeR, P.eyeOpenR, now);
  drawMouth();

  // 睡眠 Z
  if (pet.asleep) drawZeds(now);

  // 压暗
  if (P.dim > 0.01) {
    ctx.fillStyle = `rgba(16, 14, 26, ${(P.dim * 0.45).toFixed(3)})`;
    squirclePath(GEO.head.x - 12, GEO.head.y - 8, GEO.head.w + 24, GEO.head.h + 36, GEO.head.r);
    ctx.fill();
    for (const tc of GEO.tentacles) {
      drawTentacle(tc.x, tc.y, 0);
    }
  }

  ctx.restore();
}

function drawEye(eye, open, now) {
  if (open < 0.04) {
    // 闭合：一条安静的弯线
    ctx.beginPath();
    ctx.moveTo(eye.x - 5, eye.y + 2);
    ctx.quadraticCurveTo(eye.x, eye.y + 6, eye.x + 5, eye.y + 2);
    ctx.strokeStyle = '#241d38';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  const h = GEO.eyeH * open;
  const curve = P.eyeCurve;
  ctx.save();
  ctx.beginPath();
  // 眼形：圆角矩形 → 弯月（curve 越大下缘越平）
  const w = GEO.eyeW;
  ctx.ellipse(eye.x, eye.y + (GEO.eyeH - h) * 0.5, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#241d38';
  ctx.fill();
  if (curve > 0.05) {
    // 弯月笑眼：用头色盖掉下半部分
    ctx.save();
    ctx.clip();
    const grad = ctx.createLinearGradient(GEO.head.x, GEO.head.y, GEO.head.x + GEO.head.w, GEO.head.y + GEO.head.h);
    grad.addColorStop(0, '#a68bfa');
    grad.addColorStop(1, '#7a52e8');
    ctx.fillStyle = grad;
    ctx.fillRect(eye.x - w / 2 - 1, eye.y + h * (0.35 - curve * 0.55), w + 2, h);
    ctx.restore();
  }
  // 瞳孔高光（跟手）
  const px = clamp(P.eyeLookX, -2, 2);
  const py = clamp(P.eyeLookY, -1.5, 1.5);
  ctx.beginPath();
  ctx.arc(eye.x + 1.5 + px, eye.y - 2 + py, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.restore();
}

function drawMouth() {
  const { x, y } = GEO.mouth;
  const open = P.mouthOpen;
  const curve = P.mouthCurve;
  ctx.lineCap = 'round';
  if (open > 0.55 && curve < 0) {
    // 惊讶 o 嘴
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 3.4, 4.2 * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.quadraticCurveTo(x, y + 5.5 * curve + open * 6, x + 7, y);
  if (open > 0.3) {
    // 张嘴笑：填充
    ctx.quadraticCurveTo(x, y - 1.5, x - 7, y);
    ctx.fillStyle = '#241d38';
    ctx.fill();
  } else {
    ctx.strokeStyle = '#241d38';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawRipples(now) {
  if (now - lastRippleAt > 1600) {
    ripples.push({ born: now });
    lastRippleAt = now;
  }
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    const age = (now - ripples[i].born) / 2400;
    if (age >= 1) { ripples.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(GEO.cx, GEO.baseY - 40, 40 + age * 42, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(122, 82, 232, ${(0.3 * (1 - age)).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function drawZeds(now) {
  if (Math.random() < 0.012 && zeds.length < 3) {
    zeds.push({ born: now, drift: rand(-4, 4) });
  }
  ctx.textAlign = 'center';
  for (let i = zeds.length - 1; i >= 0; i -= 1) {
    const age = (now - zeds[i].born) / 3200;
    if (age >= 1) { zeds.splice(i, 1); continue; }
    const x = GEO.cx + 34 + zeds[i].drift * age;
    const y = GEO.head.y - 6 - age * 26;
    ctx.globalAlpha = (1 - age) * 0.7;
    ctx.fillStyle = '#7a52e8';
    ctx.font = `${10 + age * 5}px sans-serif`;
    ctx.fillText('z', x, y);
    ctx.globalAlpha = 1;
  }
}

/* ---------- 主循环 ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;

  // 参数收敛
  P.eyeOpenL = lerp(P.eyeOpenL, T.eyeOpenL, SPEED.eyeOpen);
  P.eyeOpenR = lerp(P.eyeOpenR, T.eyeOpenR, SPEED.eyeOpen);
  P.eyeLookX = lerp(P.eyeLookX, T.eyeLookX, SPEED.eyeLook);
  P.eyeLookY = lerp(P.eyeLookY, T.eyeLookY, SPEED.eyeLook);
  P.eyeCurve = lerp(P.eyeCurve, T.eyeCurve, SPEED.eyeCurve);
  P.mouthOpen = lerp(P.mouthOpen, T.mouthOpen, SPEED.mouth);
  P.mouthCurve = lerp(P.mouthCurve, T.mouthCurve, SPEED.mouth);
  P.blush = lerp(P.blush, T.blush, SPEED.blush);
  P.squashX = lerp(P.squashX, T.squashX, SPEED.squash);
  P.squashY = lerp(P.squashY, T.squashY, SPEED.squash);

  const night = new Date().getHours() >= 23 || new Date().getHours() < 7;
  T.dim = pet.asleep ? 0.4 : night ? 0.2 : 0;
  P.dim = lerp(P.dim, T.dim, SPEED.dim);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  drawBuddy(now);
  ctx.restore();

  // 眨眼（快速 1→0→1）
  if (blinkStart < 0 && Date.now() > blinkAt && !pet.asleep && pet.sleepStage < 2) {
    blinkStart = now;
    T.eyeOpenL = 0; T.eyeOpenR = 0;
    setTimeout(() => { T.eyeOpenL = 1; T.eyeOpenR = 1; }, BLINK_MS * 0.6);
    blinkStart = -2; // 冷却标记
    setTimeout(() => { blinkStart = -1; }, BLINK_MS);
    blinkAt = Date.now() + rand(2800, 6800);
  }
}

/* ---------- 交互：单击=互动 · 右键=功能 · 拖动=位移 · 拖文件=收下 ---------- */
let dragState = null;
let intensityTimer = null;

function reactToTap() {
  pet.clickIntensity += 1;
  clearTimeout(intensityTimer);
  intensityTimer = setTimeout(() => { pet.clickIntensity = Math.max(0, pet.clickIntensity - 1); }, 1600);

  if (pet.clickIntensity <= 1) {
    showMood('happy');
    T.squashY = 1.06; T.squashX = 0.95;
    setTimeout(() => { T.squashX = 1; T.squashY = 1; }, 160);
    say('我在');
  } else if (pet.clickIntensity === 2) {
    showMood('love');
    tiltSpring.kick(0.05);
    say('今天也一起学');
  } else if (pet.clickIntensity === 3) {
    showMood('surprised');
    tiltSpring.kick(-0.06);
    say('哎？');
  } else {
    showMood('surprised', 2600);
    tiltSpring.kick(0.08);
    setTimeout(() => tiltSpring.kick(-0.08), 120);
    say('别一直戳我', 2200);
    pet.clickIntensity = 0;
  }
}

canvas.addEventListener('pointerenter', () => {
  pet.lastInteraction = Date.now();
  if (pet.listening) {
    updateListenSpeech();
    listenSpeechTimer = setInterval(updateListenSpeech, 5000);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (dragState) return;
  const rect = canvas.getBoundingClientRect();
  // 眼睛看向光标（相对身体中心的方向，幅度克制）
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  T.eyeLookX = clamp(nx * 2.2, -2.2, 2.2);
  T.eyeLookY = clamp(ny * 1.6, -1.6, 1.6);
});

canvas.addEventListener('pointerleave', () => {
  T.eyeLookX = 0;
  T.eyeLookY = 0;
  if (listenSpeechTimer) {
    clearInterval(listenSpeechTimer);
    listenSpeechTimer = null;
    speechEl.dataset.visible = 'false';
  }
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  touch();
  T.squashX = 0.97;
  T.squashY = 1.03;
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
  T.squashX = 1;
  T.squashY = 1;
  if (!moved) reactToTap();
}
canvas.addEventListener('pointerup', releaseDrag);
canvas.addEventListener('pointercancel', () => { dragState = null; T.squashX = 1; T.squashY = 1; });

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  touch();
  window.meetmindCompanion?.showPetMenu();
});

/* ---------- 旁听（右键菜单触发，pet:action 消息） ---------- */
async function toggleListening() {
  touch();
  const bridge = window.meetmindCompanion;
  if (!bridge?.toggleListen) return;
  if (!pet.listening) {
    T.squashY = 0.94;
    setTimeout(() => { T.squashY = 1; }, 260);
    say('竖起耳朵…', 1500);
  }
  try {
    const result = await bridge.toggleListen();
    if (result?.listening) {
      pet.listening = true;
      pet.listeningSince = Date.now();
      applyMood('idle');
      say('我在旁边听', 1600);
      return;
    }
    const wasListening = pet.listening;
    pet.listening = false;
    if (listenSpeechTimer) {
      clearInterval(listenSpeechTimer);
      listenSpeechTimer = null;
    }
    if (wasListening) {
      showMood('happy', 1600);
      say('记下了，去整理', 1800);
      return;
    }
    applyMood('idle');
    const reasons = {
      'not-logged-in': '先在主窗口登录一下',
      'hook-missing': '主窗口还没准备好',
      'no-shell-window': '主窗口还没准备好',
      'start-failed': '没拿到电脑声音，再试一次',
      error: '旁听没起来，再试一次',
    };
    say(reasons[result?.reason] || '旁听没起来，再试一次', 2400);
  } catch {
    say('旁听没起来，再试一次', 1800);
  }
}

window.meetmindCompanion?.onPetAction?.((action) => {
  if (action === 'listen') void toggleListening();
  if (action === 'ask') window.meetmindCompanion?.togglePanel();
  if (action === 'capture') window.meetmindCompanion?.captureScreen?.();
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
  T.mouthOpen = 1;
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
  } finally {
    T.mouthOpen = 0;
  }
});

/* ---------- 捕获成功的吞食动画 ---------- */
window.meetmindCompanion?.onGulp?.(() => {
  touch();
  T.mouthOpen = 1;
  T.squashX = 1.05;
  T.squashY = 0.94;
  setTimeout(() => { T.squashX = 1; T.squashY = 1; }, 160);
  setTimeout(() => { T.mouthOpen = 0; showMood('happy', 900); }, 420);
  say('收下了', 1300);
});

/* ---------- 启动 ---------- */
applyMood('idle');
requestAnimationFrame(frame);
scheduleAmbient();
setTimeout(() => say('同学在这', 2000), 900);
