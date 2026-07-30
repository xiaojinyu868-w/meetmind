#!/usr/bin/env node
/**
 * octo-sprite-map — Octo Buddy 精灵图算法分解（构建期一次性运行）
 *
 * 目标：100% 保留原画（不重绘、不描摹、不矢量化），但让参数化动画
 * 有锚点可用。算法从每张 PNG 里提取：
 *   1. body    —— 非透明像素包围盒（呼吸/挤压的基准线与缩放锚点）
 *   2. eyes    —— 近黑色像素簇的连通域，取最紧凑的两个大团块（眼皮遮罩位置）
 *   3. faceColor —— 每只眼睛正上方 3px 处的采样色（眨眼时用它画眼皮，和脸完全同色）
 *
 * 用法：node scripts/octo-sprite-map.js
 * 输出：desktop/assets/octo/octo-sprite-map.json
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SPRITE_DIR = path.join(__dirname, '..', 'desktop', 'assets', 'octo');
const OUT_FILE = path.join(SPRITE_DIR, 'octo-sprite-map.json');
const SPRITES = ['idle', 'happy', 'excited', 'thinking', 'surprised', 'love', 'sleeping'];

const DARK_THRESHOLD = 70; // 眼睛是纯黑椭圆，RGB 全低于此值视为"暗"
const MIN_CLUSTER_AREA = 40; // 嘴是一条细线，面积远小于眼睛，阈值直接滤掉

/** 连通域提取（4 邻域 flood fill），返回每个团块的 bbox 与面积 */
function findDarkClusters(pixels, width, height) {
  const isDark = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const a = pixels[i * 4 + 3];
    if (a > 200 && r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD) {
      isDark[i] = 1;
    }
  }

  const visited = new Uint8Array(width * height);
  const clusters = [];
  for (let start = 0; start < width * height; start += 1) {
    if (!isDark[start] || visited[start]) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const idx = queue.pop();
      const x = idx % width;
      const y = Math.floor(idx / width);
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= width * height) continue;
        // 防左右越界串行
        if ((idx % width === 0 && n === idx - 1) || (idx % width === width - 1 && n === idx + 1)) continue;
        if (isDark[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
    clusters.push({ minX, minY, maxX, maxY, area });
  }
  return clusters;
}

/** 非透明像素包围盒 */
function findBodyBox(pixels, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 眼皮颜色采样：眼周多个候选点，取第一个不透明且非暗色的体素
 *  （体素接缝处可能透明，单点采样不可靠） */
function sampleLidColor(pixels, width, height, eye) {
  const candidates = [
    [eye.cx, eye.y - 4],
    [eye.cx, eye.y - 2],
    [eye.x - 4, eye.cy],
    [eye.x + eye.w + 4, eye.cy],
    [eye.cx, eye.y + eye.h + 4],
  ];
  for (const [x, y] of candidates) {
    const px = Math.min(Math.max(0, x), width - 1);
    const py = Math.min(Math.max(0, y), height - 1);
    const i = (py * width + px) * 4;
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a > 200 && !(r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD)
        && !(r > 240 && g > 240 && b > 240)) { // 排除纯白高光/背景
      return [r, g, b];
    }
  }
  return [139, 92, 246]; // 兜底：Octo 紫
}

async function analyzeSprite(name) {
  const file = path.join(SPRITE_DIR, `${name}.png`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const body = findBodyBox(data, width, height);
  const clusters = findDarkClusters(data, width, height)
    .filter((c) => c.area >= MIN_CLUSTER_AREA)
    // 眼睛在脸部（body 上半部分），且团块要"紧凑"（接近圆形，排除长条）
    .filter((c) => c.minY < body.y + body.h * 0.6)
    .map((c) => {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      const fill = c.area / (w * h); // 紧凑度：圆团块高，细线低
      return { ...c, w, h, fill };
    })
    .filter((c) => c.fill > 0.45)
    .sort((a, b) => b.area - a.area)
    .slice(0, 2)
    .sort((a, b) => a.minX - b.minX);

  const eyes = clusters.map((c) => {
    const cx = c.minX + Math.floor(c.w / 2);
    return {
      x: c.minX,
      y: c.minY,
      w: c.w,
      h: c.h,
      cx,
      cy: c.minY + Math.floor(c.h / 2),
      lidColor: sampleLidColor(data, width, height, { cx, cy: c.minY + Math.floor(c.h / 2), x: c.minX, y: c.minY, w: c.w, h: c.h }),
    };
  });

  return { width, height, body, eyes, eyesOpen: eyes.length === 2 };
}

/** 闭眼态精灵（excited 的 ^^ 眼、sleeping 的闭合眼）：
 *  按 body 包围盒比例从 idle 映射眼睛位置——眨眼遮罩用不上，
 *  但状态过渡回睁眼时位置是连续的。 */
function inheritEyesFrom(map, name) {
  const ref = map.idle;
  const target = map[name];
  if (!ref || !target || target.eyesOpen) return;
  const sx = target.body.w / ref.body.w;
  const sy = target.body.h / ref.body.h;
  target.eyes = ref.eyes.map((eye) => ({
    x: Math.round(target.body.x + (eye.x - ref.body.x) * sx),
    y: Math.round(target.body.y + (eye.y - ref.body.y) * sy),
    w: Math.round(eye.w * sx),
    h: Math.round(eye.h * sy),
    cx: Math.round(target.body.x + (eye.cx - ref.body.x) * sx),
    cy: Math.round(target.body.y + (eye.cy - ref.body.y) * sy),
    lidColor: eye.lidColor,
  }));
}

async function main() {
  const map = {};
  for (const name of SPRITES) {
    map[name] = await analyzeSprite(name);
    console.log(`${name}: body=${JSON.stringify(map[name].body)} eyes=${map[name].eyes.length}${map[name].eyesOpen ? '' : '（闭眼态）'}`);
  }
  inheritEyesFrom(map, 'excited');
  inheritEyesFrom(map, 'sleeping');
  map.__meta = {
    generatedAt: new Date().toISOString(),
    algorithm: 'dark-cluster-connected-components + alpha-bbox',
    darkThreshold: DARK_THRESHOLD,
    minClusterArea: MIN_CLUSTER_AREA,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(map, null, 2));
  console.log(`\n✅ 写入 ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
