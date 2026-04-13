'use client';

/**
 * StudyReportWindow — 学习报告
 *
 * 规则：所有随堂检验完成后才生成报告，否则显示进度引导。
 * 数据来源：答题结果（真实数据，不编造）
 * 分享：Canvas 绘制分享图 → 长按保存
 */

import { useCallback, useMemo, useState } from 'react';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckRound } from '@/hooks/useClassCheck';
import type { ClassCheckPlan } from '@/app/api/class-check/plan/route';

interface StudyReportWindowProps {
  rounds: ClassCheckRound[] | undefined;
  plan: ClassCheckPlan | null | undefined;
  transcript: TranscriptSegment[];
}

interface TopicStat {
  topic: string;
  correct: number;
  total: number;
  wrongStems: string[];
}

function normalizeAnswer(answer: string, options: string[]): string {
  const t = answer.trim();
  if (!t) return '';
  const m = t.match(/^([A-Za-z])[.、)\s]*$/);
  if (m) { const i = m[1].toUpperCase().charCodeAt(0) - 65; if (i >= 0 && i < options.length) return options[i]; }
  return options.find((o) => o.toLowerCase() === t.toLowerCase())
    || options.find((o) => { const s = o.replace(/^[A-Za-z][.、)\s]+/, '').trim(); return s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase()); })
    || t;
}

function pctColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 60) return '#f59e0b';
  return '#ef4444';
}

function pctLabel(pct: number): string {
  if (pct >= 100) return '全对';
  if (pct >= 80) return '掌握良好';
  if (pct >= 60) return '基本掌握';
  return '需要巩固';
}

// ── Canvas 分享图 ──

