'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EchoData } from './EchoCard';

// ── 类型 ──────────────────────────────────────────

interface EchoShareCardProps {
  echo: EchoData;
  courseName?: string;
  open: boolean;
  onClose: () => void;
}

// ── 设计哲学 ──────────────────────────────────────
//
// 分享图 = 离开产品后的名片。参考实体书封面排版：
//
// 1. 大留白 — 上下左右都有呼吸空间，文字不贴边
// 2. 精确字体层级 — 正文 26px > 金句 22px（斜体）> 带走 20px > 元信息 13px
// 3. 一条线就够 — 只有一根极细的分隔线，区分内容区和品牌区
// 4. 色彩克制 — 暖白底 + 深褐字，不用渐变，不用多种颜色
// 5. 品牌极轻 — 右下角一行小字，不加 logo、不加装饰

const CARD_W = 750;
const PAD_X = 80;
const PAD_TOP = 96;
const PAD_BOTTOM = 80;

// 色彩系统 — 只用四个色值
const COLOR = {
  bg: '#F7F5F1',       // 暖白，比纯白温暖
  ink: '#2C2825',       // 深褐，比纯黑柔和
  secondary: '#8C857A', // 辅助灰褐
  line: '#DDD9D2',      // 分隔线
} as const;

const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

function drawShareImage(
  echo: EchoData,
  courseName?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      const maxTextW = CARD_W - PAD_X * 2;
      const highlights = (echo.highlights || []).filter((h) => h.text.trim());
      const takeaway = echo.takeaway?.trim() || '';

      // ── 预量：使用临时 canvas 测量文字 ──
      canvas.width = CARD_W;
      canvas.height = 3000;

      // 正文
      ctx.font = `400 26px/1.85 ${FONT}`;
      const bodyLines = wrapText(ctx, echo.body, maxTextW);
      const bodyLineH = 48; // 26 * 1.85

      // 金句
      ctx.font = `italic 400 22px/1.75 ${FONT}`;
      const hlData = highlights.map((h) => ({
        ...h,
        lines: wrapText(ctx, h.text, maxTextW - 24), // 减去左边距
      }));

      // 带走
      ctx.font = `400 20px/1.75 ${FONT}`;
      const takeawayLines = takeaway ? wrapText(ctx, takeaway, maxTextW) : [];

      // ── 计算精确高度 ──
      const metaBlockH = courseName ? 72 : 44; // 日期 + 可选课程名
      const gapAfterMeta = 40;
      const bodyBlockH = bodyLines.length * bodyLineH;
      const hlBlockH = hlData.length > 0
        ? hlData.reduce((sum, h) => {
            const lh = 38; // 22 * 1.75
            const metaH = (h.timestamp || h.speaker) ? 24 : 0;
            return sum + h.lines.length * lh + metaH + 16;
          }, 0) + 32 // 上方间距
        : 0;
      const takeawayBlockH = takeawayLines.length > 0
        ? 32 + takeawayLines.length * 35 // 20 * 1.75
        : 0;
      const lineGap = 48;
      const brandH = 24;

      const totalH = PAD_TOP + metaBlockH + gapAfterMeta + bodyBlockH
        + hlBlockH + takeawayBlockH + lineGap + brandH + PAD_BOTTOM;

      // ── 正式绘制 ──
      canvas.width = CARD_W;
      canvas.height = Math.max(totalH, 500);

      // 背景：纯色，不渐变
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let y = PAD_TOP;

      // ── 元信息区：日期 + 课程名 ──
      const dateStr = new Date(echo.updatedAt || echo.createdAt).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      ctx.textAlign = 'left';
      ctx.fillStyle = COLOR.secondary;
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText(dateStr, PAD_X, y + 13);

      if (courseName) {
        y += 32;
        ctx.fillStyle = COLOR.secondary;
        ctx.font = `500 15px ${FONT}`;
        ctx.fillText(courseName, PAD_X, y + 15);
      }

      y += gapAfterMeta;

      // ── 正文 ──
      ctx.fillStyle = COLOR.ink;
      ctx.font = `400 26px ${FONT}`;
      for (const line of bodyLines) {
        y += bodyLineH;
        ctx.fillText(line, PAD_X, y);
      }

      // ── 金句区：左边一条竖线 + 斜体 ──
      if (hlData.length > 0) {
        y += 32;
        for (const hl of hlData) {
          const lh = 38;

          // 左侧竖线
          const lineTop = y + 6;
          const lineBot = y + hl.lines.length * lh + 6;
          ctx.strokeStyle = COLOR.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD_X, lineTop);
          ctx.lineTo(PAD_X, lineBot);
          ctx.stroke();

          // 金句文字
          ctx.fillStyle = COLOR.secondary;
          ctx.font = `italic 22px ${FONT}`;
          for (const line of hl.lines) {
            y += lh;
            ctx.fillText(line, PAD_X + 24, y);
          }

          // 时间戳/来源
          if (hl.timestamp || hl.speaker) {
            y += 4;
            ctx.fillStyle = COLOR.secondary;
            ctx.globalAlpha = 0.6;
            ctx.font = `400 12px ${FONT}`;
            const meta = [hl.speaker, hl.timestamp].filter(Boolean).join(' · ');
            ctx.fillText(meta, PAD_X + 24, y + 12);
            ctx.globalAlpha = 1.0;
            y += 16;
          }

          y += 16;
        }
      }

      // ── 一句话带走 ──
      if (takeawayLines.length > 0) {
        y += 32;
        ctx.fillStyle = COLOR.secondary;
        ctx.font = `400 20px ${FONT}`;
        const twLineH = 35;
        for (const line of takeawayLines) {
          y += twLineH;
          ctx.fillText(line, PAD_X, y);
        }
      }

      y += lineGap;

      // ── 分隔线：一根就够 ──
      ctx.strokeStyle = COLOR.line;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_X, y);
      ctx.lineTo(CARD_W - PAD_X, y);
      ctx.stroke();

      y += 32;

      // ── 品牌：右对齐，极轻 ──
      ctx.fillStyle = COLOR.secondary;
      ctx.globalAlpha = 0.5;
      ctx.font = `500 13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText('MeetMind', CARD_W - PAD_X, y + 13);
      ctx.globalAlpha = 1.0;

      // ── 裁切到实际高度 ──
      const finalH = y + 13 + PAD_BOTTOM;
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = CARD_W;
      finalCanvas.height = finalH;
      const fCtx = finalCanvas.getContext('2d')!;
      fCtx.fillStyle = COLOR.bg;
      fCtx.fillRect(0, 0, CARD_W, finalH);
      fCtx.drawImage(canvas, 0, 0, CARD_W, finalH, 0, 0, CARD_W, finalH);

      resolve(finalCanvas.toDataURL('image/png', 1.0));
    } catch (err) {
      reject(err);
    }
  });
}

/** 自动换行 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const allLines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      allLines.push('');
      continue;
    }
    let currentLine = '';
    for (const char of paragraph) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        allLines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      allLines.push(currentLine);
    }
  }
  return allLines;
}

// ── 主组件 ──────────────────────────────────────────
// 设计原则：打开即生成，长按保存，极简

export function EchoShareCard({ echo, courseName, open, onClose }: EchoShareCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!open) {
      setImageUrl(null);
      setError(false);
      return;
    }

    let cancelled = false;
    setGenerating(true);
    setError(false);

    drawShareImage(echo, courseName)
      .then((url) => {
        if (!cancelled) {
          setImageUrl(url);
          setGenerating(false);
        }
      })
      .catch((err) => {
        console.error('[EchoShareCard] 生成分享图失败', err);
        if (!cancelled) {
          setError(true);
          setGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, echo, courseName]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      {/* 关闭 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white/80"
        aria-label="关闭"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* 内容 */}
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col items-center px-6">
        {generating && (
          <div className="flex flex-col items-center gap-3 py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            <p className="text-sm text-white/40">生成中…</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-20">
            <p className="text-sm text-white/40">生成失败，请重试</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/60"
            >
              关闭
            </button>
          </div>
        )}

        {imageUrl && (
          <>
            <img
              ref={imgRef}
              src={imageUrl}
              alt="回声分享卡"
              className="w-full rounded-lg"
              style={{ maxHeight: '70vh', objectFit: 'contain' }}
            />
            <p className="mt-4 text-center text-xs text-white/30">
              长按图片保存到相册
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default EchoShareCard;
