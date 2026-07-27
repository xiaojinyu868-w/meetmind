/**
 * 感知哈希（pHash）纯逻辑：64 位 DCT 感知哈希 + 汉明距离。
 *
 * 用途：录课「屏幕观察」的翻页检测——1fps 缩略帧算 pHash，
 * 画面实质变化（PPT 翻页/板书推进）时距离跳变，动画渐变/老师走动几乎不动。
 * 选择 32x32 → DCT → 取左上 8x8 低频的经典实现：对缩放/亮度/压缩噪声鲁棒，
 * 对内容排版变化敏感（幻灯片场景已被多个开源项目验证几乎无误判）。
 *
 * 纯 TS、无 DOM 依赖，可单测；浏览器侧像素采集在 frame-capture.ts。
 */

/** RGBA 像素数组转灰度（Rec.601 亮度），返回与像素数等长的 0-255 数组 */
export function toGrayscale(rgba: Uint8ClampedArray | number[]): number[] {
  const length = Math.floor(rgba.length / 4);
  const gray = new Array<number>(length);
  for (let i = 0; i < length; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

export const PHASH_SIZE = 32;
export const PHASH_LOW_FREQ = 8;

// DCT 余弦基预计算（模块加载时算一次）
const COS_TABLE: number[][] = (() => {
  const table: number[][] = [];
  for (let u = 0; u < PHASH_SIZE; u += 1) {
    const row: number[] = [];
    for (let x = 0; x < PHASH_SIZE; x += 1) {
      row.push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE)));
    }
    table.push(row);
  }
  return table;
})();

/**
 * 计算 64 位 pHash。输入必须是 32x32 的灰度数组（1024 个 0-255 值）。
 * 返回 bigint，低 64 位有效。
 */
export function computePhash(gray32: number[]): bigint {
  if (gray32.length !== PHASH_SIZE * PHASH_SIZE) {
    throw new Error(`pHash 需要 ${PHASH_SIZE * PHASH_SIZE} 个灰度值，收到 ${gray32.length}`);
  }

  // 2D DCT-II：先行后列，只保留左上 8x8 低频系数
  const dct: number[][] = [];
  for (let u = 0; u < PHASH_LOW_FREQ; u += 1) {
    const row: number[] = [];
    for (let v = 0; v < PHASH_LOW_FREQ; v += 1) {
      let sum = 0;
      for (let x = 0; x < PHASH_SIZE; x += 1) {
        const cosU = COS_TABLE[u];
        for (let y = 0; y < PHASH_SIZE; y += 1) {
          sum += gray32[x * PHASH_SIZE + y] * cosU[x] * COS_TABLE[v][y];
        }
      }
      row.push(sum);
    }
    dct.push(row);
  }

  // 中位数（排除 DC 直流项 dct[0][0]，它只反映整体亮度）
  const ac: number[] = [];
  for (let u = 0; u < PHASH_LOW_FREQ; u += 1) {
    for (let v = 0; v < PHASH_LOW_FREQ; v += 1) {
      if (u === 0 && v === 0) continue;
      ac.push(dct[u][v]);
    }
  }
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // 死区：|系数 - 中位数| ≤ eps 的一律记 0。
  // 简洁排版幻灯片（大面积纯色）会让大量低频系数在中位数处形成"同值簇"，
  // 整体亮度变化或轻微噪声会让簇内系数在中位数两侧随机横跳、哈希失稳；
  // 近中位数的系数本来信息量也最低，死区用微小的判别力换哈希稳定性。
  const maxAbs = sorted.reduce((acc, v) => Math.max(acc, Math.abs(v)), 1e-9);
  const eps = maxAbs * 0.01;

  let hash = BIGINT_ZERO;
  for (let u = 0; u < PHASH_LOW_FREQ; u += 1) {
    for (let v = 0; v < PHASH_LOW_FREQ; v += 1) {
      hash = hash << BIGINT_ONE;
      if (dct[u][v] > median + eps) hash = hash | BIGINT_ONE;
    }
  }
  return hash;
}

// tsconfig target 是 ES2017，不能用 BigInt 字面量（0n），统一走 BigInt() 构造
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

/** 两个 64 位 pHash 的汉明距离（0-64，越小越相似） */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let distance = 0;
  while (x > BIGINT_ZERO) {
    distance += Number(x & BIGINT_ONE);
    x = x >> BIGINT_ONE;
  }
  return distance;
}