const CARD_W = 750;
const PAD_X = 64;
const PAD_TOP = 72;
const PAD_BOTTOM = 56;
const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';
const C = { bg: '#F7F5F1', ink: '#2C2825', sub: '#8C857A', line: '#DDD9D2', green: '#10b981', amber: '#f59e0b', red: '#ef4444', greenBg: '#E6F7EE', amberBg: '#FEF6E0', redBg: '#FDE8E8' };

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let cur = '';
    for (const ch of para) { const test = cur + ch; if (ctx.measureText(test).width > maxW && cur.length > 0) { lines.push(cur); cur = ch; } else cur = test; }
    if (cur) lines.push(cur);
  }
  return lines;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawShareImage(title: string, accuracy: number, totalCorrect: number, totalQuestions: number, topicStats: TopicStat[]): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas')); return; }
      const maxW = CARD_W - PAD_X * 2;
      canvas.width = CARD_W; canvas.height = 2000;

      ctx.font = `500 22px ${FONT}`;
      const titleLines = wrapText(ctx, title, maxW - 100);
      const headerH = Math.max(titleLines.length * 32, 68) + 24;
      const topicRowH = 48;
      const topicsH = topicStats.length * topicRowH + 40;
      const weakTopics = topicStats.filter((s) => s.total > 0 && s.correct / s.total < 0.8);
      const weakH = weakTopics.length > 0 ? 36 + weakTopics.reduce((h, w) => h + 28 + Math.min(w.wrongStems.length, 2) * 22 + 12, 0) : 0;
      const totalH = PAD_TOP + headerH + 56 + topicsH + weakH + 48 + PAD_BOTTOM;
      canvas.height = Math.max(totalH, 400);

      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = PAD_TOP;

      ctx.textAlign = 'left'; ctx.fillStyle = C.sub; ctx.font = `400 13px ${FONT}`;
      ctx.fillText('学习报告', PAD_X, y + 13); y += 28;
      ctx.fillStyle = C.ink; ctx.font = `500 22px ${FONT}`;
      for (const line of titleLines) { ctx.fillText(line, PAD_X, y + 22); y += 32; }

      const ringCx = CARD_W - PAD_X - 40; const ringCy = PAD_TOP + 40; const ringR = 32;
      ctx.lineWidth = 5; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = pctColor(accuracy); ctx.lineCap = 'round'; ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + (accuracy / 100) * Math.PI * 2); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = pctColor(accuracy); ctx.font = `700 18px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(`${accuracy}%`, ringCx, ringCy + 6); ctx.textAlign = 'left'; y += 8;

      const sumBg = accuracy >= 80 ? C.greenBg : accuracy >= 60 ? C.amberBg : C.redBg;
      ctx.fillStyle = sumBg; roundedRect(ctx, PAD_X, y, maxW, 44, 12); ctx.fill();
      ctx.fillStyle = pctColor(accuracy); ctx.font = `600 15px ${FONT}`;
      ctx.fillText(`${totalCorrect}/${totalQuestions} 题正确 · ${pctLabel(accuracy)}`, PAD_X + 16, y + 28);
      y += 44 + 24;

      ctx.strokeStyle = C.line; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(PAD_X, y); ctx.lineTo(CARD_W - PAD_X, y); ctx.stroke(); y += 20;

      for (const stat of topicStats) {
        const p = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
        ctx.fillStyle = C.ink; ctx.font = `400 15px ${FONT}`; ctx.fillText(stat.topic, PAD_X, y + 15);
        ctx.fillStyle = pctColor(p); ctx.font = `600 13px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText(`${stat.correct}/${stat.total}`, CARD_W - PAD_X, y + 15); ctx.textAlign = 'left'; y += 24;
        ctx.fillStyle = '#E8E6E1'; roundedRect(ctx, PAD_X, y, maxW, 6, 3); ctx.fill();
        const fillW = Math.max((p / 100) * maxW, 6); ctx.fillStyle = pctColor(p); roundedRect(ctx, PAD_X, y, fillW, 6, 3); ctx.fill();
        y += 6 + topicRowH - 30;
      }

      if (weakTopics.length > 0) {
        y += 8; ctx.strokeStyle = C.line; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(PAD_X, y); ctx.lineTo(CARD_W - PAD_X, y); ctx.stroke(); y += 20;
        ctx.fillStyle = C.sub; ctx.font = `500 13px ${FONT}`; ctx.fillText('需要巩固', PAD_X, y + 13); y += 28;
        for (const w of weakTopics) {
          ctx.fillStyle = C.red; ctx.font = `500 14px ${FONT}`; ctx.fillText(`• ${w.topic}`, PAD_X + 4, y + 14); y += 24;
          ctx.fillStyle = C.sub; ctx.font = `400 12px ${FONT}`;
          for (const stem of w.wrongStems.slice(0, 2)) { ctx.fillText(stem.length > 45 ? stem.slice(0, 45) + '…' : stem, PAD_X + 20, y + 12); y += 20; }
          y += 8;
        }
      }

      y += 24; ctx.strokeStyle = C.line; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(PAD_X, y); ctx.lineTo(CARD_W - PAD_X, y); ctx.stroke(); y += 24;
      ctx.fillStyle = C.sub; ctx.globalAlpha = 0.5; ctx.font = `500 13px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('MeetMind', CARD_W - PAD_X, y + 13); ctx.globalAlpha = 1; ctx.textAlign = 'left';

      const finalH = y + 13 + PAD_BOTTOM;
      const fc = document.createElement('canvas'); fc.width = CARD_W; fc.height = finalH;
      const fCtx = fc.getContext('2d')!; fCtx.fillStyle = C.bg; fCtx.fillRect(0, 0, CARD_W, finalH);
      fCtx.drawImage(canvas, 0, 0, CARD_W, finalH, 0, 0, CARD_W, finalH);
      resolve(fc.toDataURL('image/png', 1.0));
    } catch (err) { reject(err); }
  });
}

// ── 主组件 ──

export function StudyReportWindow({ rounds, plan }: StudyReportWindowProps) {
  const safeRounds = rounds || [];
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareGenerating, setShareGenerating] = useState(false);

  const totalCheckpoints = plan?.checkpoints.length || 0;
  // 已完成的 checkpoint：有对应 round 的 checkpoint
  const completedCheckpointIndices = useMemo(() => {
    const set = new Set<number>();
    for (const r of safeRounds) set.add(r.checkpointIndex);
    return set;
  }, [safeRounds]);
  const completedCount = completedCheckpointIndices.size;
  const allDone = totalCheckpoints > 0 && completedCount >= totalCheckpoints;

  const { totalCorrect, totalQuestions, topicStats } = useMemo(() => {
    let correct = 0; let total = 0;
    const map = new Map<number, TopicStat>();
    for (const round of safeRounds) {
      correct += round.result.correctCount; total += round.result.totalCount;
      const cpIdx = round.checkpointIndex;
      const name = plan?.checkpoints[cpIdx]?.topic || `知识点 ${cpIdx + 1}`;
      if (!map.has(cpIdx)) map.set(cpIdx, { topic: name, correct: 0, total: 0, wrongStems: [] });
      const s = map.get(cpIdx)!;
      s.correct += round.result.correctCount; s.total += round.result.totalCount;
      for (const q of round.result.questions) {
        const ua = round.result.answers[q.id]; const ca = normalizeAnswer(q.answer, q.options);
        if (ua && ua !== ca) s.wrongStems.push(q.stem);
      }
    }
    return { totalCorrect: correct, totalQuestions: total, topicStats: Array.from(map.values()) };
  }, [safeRounds, plan]);

  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const title = plan?.title || '课堂学习';

  const handleShare = useCallback(() => {
    setShareOpen(true); setShareGenerating(true);
    drawShareImage(title, accuracy, totalCorrect, totalQuestions, topicStats)
      .then((url) => { setShareUrl(url); setShareGenerating(false); })
      .catch(() => { setShareGenerating(false); });
  }, [title, accuracy, totalCorrect, totalQuestions, topicStats]);

  // ── 没有 plan → 还没开始 ──
  if (!plan || totalCheckpoints === 0) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-5 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F7F7F5]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A3A39E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" />
          </svg>
        </div>
        <div className="text-center max-w-[280px]">
          <p className="text-[15px] font-semibold text-[#232322]">播放视频开始学习</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-[#A3A39E]">
            AI 会在合适的节点弹出知识点检验，全部完成后自动生成学习报告
          </p>
        </div>
      </div>
    );
  }

  // ── 未全部完成 → 进度引导 ──
  if (!allDone) {
    const progressPct = totalCheckpoints > 0 ? Math.round((completedCount / totalCheckpoints) * 100) : 0;
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-5 p-8">
        <div className="relative" style={{ width: 80, height: 80 }}>
          <svg className="-rotate-90" width={80} height={80} viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#F0F0EE" strokeWidth="5" />
            <circle cx="40" cy="40" r="34" fill="none"
              stroke="#E67E22" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${progressPct * 2.136} 213.6`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[16px] font-bold text-[#E67E22]">{completedCount}/{totalCheckpoints}</span>
          </div>
        </div>
        <div className="text-center max-w-[280px]">
          <p className="text-[15px] font-semibold text-[#232322]">检验进行中</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-[#A3A39E]">
            还有 {totalCheckpoints - completedCount} 个知识点未检验，继续播放视频完成全部检验后生成报告
          </p>
        </div>
        {/* 已完成的知识点列表 */}
        {completedCount > 0 && (
          <div className="w-full max-w-[280px] space-y-1.5">
            {plan.checkpoints.map((cp, i) => {
              const done = completedCheckpointIndices.has(i);
              return (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  {done ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-[#E9E9E7]" />
                  )}
                  <span className={done ? 'text-[#232322]' : 'text-[#A3A39E]'}>{cp.topic}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── 全部完成 → 报告 ──
  return (
    <>
      <div className="mx-auto max-w-md px-2 pb-8">
        <div className="rounded-2xl border border-[#E9E9E7] bg-white overflow-hidden">
          <div className="px-6 pt-6 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium tracking-wide text-[#A3A39E]">学习报告</p>
                <p className="mt-1 text-[17px] font-bold text-[#232322] leading-snug">{title}</p>
                <p className="mt-2 text-[13px] text-[#787774]">{totalCheckpoints} 个知识点 · {totalQuestions} 道题</p>
              </div>
              <div className="relative shrink-0" style={{ width: 68, height: 68 }}>
                <svg className="-rotate-90" width={68} height={68} viewBox="0 0 68 68">
                  <circle cx="34" cy="34" r="28" fill="none" stroke="#F0F0EE" strokeWidth="5" />
                  <circle cx="34" cy="34" r="28" fill="none" stroke={pctColor(accuracy)} strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={`${accuracy * 1.76} 176`} style={{ transition: 'stroke-dasharray 0.6s ease-out' }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[16px] font-bold" style={{ color: pctColor(accuracy) }}>{accuracy}<span className="text-[11px]">%</span></span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5"
              style={{ backgroundColor: accuracy >= 80 ? '#ECFDF5' : accuracy >= 60 ? '#FFFBEB' : '#FEF2F2' }}>
              <span className="text-[13px] font-semibold" style={{ color: pctColor(accuracy) }}>{totalCorrect}/{totalQuestions} 题正确</span>
              <span className="text-[12px]" style={{ color: pctColor(accuracy) }}>· {pctLabel(accuracy)}</span>
            </div>
          </div>

          <div className="mx-6 h-px bg-[#E9E9E7]" />

          <div className="px-6 py-5 space-y-3">
            {topicStats.map((stat, i) => {
              const p = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-[#232322]">{stat.topic}</span>
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: pctColor(p) }}>{stat.correct}/{stat.total}</span>
                  </div>
                  <div className="h-[6px] rounded-full bg-[#F0F0EE] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(p, 4)}%`, backgroundColor: pctColor(p), transition: 'width 0.5s ease-out' }} />
                  </div>
                  {stat.wrongStems.length > 0 && (
                    <p className="mt-1 text-[11px] text-[#A3A39E]">
                      {stat.wrongStems.length === 1 ? (stat.wrongStems[0].length > 36 ? stat.wrongStems[0].slice(0, 36) + '…' : stat.wrongStems[0]) : `${stat.wrongStems.length} 题需巩固`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mx-6 h-px bg-[#E9E9E7]" />
          <div className="px-6 py-4 flex items-center justify-between">
            <p className="text-[11px] text-[#A3A39E]">MeetMind</p>
            <button type="button" onClick={handleShare}
              className="flex items-center gap-1.5 rounded-xl border border-[#E9E9E7] px-3.5 py-2 text-[12px] font-medium text-[#232322] transition-colors hover:bg-[#F7F7F5] active:bg-[#F0F0EE]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span>分享报告</span>
            </button>
          </div>
        </div>
      </div>

      {shareOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) { setShareOpen(false); setShareUrl(null); } }}>
          <button type="button" onClick={() => { setShareOpen(false); setShareUrl(null); }}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:text-white/80" aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col items-center px-6">
            {shareGenerating && (
              <div className="flex flex-col items-center gap-3 py-20">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                <p className="text-sm text-white/40">生成中…</p>
              </div>
            )}
            {shareUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shareUrl} alt="学习报告" className="w-full rounded-lg" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
                <p className="mt-4 text-center text-xs text-white/30">长按图片保存到相册</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
