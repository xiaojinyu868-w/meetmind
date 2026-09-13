/**
 * 知乎收藏 → 与来源无关的候选材料（MaterialCandidate）。故意不 import 任何服务：分线 / 开课 / 测试都从这里拿映射，不拖进 prisma。
 */

import type { ZhihuPageKind } from './zhihu-page-clean';
import type { ZhihuCaptureRecord } from './zhihu-import-service';
import type { MaterialCandidate, MaterialKind } from '@/lib/services/material-lessons/material-candidate';

/** 知乎的体裁 → 能力层的体裁 */
export function materialKindOf(kind: ZhihuPageKind): MaterialKind {
  if (kind === 'answer' || kind === 'article' || kind === 'question') return kind;
  if (kind === 'zvideo') return 'video';
  if (kind === 'pin') return 'post';
  return 'other';
}

const KIND_LABEL: Record<ZhihuPageKind, string> = { answer: '回答', article: '文章', question: '问题', pin: '想法', zvideo: '视频', unknown: '内容' };

export function metaLine(record: ZhihuCaptureRecord): string {
  const z = record.zhihu;
  const parts = [KIND_LABEL[z.kind], `赞同 ${z.voteUpCount}`, `评论 ${z.commentCount}`];
  if (z.favTime) parts.push(`${new Date(z.favTime * 1000).toISOString().slice(0, 10)} 收藏`);
  return parts.join(' · ');
}

/** 收藏 → 与来源无关的候选材料（能力层只认识它） */
export function candidateOf(record: ZhihuCaptureRecord): MaterialCandidate {
  const full = record.zhihu.body === 'full' && (record.normalizedText ?? '').length > 0;
  return {
    id: record.id,
    title: record.title,
    author: record.zhihu.author,
    url: record.zhihu.url,
    kind: materialKindOf(record.zhihu.kind),
    text: record.normalizedText ?? record.previewText ?? '',
    summary: record.previewText ?? '',
    hasFullText: full,
    votes: record.zhihu.voteUpCount,
    comments: record.zhihu.commentCount,
    collectedAt: record.zhihu.favTime,
    meta: metaLine(record),
  };
}

