/**
 * 浏览器侧屏幕帧采集：从视频元素抓帧 → 缩略图 pHash / 原分辨率 JPEG。
 *
 * 与纯逻辑层（phash.ts / detector.ts）的分工：
 *   这里只碰 DOM/Canvas，不做判定；判定全部在 KeyframeDetector。
 *   调用方（录课「屏幕观察」hook）以 1fps 调 grabFrameHash 喂检测器，
 *   检测器返回 'keep' 时再调 grabFrameJpeg 拿原分辨率关键帧上传。
 */

import { computePhash, toGrayscale, PHASH_SIZE } from './phash';

/** 抓取当前帧并计算 pHash。video 必须已开始播放（readyState >= 2）。 */
export function grabFrameHash(video: HTMLVideoElement): bigint {
  const canvas = document.createElement('canvas');
  canvas.width = PHASH_SIZE;
  canvas.height = PHASH_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  // 拉伸到 32x32：缩放同时完成降噪，pHash 对宽高比失真不敏感
  ctx.drawImage(video, 0, 0, PHASH_SIZE, PHASH_SIZE);
  const { data } = ctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE);
  return computePhash(toGrayscale(data));
}

/**
 * 抓取当前帧的原分辨率 JPEG（关键帧落盘/上传用）。
 * 长边压到 maxLongEdge（默认 1280：幻灯片文字 OCR 需要足够像素，再大浪费 token）。
 */
export async function grabFrameJpeg(
  video: HTMLVideoElement,
  maxLongEdge = 1280,
  quality = 0.82,
): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('视频尺寸不可用');

  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG 编码失败'))),
      'image/jpeg',
      quality,
    );
  });
}
