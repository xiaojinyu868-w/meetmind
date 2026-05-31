'use client';

/**
 * ShareAgentCard — 分享 Agent 的 Canvas 长图（v3.0 SharedAgent）
 *
 * 第一性原理（v3.0 修正版）：
 *   分享图本身就是产物。学生收到图的那一刻，应该已经能从图里"看到内容"
 *   而不是被引导去点链接。链接是 fallback，不是主体。
 *
 * 因此本卡片按 artifactKind 走不同绘制策略：
 *   - cheatsheet     → 把速查表 6 区色块和核心要点直接画到图上
 *   - mindmap        → 画根节点 + 一级分支
 *   - quiz           → 画第一题（题干 + 4 选项），不暴露答案（强裂变：必须答才看分）
 *   - infographic    → 直接放产物图片
 *   - notes/chat-only→ 标题 + 一句引子
 *
 * 隐式规则：
 *   - 不在卡片正文里渲染 URL 文本（URL 走 navigator.share / clipboard，不是视觉主体）
 *   - 不显示电话号当昵称（dispatcher 已做兜底，这里再做一层防御）
 *   - 暖白底 + 深褐字（沿用 EchoShareCard 设计语言）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { COPY } from '@/lib/ui/copy';
import type {
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetItem,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

// ── 类型 ──────────────────────────────────────────

export interface ShareAgentCardData {
  title: string;
  subject?: string;
  artifactKind: string;
  /** 给图片用的简短摘要（fallback 模式下作为副标题） */
  hookLine?: string;
  /** 分享者展示昵称（已经过 dispatcher 兜底处理） */
  sharerNickname?: string;
  /** 公开 URL（不画在图里，仅给 navigator.share + clipboard 用） */
  shareUrl: string;
  /** 完整 artifact payload（result.render?.payload）—— 让卡片能画产物本身 */
  artifactPayload?: unknown;
}

interface ShareAgentCardProps {
  data: ShareAgentCardData;
  open: boolean;
  onClose: () => void;
}

// ── 设计 token ──────────────────────────────────────

const CARD_W = 750;
const PAD_X = 56;
const PAD_TOP = 64;
const PAD_BOTTOM = 64;

const COLOR = {
  bg: '#FAF7F2',
  bgInner: '#FFFFFF',
  ink: '#1C1B19',
  inkSecondary: '#5C5A55',
  secondary: '#5C5A55',
  line: '#E8E2D5',
} as const;

// 6 区 cheatsheet 色板（与 CheatsheetWindow 保持一致）
const SECTION_ACCENT: Record<string, { bar: string; tint: string; label: string }> = {
  definition: { bar: '#1C1B19', tint: '#F2EDE3', label: '#1C1B19' },
  formula:    { bar: '#B8842B', tint: '#FBF2EF', label: '#2D4F3E' },
  process:    { bar: '#2D4F3E', tint: '#F2F6F3', label: '#2D4F3E' },
  contrast:   { bar: '#2D4F3E', tint: '#F2F6F3', label: '#2D4F3E' },
  pitfall:    { bar: '#B5483C', tint: '#FCEFEF', label: '#B5483C' },
  exemplar:   { bar: '#2D4F3E', tint: '#F2F6F3', label: '#6C509C' },
};

const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

const ARTIFACT_BADGE: Record<string, string> = {
  cheatsheet: '考前速查表',
  mindmap: '思维导图',
  quiz: '课堂测验',
  flashcards: '课堂闪卡',
  infographic: '课堂信息图',
  'audio-overview': '课堂播客',
  notes: '同学版笔记',
  'chat-only': '一节课的对话',
};

// ── 通用工具 ──────────────────────────────────────

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = (text || '').split('\n');
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

/** 圆角矩形描边 */
function roundRectFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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
  ctx.fill();
}

// ── 头部 / 尾部（所有策略共用） ────────────────────

function drawHeader(
  ctx: CanvasRenderingContext2D,
  data: ShareAgentCardData,
  startY: number,
): number {
  const badge = ARTIFACT_BADGE[data.artifactKind] ?? '';
  const sharer = data.sharerNickname?.trim();

  let y = startY;

  // 角标（左上）：badge
  if (badge) {
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR.secondary;
    ctx.font = `600 11.5px ${FONT}`;
    const badgeText = badge.toUpperCase();
    ctx.fillText(badgeText, PAD_X, y + 12);
  }

  // 角标（右上）：来自谁——克制处理，没有就不画
  if (sharer) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR.secondary;
    ctx.font = `400 11.5px ${FONT}`;
    ctx.fillText(`来自 ${sharer}`, CARD_W - PAD_X, y + 12);
  }

  y += 28;
  return y;
}

