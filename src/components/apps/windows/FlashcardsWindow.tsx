'use client';

import { useMemo, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';

interface FlashcardsWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

interface FlashcardItem {
  id: string;
  title?: string;
  front: string;
  back: string;
  hint?: string;
}

function normalizeCards(result: AppExecutionResult | null): FlashcardItem[] {
  if (!result) return [];
  const payload = result.render?.payload as { cards?: Array<Record<string, unknown>> } | undefined;
  const cardsFromPayload = Array.isArray(payload?.cards)
    ? payload.cards
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : `payload-card-${index + 1}`,
          title: typeof item.title === 'string' ? item.title : `闪卡 ${index + 1}`,
          front: typeof item.front === 'string' ? item.front : '',
          back: typeof item.back === 'string' ? item.back : '',
          hint: typeof item.hint === 'string' ? item.hint : undefined,
        }))
        .filter((item) => item.front && item.back)
    : [];

  if (cardsFromPayload.length > 0) return cardsFromPayload;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'flashcard')
    .map((card, index) => ({
      id: card.id,
      title: card.title || `闪卡 ${index + 1}`,
      front: typeof card.meta?.front === 'string' ? card.meta.front : card.body,
      back: typeof card.meta?.back === 'string' ? card.meta.back : '',
      hint: typeof card.meta?.hint === 'string' ? card.meta.hint : undefined,
    }))
    .filter((item) => item.front && item.back);
}

type MasteryScore = 'hard' | 'ok' | 'good';

export function FlashcardsWindow({ result, transcript, onSeek }: FlashcardsWindowProps) {
  const cards = useMemo(() => normalizeCards(result), [result]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [scores, setScores] = useState<Record<string, MasteryScore>>({});

  if (!result) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在生成闪卡...</div>;
  }

  if (cards.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">未获得可训练闪卡，请重新生成。</div>;
  }

  const current = cards[Math.min(index, cards.length - 1)];
  const related = result.cards.find((card) => card.id === current.id);
  const citation = related?.citations?.[0];

  const score = (value: MasteryScore) => {
    setScores((prev) => ({ ...prev, [current.id]: value }));
    setFlipped(false);
    setIndex((prev) => (prev < cards.length - 1 ? prev + 1 : prev));
  };

  const doneCount = Object.keys(scores).length;
  const progress = Math.round((doneCount / cards.length) * 100);

  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" data-testid="flashcards-window">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            训练进度 {index + 1}/{cards.length}
          </p>
          <p className="text-xs text-slate-500">完成度 {progress}%</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-500">{current.title}</p>
          <p className="mt-2 text-lg font-semibold leading-8 text-slate-900">{flipped ? current.back : current.front}</p>
          {!flipped && current.hint ? <p className="mt-3 text-sm text-slate-500">提示：{current.hint}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
            <button
              type="button"
              onClick={() => setFlipped((value) => !value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              {flipped ? '看问题' : '翻面看答案'}
            </button>
          </div>
        </div>

        {flipped ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700" onClick={() => score('hard')}>
              还没掌握
            </button>
            <button className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600" onClick={() => score('ok')}>
              一般
            </button>
            <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700" onClick={() => score('good')}>
              掌握了
            </button>
          </div>
        ) : null}
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">训练记录</p>
        <div className="mt-3 space-y-2">
          {cards.map((card, cardIndex) => (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                setIndex(cardIndex);
                setFlipped(false);
              }}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="truncate pr-2 text-sm text-slate-700">{card.title || `闪卡 ${cardIndex + 1}`}</span>
              <span className="text-xs text-slate-500">
                {scores[card.id] === 'good' ? '已掌握' : scores[card.id] === 'ok' ? '一般' : scores[card.id] === 'hard' ? '待加强' : '未练'}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}
