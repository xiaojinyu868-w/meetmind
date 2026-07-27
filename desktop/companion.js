const ASSETS = {
  idle: './assets/octo/idle.png',
  listening: './assets/octo/excited.png',
  thinking: './assets/octo/thinking.png',
  happy: './assets/octo/happy.png',
  surprised: './assets/octo/surprised.png',
  love: './assets/octo/love.png',
  sleeping: './assets/octo/sleeping.png',
  angry: './assets/octo/surprised.png',
  game: './assets/octo/excited.png',
};

const COPY = {
  idle: ['同学在这', '我会自己待着，也会陪你听课。'],
  listening: ['陪你听课', '我正在旁边听，等你有问题。'],
  thinking: ['我想一下', '刚才那点我在整理。'],
  happy: ['接住了', '这一下我听懂了。'],
  surprised: ['哎？', '你刚刚戳得有点突然。'],
  angry: ['别一直戳我', '伙伴也要有边界。'],
  love: ['我在', '今天也一起学。'],
  sleeping: ['睡着了', '太久没人理我，我先眯一会。'],
  game: ['陪你打游戏', '我接入这一局，边玩边聊。'],
};

const companion = document.getElementById('companion');
const buddyButton = document.getElementById('buddyButton');
const buddySprite = document.getElementById('buddySprite');
const buddySpeech = document.getElementById('buddySpeech');
const statusTitle = document.getElementById('statusTitle');
const statusText = document.getElementById('statusText');
const behaviorLine = document.getElementById('behaviorLine');
const closeButton = document.getElementById('closeButton');
const listenButton = document.getElementById('listenButton');
const askButton = document.getElementById('askButton');
const gameButton = document.getElementById('gameButton');
const openButton = document.getElementById('openButton');

let expanded = false;
let mood = 'idle';
let clickIntensity = 0;
let lastInteractionAt = Date.now();
let interactionTimer = null;
let reactionResetTimer = null;
let idleTimer = null;
let ambientTimer = null;
let ambientResetTimer = null;
let burstTimer = null;
let speechTimer = null;
let openTapTimer = null;
let dragState = null;

function setExpanded(next) {
  expanded = Boolean(next);
  companion.dataset.expanded = String(expanded);
  window.meetmindCompanion?.setExpanded(expanded);
}

function setMotion(next) {
  companion.dataset.motion = next;
}

function showBurst() {
  window.clearTimeout(burstTimer);
  companion.dataset.burst = 'true';
  burstTimer = window.setTimeout(() => {
    companion.dataset.burst = 'false';
  }, 980);
}

function showSpeech(line, duration = 1800) {
  buddySpeech.textContent = line;
  buddySpeech.dataset.visible = 'true';
  window.clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => {
    buddySpeech.dataset.visible = 'false';
  }, duration);
}

function setMood(next, line) {
  mood = next;
  companion.dataset.mood = mood;
  buddySprite.src = ASSETS[mood] || ASSETS.idle;
  const [title, subtitle] = COPY[mood] || COPY.idle;
  statusTitle.textContent = title;
  statusText.textContent = subtitle;
  behaviorLine.textContent = line || behaviorLine.textContent;
}

function touch(line) {
  lastInteractionAt = Date.now();
  if (line) behaviorLine.textContent = line;
  scheduleIdleLifecycle();
}

function resetReactionLater(delay = 2400) {
  window.clearTimeout(reactionResetTimer);
  reactionResetTimer = window.setTimeout(() => {
    if (expanded || mood === 'listening' || mood === 'game') return;
    setMood('idle', '它回到旁边待着。');
    setMotion('breathe');
  }, delay);
}

function pickAmbientMotion(idleFor) {
  if (idleFor > 90000) return 'breathe';
  if (idleFor > 50000) return 'nudge';
  const motions = idleFor > 24000 ? ['peek', 'wiggle', 'nudge'] : ['peek', 'wiggle', 'hop'];
  return motions[Math.floor(Math.random() * motions.length)] || 'peek';
}

function scheduleAmbientMotion() {
  window.clearInterval(ambientTimer);
  ambientTimer = window.setInterval(() => {
    if (expanded || mood === 'listening' || mood === 'game' || dragState) return;
    const idleFor = Date.now() - lastInteractionAt;
    const nextMotion = pickAmbientMotion(idleFor);
    setMotion(nextMotion);
    window.clearTimeout(ambientResetTimer);
    ambientResetTimer = window.setTimeout(() => setMotion('breathe'), nextMotion === 'hop' ? 900 : 1500);
  }, 5800);
}

