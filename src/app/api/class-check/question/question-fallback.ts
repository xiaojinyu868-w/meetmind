import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/class-check/plan/route';

export interface FallbackCheckpointInput {
  topic: string;
  difficulty?: number;
  startMs: number;
  endMs: number;
}

function compactQuestionText(value: string, limit: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

export function buildFallbackCheckpointQuestions(params: {
  checkpoint: FallbackCheckpointInput;
  windowSegments: TranscriptSegment[];
  count: number;
}): ClassCheckQuestionData[] {
  const topic = compactQuestionText(params.checkpoint.topic, 42) || '刚才这个知识点';
  const evidence = compactQuestionText(
    params.windowSegments
      .map((segment) => segment.text)
      .filter(Boolean)
      .join(' '),
    90
  );
  const safeEvidence = evidence || topic;
  const targetCount = Math.min(3, Math.max(1, Math.floor(params.count || 1)));

  const templates: ClassCheckQuestionData[] = [
    {
      stem: `刚才关于「${topic}」，最值得先确认的是哪一件事？`,
      options: [
        `A. 能用自己的话说出它在课堂原文里的核心意思`,
        'B. 只记住它出现过，但不用理解前后关系',
        'C. 跳过这一段，直接看后面的结论',
        'D. 把所有原话逐字背下来',
      ],
      answer: 'A',
      explanation: `课堂原文里提到：「${safeEvidence}」。先抓住核心意思，再继续做题会更稳。`,
    },
    {
      stem: `如果要判断自己是否理解了「${topic}」，下面哪个做法最有效？`,
      options: [
        'A. 找出它和前后内容的关系，并复述一遍',
        'B. 只看标题，不回到原文',
        'C. 先忽略不懂的地方，等以后再说',
        'D. 只记一个关键词，不管它是什么意思',
      ],
      answer: 'A',
      explanation: `这道题来自当前 checkpoint 的课堂窗口。回到原文关系，比孤立记词更能检验理解。`,
    },
    {
      stem: `复习「${topic}」时，最适合先做的下一步是什么？`,
      options: [
        'A. 回看这段课堂原文，再用一句话总结',
        'B. 立刻换到无关材料',
        'C. 只收藏这段，不做任何处理',
        'D. 只看 AI 生成的题，不看课堂证据',
      ],
      answer: 'A',
      explanation: '随堂检验的目的是把题目接回真实课堂证据，而不是脱离原文硬考。',
    },
  ];

  return templates.slice(0, targetCount);
}
