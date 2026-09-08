/* teach-classroom-v1 · 共享行为（纯前端 mock，无后端） */

// 声音波形：speaking 时正弦 + 噪声，idle 时归于平线
function animateWave(el, opts = {}) {
  const bars = [...el.querySelectorAll('i')];
  let t = 0, speaking = true;
  el.classList.remove('idle');
  function frame() {
    if (!speaking) return;
    t += 0.14;
    bars.forEach((b, i) => {
      const v = Math.abs(Math.sin(t + i * 0.9)) * (0.5 + 0.5 * Math.abs(Math.sin(t * 0.6 + i)));
      b.style.height = 3 + v * 15 + 'px';
    });
    requestAnimationFrame(frame);
  }
  frame();
  return {
    stop() {
      speaking = false;
      el.classList.add('idle');
      bars.forEach(b => (b.style.height = '3px'));
    },
    start() {
      if (speaking) return;
      speaking = true;
      el.classList.remove('idle');
      frame();
    },
  };
}

// 上课计时
function startClock(el, fromSec = 563) {
  let s = fromSec;
  const fmt = () => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  el.textContent = fmt();
  setInterval(() => { s++; el.textContent = fmt(); }, 1000);
}

// 注记面板开合
function initNotes() {
  const toggle = document.querySelector('.notes-toggle');
  const notes = document.querySelector('.notes');
  if (!toggle || !notes) return;
  toggle.addEventListener('click', () => notes.classList.toggle('open'));
}

// 板书重播：给 [data-write] 元素按顺序重新播放 write-in / draw
function replayWriting(root) {
  const els = [...root.querySelectorAll('[data-write]')];
  els.forEach(el => {
    el.classList.remove('on');
    // SVG 描边
    el.querySelectorAll('.draw').forEach(p => p.classList.remove('on'));
  });
  let delay = 200;
  els.forEach((el, idx) => {
    setTimeout(() => {
      el.classList.add('on');
      el.querySelectorAll('.draw').forEach((p, j) => {
        setTimeout(() => p.classList.add('on'), j * 260);
      });
    }, delay);
    delay += 620 + idx * 60;
  });
  return delay;
}

// 初始自动播放一次板书
function autoWrite(root) {
  const els = [...root.querySelectorAll('[data-write]')];
  let delay = 350;
  els.forEach((el, idx) => {
    setTimeout(() => {
      el.classList.add('on');
      el.querySelectorAll('.draw').forEach((p, j) => {
        setTimeout(() => p.classList.add('on'), j * 260);
      });
    }, delay);
    delay += 620 + idx * 60;
  });
}

// 聚光灯：spotOn(el) 聚焦；spotOff() 全亮
function spotOn(board, el, cx, cy) {
  board.classList.add('spotting');
  board.querySelectorAll('.b-el').forEach(n => n.classList.remove('spot-on'));
  el.classList.add('spot-on');
  const veil = board.querySelector('.spotlight-veil');
  veil.style.setProperty('--sx', cx);
  veil.style.setProperty('--sy', cy);
}
function spotOff(board) {
  board.classList.remove('spotting');
  board.querySelectorAll('.b-el').forEach(n => n.classList.remove('spot-on'));
}

// 激光笔：在 board 内沿给定坐标点跑动一次
function laserRun(board, points, ms = 3200) {
  const laser = board.querySelector('.laser');
  if (!laser) return;
  laser.classList.remove('on');
  laser.style.transition = 'none';
  laser.style.left = points[0][0];
  laser.style.top = points[0][1];
  void laser.offsetWidth;
  laser.classList.add('on');
  laser.style.transition = `left ${ms}ms cubic-bezier(.4,.1,.3,1), top ${ms}ms cubic-bezier(.4,.1,.3,1)`;
  laser.style.left = points[points.length - 1][0];
  laser.style.top = points[points.length - 1][1];
  // 中途在重点处打一圈瞬态光圈
  points.slice(1).forEach((p, i) => {
    setTimeout(() => {
      const ring = document.createElement('div');
      ring.className = 'laser-ring on';
      ring.style.left = p[0];
      ring.style.top = p[1];
      board.appendChild(ring);
      setTimeout(() => ring.remove(), 1200);
    }, (ms / points.length) * (i + 1));
  });
  setTimeout(() => laser.classList.remove('on'), ms + 500);
}

// 打字机式口播字幕
function narrate(el, text, speed = 42) {
  el.innerHTML = '';
  const p = document.createElement('p');
  el.appendChild(p);
  let i = 0;
  const caret = '<span class="stream-caret"></span>';
  return new Promise(res => {
    const timer = setInterval(() => {
      i++;
      p.innerHTML = text.slice(0, i) + (i < text.length ? caret : '');
      if (i >= text.length) { clearInterval(timer); res(); }
    }, speed);
  });
}