function scheduleIdleLifecycle() {
  window.clearInterval(idleTimer);
  idleTimer = window.setInterval(() => {
    if (expanded || mood === 'listening' || mood === 'game') return;
    const idleFor = Date.now() - lastInteractionAt;
    if (idleFor > 90000) {
      setMood('sleeping', '它真的会睡着。点一下就醒。');
      return;
    }
    if (idleFor > 50000 && mood !== 'thinking') {
      setMood('thinking', '它开始犯困了，但还在旁边。');
      return;
    }
    if (idleFor > 24000 && mood === 'idle') {
      setMood('love', '你没说话，它也还在。');
    }
  }, 4000);
}

function reactToClick() {
  touch();
  clickIntensity += 1;
  window.clearTimeout(interactionTimer);
  interactionTimer = window.setTimeout(() => {
    clickIntensity = Math.max(0, clickIntensity - 1);
  }, 1600);

  if (mood === 'sleeping') {
    clickIntensity = 0;
    setMood('surprised', '被你叫醒了。');
    setMotion('hop');
    showSpeech('醒啦醒啦');
    showBurst();
    resetReactionLater(2400);
    return;
  }
  if (clickIntensity <= 1) {
    setMood('happy', '轻轻戳一下，它会回应。');
    setMotion('hop');
    showSpeech('嘿嘿，我在');
    showBurst();
    resetReactionLater();
    return;
  }
  if (clickIntensity === 2) {
    setMood('love', '它知道你在。');
    setMotion('celebrate');
    showSpeech('今天也一起学');
    showBurst();
    resetReactionLater();
    return;
  }
  if (clickIntensity >= 4) {
    setMood('angry', '再戳它就要生气了。');
    setMotion('nudge');
    showSpeech('别一直戳我', 2400);
    resetReactionLater(3000);
    return;
  }
  setMood('surprised', '它在判断你是不是故意的。');
  setMotion('wiggle');
  showSpeech('哎？轻一点');
  showBurst();
  resetReactionLater();
}

function handlePetTap() {
  reactToClick();
  if (openTapTimer) {
    window.clearTimeout(openTapTimer);
    openTapTimer = null;
    setExpanded(true);
    return;
  }
  openTapTimer = window.setTimeout(() => {
    openTapTimer = null;
  }, 280);
}

buddyButton.addEventListener('mouseenter', () => {
  if (dragState || mood === 'listening' || mood === 'game') return;
  touch();
  setMotion('peek');
  showSpeech('我看到你啦', 1200);
});

buddyButton.addEventListener('mouseleave', () => {
  if (dragState) return;
  setMotion('breathe');
});

buddyButton.addEventListener('pointerdown', (event) => {
  buddyButton.setPointerCapture(event.pointerId);
  touch();
  setMotion('dragging');
  dragState = {
    pointerId: event.pointerId,
    lastX: event.screenX,
    lastY: event.screenY,
    moved: false,
  };
});

buddyButton.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const deltaX = event.screenX - dragState.lastX;
  const deltaY = event.screenY - dragState.lastY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
    dragState.moved = true;
    window.meetmindCompanion?.moveBy(deltaX, deltaY);
    dragState.lastX = event.screenX;
    dragState.lastY = event.screenY;
  }
});

buddyButton.addEventListener('pointerup', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  buddyButton.releasePointerCapture(event.pointerId);
  const wasDrag = dragState.moved;
  dragState = null;
  setMotion('breathe');
  if (wasDrag) return;
  handlePetTap();
});

buddyButton.addEventListener('pointercancel', () => {
  dragState = null;
  setMotion('breathe');
});

closeButton.addEventListener('click', () => {
  setExpanded(false);
  touch('收起来也不会消失，它还在桌面上。');
});

listenButton.addEventListener('click', () => {
  touch('共同场景：陪你听课，而不是只等你提问。');
  setMood('listening');
  setMotion('breathe');
  // v2：进壳内主窗口的 /app 听课，不再跳外部浏览器
  window.meetmindCompanion?.showMain();
});

askButton.addEventListener('click', () => {
  touch('小窗就地提问，不用打断手头的事。');
  setMood('thinking');
  setMotion('breathe');
  // v3：问同学 = 唤起桌面小窗（就地随手记/随口问），不再只跳主窗口
  window.meetmindCompanion?.togglePanel();
});

gameButton.addEventListener('click', () => {
  touch('共同场景预留：以后接 GameBridge / GameStrategy。');
  setMood('game');
  setMotion('celebrate');
  showBurst();
});

openButton.addEventListener('click', () => {
  touch('打开完整学习现场。');
  setMood('love');
  setMotion('celebrate');
  showBurst();
  window.meetmindCompanion?.showMain();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setExpanded(false);
  if (event.key.toLowerCase() === 'q' && (event.metaKey || event.ctrlKey)) window.meetmindCompanion?.quit();
});

companion.dataset.burst = 'false';
buddySpeech.dataset.visible = 'false';
setMotion('breathe');
setMood('idle', '没人理我时，我会发呆、犯困，然后睡着。');
scheduleIdleLifecycle();
scheduleAmbientMotion();