function drawFooter(ctx: CanvasRenderingContext2D, y: number): number {
  // 一根分隔线 + 极轻品牌
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(CARD_W - PAD_X, y);
  ctx.stroke();
  y += 24;

  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.secondary;
  ctx.font = `400 11px ${FONT}`;
  ctx.fillText('扫码或点链接 · 跟同学聊聊这节课', PAD_X, y + 11);

  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.55;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText('MeetMind', CARD_W - PAD_X, y + 11);
  ctx.globalAlpha = 1;

  y += 14;
  return y;
}

// ── 策略 1：cheatsheet — 把 6 区速查表本身画上去 ────

function isCheatsheetPayload(p: unknown): p is CheatsheetPayload {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return Array.isArray(obj.sections);
}

function pickCheatsheetItem(section: CheatsheetSection): CheatsheetItem | null {
  if (!section.items || section.items.length === 0) return null;
  // 优先 emphasis === 'strong'
  const strong = section.items.find((it) => it.emphasis === 'strong');
  return strong ?? section.items[0];
}

function drawCheatsheet(
  ctx: CanvasRenderingContext2D,
  data: ShareAgentCardData,
  payload: CheatsheetPayload,
): void {
  let y = PAD_TOP;
  y = drawHeader(ctx, data, y);

  // 标题（来自 payload.title，比 data.title 更专业更专属）
  const title = (payload.title || data.title || '考前速查表').trim();
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.ink;
  ctx.font = `600 28px ${FONT}`;
  const titleLines = wrapText(ctx, title, CARD_W - PAD_X * 2);
  for (const line of titleLines) {
    y += 38;
    ctx.fillText(line, PAD_X, y);
  }

  // overview（淡色一行）
  if (payload.overview && payload.overview.trim()) {
    y += 18;
    ctx.fillStyle = COLOR.inkSecondary;
    ctx.font = `400 14px ${FONT}`;
    const overviewLines = wrapText(ctx, payload.overview.trim(), CARD_W - PAD_X * 2);
    for (const line of overviewLines.slice(0, 2)) {
      y += 22;
      ctx.fillText(line, PAD_X, y);
    }
  }

  y += 28;

  // 6 区色块——挑出有内容的 sections，每个最多渲染 1 条核心要点
  const usableSections = payload.sections
    .filter((s) => s.items && s.items.length > 0)
    .slice(0, 6);

  for (const section of usableSections) {
    const accent = SECTION_ACCENT[section.key] ?? SECTION_ACCENT.definition;
    const item = pickCheatsheetItem(section);
    if (!item) continue;

    const blockX = PAD_X;
    const blockW = CARD_W - PAD_X * 2;

    // 准备 term + body 的换行结果，提前算高度
    ctx.font = `600 14px ${FONT}`;
    const termLines = wrapText(ctx, item.term || section.label, blockW - 24);
    ctx.font = `400 13px ${FONT}`;
    const bodyLines = wrapText(ctx, item.body || '', blockW - 24).slice(0, 3);

    const labelH = 18;
    const termH = termLines.length * 20;
    const bodyH = bodyLines.length * 20;
    const blockH = labelH + 6 + termH + (bodyH > 0 ? 6 + bodyH : 0) + 16;

    // 区块底色（淡 tint）
    ctx.fillStyle = accent.tint;
    roundRectFill(ctx, blockX, y, blockW, blockH, 8);

    // 左侧实色 bar
    ctx.fillStyle = accent.bar;
    ctx.fillRect(blockX, y, 3, blockH);

    // section label（大写、字间距、accent 颜色）
    ctx.textAlign = 'left';
    ctx.fillStyle = accent.label;
    ctx.font = `700 10.5px ${FONT}`;
    ctx.fillText(section.label.toUpperCase(), blockX + 14, y + 14);

    // term（粗体）
    ctx.fillStyle = COLOR.ink;
    ctx.font = `600 14px ${FONT}`;
    let cursorY = y + labelH + 6;
    for (const line of termLines) {
      cursorY += 18;
      ctx.fillText(line, blockX + 14, cursorY);
    }

    // body（次级色）
    if (bodyLines.length > 0) {
      ctx.fillStyle = COLOR.inkSecondary;
      ctx.font = `400 13px ${FONT}`;
      cursorY += 6;
      for (const line of bodyLines) {
        cursorY += 18;
        ctx.fillText(line, blockX + 14, cursorY);
      }
    }

    y += blockH + 8;
  }

  y += 16;
  drawFooter(ctx, y);
}

// ── 策略 2：mindmap — 画根 + 一级分支 ────────────

interface MindmapPayload {
  root?: string;
  branches?: Array<{ label?: string; children?: Array<{ label?: string }> }>;
}

function isMindmapPayload(p: unknown): p is MindmapPayload {
  if (!p || typeof p !== 'object') return false;
  return 'root' in p || 'branches' in p;
}

