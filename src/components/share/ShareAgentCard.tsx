'use client';

/**
 * ShareAgentCard — 分享 Agent 的 Canvas 长图（v3.0 SharedAgent）
 *
 * 设计哲学（沿用 EchoShareCard）：
 *   - 大留白、暖白底、深褐字
 *   - 一根分隔线就够
 *   - 不堆装饰，靠版式和字体层级支撑高级感
 *
 * 比 EchoShareCard 多出来的：分享 URL 显式可读（保存到相册后能照着输入）
 * 暂不画二维码（避免新增 qrcode 依赖；v0 用 URL 文本承载）。
 *
 * 触发方式：分享创建成功后弹出此卡片，用户长按保存或调系统分享。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { COPY } from '@/lib/ui/copy';

// ── 类型 ──────────────────────────────────────────

export interface ShareAgentCardData {
  title: string;
  subject?: string;
  artifactKind: string;
  /** 给图片用的简短摘要（1-2 句，描述这节课讲了什么） */
  hookLine?: string;
  /** 分享者展示昵称 */
  sharerNickname?: string;
  /** 公开 URL（落地页地址） */
  shareUrl: string;
}

interface ShareAgentCardProps {
  data: ShareAgentCardData;
  open: boolean;
  onClose: () => void;
}

// ── 设计常量 ──────────────────────────────────────

const CARD_W = 750;
const PAD_X = 80;
const PAD_TOP = 96;
const PAD_BOTTOM = 88;

const COLOR = {
  bg: '#F7F5F1', // 暖白
  ink: '#2C2825', // 深褐
  secondary: '#8C857A', // 辅助灰褐
  line: '#DDD9D2',
} as const;

const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

const ARTIFACT_LABELS: Record<string, string> = {
  cheatsheet: '考前速查表',
  mindmap: '思维导图',
  quiz: '课堂测验',
  flashcards: '课堂闪卡',
  infographic: '课堂信息图',
  'audio-overview': '课堂播客',
  notes: '同学版笔记',
  'chat-only': '可以直接聊',
};

// ── 绘制 ──────────────────────────────────────────