function drawMindmap(
  ctx: CanvasRenderingContext2D,
  data: ShareAgentCardData,
  payload: MindmapPayload,
): void {
  let y = PAD_TOP;
  y = drawHeader(ctx, data, y);

  const root = (payload.root || data.title || '思维导图').trim();
  const branches = (payload.branches ?? []).slice(0, 6);

  // 标题
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.ink;
  ctx.font = `600 26px ${FONT}`;
  const rootLines = wrapText(ctx, root, CARD_W - PAD_X * 2);
  for (const line of rootLines.slice(0, 2)) {
    y += 36;
    ctx.fillText(line, PAD_X, y);
  }

  y += 32;

  // 分支：每个分支占一行，左侧小圆点 + label + 1-2 个子节点
  for (const branch of branches) {
    const label = (branch.label ?? '').trim();
    if (!label) continue;
    const children = (branch.children ?? [])
      .map((c) => (c.label ?? '').trim())
      .filter(Boolean)
      .slice(0, 2);

    // 圆点
    ctx.fillStyle = '#2D4F3E';
    ctx.beginPath();
    ctx.arc(PAD_X + 4, y + 6, 4, 0, Math.PI * 2);
    ctx.fill();

    // label
    ctx.fillStyle = COLOR.ink;
    ctx.font = `600 15px ${FONT}`;
    const labelLines = wrapText(ctx, label, CARD_W - PAD_X * 2 - 18);
    let cy = y;
    for (const line of labelLines.slice(0, 1)) {
      cy += 12;
      ctx.fillText(line, PAD_X + 18, cy);
    }

    // 子节点
    if (children.length > 0) {
      ctx.fillStyle = COLOR.inkSecondary;
      ctx.font = `400 12.5px ${FONT}`;
      cy += 18;
      ctx.fillText(`└ ${children.join(' · ')}`.slice(0, 50), PAD_X + 18, cy);
    }

    y = cy + 18;
  }

  y += 12;
  drawFooter(ctx, y);
}

// ── 策略 3：quiz — 画第一题（不显示答案） ────────

interface QuizQuestion {
  stem?: string;
  options?: string[] | Array<{ label?: string; text?: string }>;
}
interface QuizPayload {
  questions?: QuizQuestion[];
  items?: QuizQuestion[];
}

function extractFirstQuestion(p: unknown): QuizQuestion | null {
  if (!p || typeof p !== 'object') return null;
  const obj = p as QuizPayload;
  const arr = obj.questions ?? obj.items;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0];
}

function drawQuiz(
  ctx: CanvasRenderingContext2D,
  data: ShareAgentCardData,
  question: QuizQuestion,
): void {
  let y = PAD_TOP;
  y = drawHeader(ctx, data, y);

  // 大标签 "试一题"
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.secondary;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText('试一道这节课的题', PAD_X, y + 13);
  y += 30;

  // 题干
  const stem = (question.stem ?? data.title ?? '').trim();
  ctx.fillStyle = COLOR.ink;
  ctx.font = `600 22px ${FONT}`;
  const stemLines = wrapText(ctx, stem, CARD_W - PAD_X * 2);
  for (const line of stemLines.slice(0, 4)) {
    y += 32;
    ctx.fillText(line, PAD_X, y);
  }

  y += 28;

  // 选项 A/B/C/D
  const rawOptions = question.options ?? [];
  const labels = ['A', 'B', 'C', 'D'];
  rawOptions.slice(0, 4).forEach((opt, i) => {
    const text = typeof opt === 'string' ? opt : (opt.text ?? opt.label ?? '');
    const optLines = wrapText(ctx, text, CARD_W - PAD_X * 2 - 36);

    // 选项底卡
    const optH = optLines.length * 22 + 16;
    ctx.fillStyle = '#FBFAF5';
    roundRectFill(ctx, PAD_X, y, CARD_W - PAD_X * 2, optH, 10);

    // 字母圈
    ctx.fillStyle = COLOR.ink;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(`${labels[i]}.`, PAD_X + 14, y + 24);

    // 选项文字
    ctx.fillStyle = COLOR.inkSecondary;
    ctx.font = `400 14px ${FONT}`;
    let cy = y + 9;
    for (const line of optLines) {
      cy += 20;
      ctx.fillText(line, PAD_X + 36, cy);
    }

    y += optH + 8;
  });

  y += 8;

  // 提示语：扫码答完才看结果（强裂变）
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.secondary;
  ctx.font = `italic 12.5px ${FONT}`;
  ctx.fillText('选好了？打开链接告诉同学，他会跟你对答案 · 还有更多题', PAD_X, y + 12);
  y += 26;

  drawFooter(ctx, y);
}

// ── 策略 4：fallback（标题 + hookLine，不放 URL） ──