function drawShareImage(data: ShareAgentCardData): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      const maxTextW = CARD_W - PAD_X * 2;

      canvas.width = CARD_W;
      canvas.height = 1800; // 临时高度，最后裁切

      // 标题 (大号粗体)
      ctx.font = `600 32px/1.4 ${FONT}`;
      const titleLines = wrapText(ctx, data.title, maxTextW);
      const titleLineH = 45;

      // hook line (中等斜体)
      ctx.font = `italic 400 20px/1.7 ${FONT}`;
      const hookLines = data.hookLine ? wrapText(ctx, data.hookLine, maxTextW) : [];
      const hookLineH = 34;

      // url
      ctx.font = `500 13px ${FONT}`;
      const urlLines = wrapText(ctx, data.shareUrl, maxTextW);

      const sharer = data.sharerNickname?.trim() || '一位同学';
      const artifactLabel = ARTIFACT_LABELS[data.artifactKind] ?? '一份分享';

      // 计算总高
      let estH = PAD_TOP;
      estH += 32; // sharer 行
      estH += 8;
      estH += 20; // artifact label
      estH += 36;
      estH += titleLines.length * titleLineH;
      if (hookLines.length > 0) {
        estH += 28 + hookLines.length * hookLineH;
      }
      estH += 56; // 分隔线
      estH += 20; // "扫码 / 链接" 标签
      estH += 24;
      estH += urlLines.length * 22;
      estH += 24;
      estH += 18; // 品牌
      estH += PAD_BOTTOM;

      canvas.width = CARD_W;
      canvas.height = Math.max(estH, 600);

      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let y = PAD_TOP;
      ctx.textAlign = 'left';

      // 分享者
      ctx.fillStyle = COLOR.secondary;
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText(`${sharer} 听完了一节课，留了一份给你`, PAD_X, y + 13);
      y += 32;

      // artifact label
      ctx.fillStyle = COLOR.secondary;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(artifactLabel.toUpperCase(), PAD_X, y + 12);
      y += 36;

      // 标题
      ctx.fillStyle = COLOR.ink;
      ctx.font = `600 32px ${FONT}`;
      for (const line of titleLines) {
        y += titleLineH;
        ctx.fillText(line, PAD_X, y);
      }

      // hook line
      if (hookLines.length > 0) {
        y += 28;
        ctx.fillStyle = COLOR.secondary;
        ctx.font = `italic 20px ${FONT}`;
        for (const line of hookLines) {
          y += hookLineH;
          ctx.fillText(line, PAD_X, y);
        }
      }

      // 分隔线
      y += 56;
      ctx.strokeStyle = COLOR.line;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(PAD_X, y);
      ctx.lineTo(CARD_W - PAD_X, y);
      ctx.stroke();
      y += 20;

      // 链接标签 + URL
      ctx.fillStyle = COLOR.secondary;
      ctx.font = `500 11px ${FONT}`;
      ctx.fillText('打开这条链接，跟同学聊聊这节课', PAD_X, y + 11);
      y += 24;

      ctx.fillStyle = COLOR.ink;
      ctx.font = `500 13px ${FONT}`;
      for (const line of urlLines) {
        ctx.fillText(line, PAD_X, y + 13);
        y += 22;
      }

      // 品牌
      y += 24;
      ctx.fillStyle = COLOR.secondary;
      ctx.globalAlpha = 0.5;
      ctx.font = `500 13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText('MeetMind', CARD_W - PAD_X, y + 13);
      ctx.globalAlpha = 1;

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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const char of paragraph) {
      const test = cur + char;
      if (ctx.measureText(test).width > maxWidth && cur.length > 0) {
        lines.push(cur);
        cur = char;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

async function dataUrlToFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

// ── 主组件 ──────────────────────────────────────────

export function ShareAgentCard({ data, open, onClose }: ShareAgentCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const fileName = useMemo(() => {
    const safeTitle = data.title.replace(/[^\u4e00-\u9fa5\w-]+/g, '-').slice(0, 40) || 'share';
    return `meetmind-share-${safeTitle}.png`;
  }, [data.title]);

  useEffect(() => {
    if (!open) {
      setImageUrl(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setGenerating(true);
    setError(false);

    drawShareImage(data)
      .then((url) => {
        if (!cancelled) {
          setImageUrl(url);
          setGenerating(false);
        }
      })
      .catch((err) => {
        console.error('[ShareAgentCard] 生成失败', err);
        if (!cancelled) {
          setError(true);
          setGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, data]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const copyShareUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success(COPY.share.creator.doneCopied);
    } catch {
      toast.error('复制失败');
    }
  }, [data.shareUrl]);

  const handleSave = useCallback(() => {
    if (!imageUrl) return;
    try {
      const a = document.createElement('a');
      a.href = imageUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(COPY.echoShare.saved);
    } catch {
      toast.error(COPY.echoShare.saveFallback);
    }
  }, [fileName, imageUrl]);

  const handleNativeShare = useCallback(async () => {
    if (!imageUrl || sharing) return;
    setSharing(true);
    try {
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      const file = await dataUrlToFile(imageUrl, fileName);
      const dataWithFile: ShareData = {
        title: data.title,
        text: `${data.title} · MeetMind`,
        url: data.shareUrl,
        files: [file],
      };
      if (nav.share && (!nav.canShare || nav.canShare(dataWithFile))) {
        await nav.share(dataWithFile);
        return;
      }
      if (nav.share) {
        await nav.share({ title: data.title, url: data.shareUrl });
        return;
      }
      await copyShareUrl();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copyShareUrl();
    } finally {
      setSharing(false);
    }
  }, [copyShareUrl, data, fileName, imageUrl, sharing]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition hover:text-white/80"
        aria-label="关闭"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex max-h-[80vh] w-full max-w-sm flex-col items-center px-6">
        {generating && (
          <div className="flex flex-col items-center gap-3 py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            <p className="text-sm text-white/40">{COPY.share.creator.submitting}</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-20">
            <p className="text-sm text-white/40">{COPY.echoShare.error}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/60"
            >
              {COPY.echoShare.close}
            </button>
          </div>
        )}

        {imageUrl && (
          <>
            <img
              ref={imgRef}
              src={imageUrl}
              alt={data.title}
              className="w-full rounded-lg"
              style={{ maxHeight: '62vh', objectFit: 'contain' }}
            />
            <div className="mt-4 grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="rounded-full bg-white px-4 py-2.5 text-[13px] font-medium text-[#232322] transition hover:bg-[#F7F7F5] active:scale-[0.99]"
              >
                {COPY.echoShare.saveImage}
              </button>
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={sharing}
                className="rounded-full bg-[#232322] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#111111] active:scale-[0.99] disabled:opacity-60"
              >
                {sharing ? COPY.echoShare.sharing : COPY.share.creator.doneShare}
              </button>
              <button
                type="button"
                onClick={copyShareUrl}
                className="col-span-2 rounded-full border border-white/14 px-4 py-2 text-[12px] font-medium text-white/70 transition hover:border-white/24 hover:text-white"
              >
                {COPY.share.creator.doneCopy}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-white/30">{COPY.echoShare.hint}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default ShareAgentCard;