function drawFallback(
  ctx: CanvasRenderingContext2D,
  data: ShareAgentCardData,
): void {
  let y = PAD_TOP;
  y = drawHeader(ctx, data, y);

  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.ink;
  ctx.font = `600 28px ${FONT}`;
  const titleLines = wrapText(ctx, (data.title || '一节课').trim(), CARD_W - PAD_X * 2);
  for (const line of titleLines.slice(0, 3)) {
    y += 40;
    ctx.fillText(line, PAD_X, y);
  }

  if (data.hookLine && data.hookLine.trim()) {
    y += 24;
    ctx.fillStyle = COLOR.inkSecondary;
    ctx.font = `italic 16px ${FONT}`;
    const hookLines = wrapText(ctx, data.hookLine.trim(), CARD_W - PAD_X * 2);
    for (const line of hookLines.slice(0, 4)) {
      y += 26;
      ctx.fillText(line, PAD_X, y);
    }
  }

  y += 36;
  drawFooter(ctx, y);
}

// ── 主绘制（按 artifactKind 分发） ──────────────

function drawShareImage(data: ShareAgentCardData): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      // 给一个充裕的初始高度，最后再裁到实际内容高度
      canvas.width = CARD_W;
      canvas.height = 2200;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // 背景
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, CARD_W, canvas.height);

      // 分发
      if (data.artifactKind === 'cheatsheet' && isCheatsheetPayload(data.artifactPayload)) {
        drawCheatsheet(ctx, data, data.artifactPayload);
      } else if (data.artifactKind === 'mindmap' && isMindmapPayload(data.artifactPayload)) {
        drawMindmap(ctx, data, data.artifactPayload);
      } else if (data.artifactKind === 'quiz') {
        const q = extractFirstQuestion(data.artifactPayload);
        if (q) {
          drawQuiz(ctx, data, q);
        } else {
          drawFallback(ctx, data);
        }
      } else {
        drawFallback(ctx, data);
      }

      // 找到实际末端 y——通过最后一笔位置不好拿，用统一策略：
      // 我们让 fallback / 各策略都靠 drawFooter 收尾，footer 的最后一行 y 大概等于
      // ctx.measureText 之后的位置。简便办法：扫描像素找最底部非背景像素。
      // 但成本太高——这里用一个稳妥策略：保留充足的下边距裁掉空白：
      // 取 imageData 找最后一行非 bg 像素。
      const imgData = ctx.getImageData(0, 0, CARD_W, canvas.height);
      let lastNonEmptyY = 0;
      const data8 = imgData.data;
      // 背景 RGB 247/245/241
      for (let yy = canvas.height - 1; yy >= 0; yy -= 1) {
        for (let xx = 0; xx < CARD_W; xx += 8) {
          const idx = (yy * CARD_W + xx) * 4;
          const r = data8[idx];
          const g = data8[idx + 1];
          const b = data8[idx + 2];
          if (Math.abs(r - 247) > 5 || Math.abs(g - 245) > 5 || Math.abs(b - 241) > 5) {
            lastNonEmptyY = yy;
            yy = -1; // break outer
            break;
          }
        }
      }

      const finalH = Math.min(canvas.height, lastNonEmptyY + PAD_BOTTOM);
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = CARD_W;
      finalCanvas.height = Math.max(finalH, 600);
      const fCtx = finalCanvas.getContext('2d')!;
      fCtx.fillStyle = COLOR.bg;
      fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
      fCtx.drawImage(canvas, 0, 0);

      resolve(finalCanvas.toDataURL('image/png', 1.0));
    } catch (err) {
      reject(err);
    }
  });
}

// ── 主组件 ──────────────────────────────────────

export function ShareAgentCard({ data, open, onClose }: ShareAgentCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const fileName = useMemo(() => {
    const safeTitle = (data.title || 'share').replace(/[^\u4e00-\u9fa5\w-]+/g, '-').slice(0, 40) || 'share';
    return `meetmind-${data.artifactKind}-${safeTitle}.png`;
  }, [data.artifactKind, data.title]);

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
                className="rounded-full bg-white px-4 py-2.5 text-[13px] font-medium text-[#1C1B19] transition hover:bg-[#FAF7F2] active:scale-[0.99]"
              >
                {COPY.echoShare.saveImage}
              </button>
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={sharing}
                className="rounded-full bg-[#1C1B19] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#111111] active:scale-[0.99] disabled:opacity-60"
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
            {/* 闭环管理面入口（v3.0）：让 A 知道还能回头管理已发布的分享 */}
            <a
              href="/me/shares"
              target="_blank"
              rel="noreferrer"
              className="mt-1 text-[11px] text-white/30 underline-offset-2 transition hover:text-white/55 hover:underline"
            >
              管理我的分享 ›
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default ShareAgentCard;
