/**
 * 知乎对「接下来看哪一篇」判断能力层（services/material-lessons/next-reading-judge）的适配：
 * 把知乎搜索候选的权威等级 / 赞同 / 精选评论翻成能力层认识的 signals / comments。函数名与签名保持，路由 / 测试不动。
 */

import {
  applyVerdict as coreApplyVerdict,
  buildJudgePrompt as coreBuildJudgePrompt,
  judgeNextReading,
  type CandidateDescription,
  type ChatFn,
  type JudgeContext,
} from '@/lib/services/material-lessons/next-reading-judge';
import type { ContinueReadingGroup, ZhihuDiscoveryCandidate } from './zhihu-discovery-service';

export type { ChatFn, JudgeContext };

export function describeZhihuCandidate(c: ZhihuDiscoveryCandidate): CandidateDescription {
  return {
    kindLabel: c.contentType === 'Article' ? '文章' : '回答',
    signals: [c.authorityLevel ? `权威等级 ${c.authorityLevel}/4` : null, `赞同 ${c.voteUpCount}`].filter((x): x is string => Boolean(x)),
    comments: c.featuredComments,
  };
}

export function buildJudgePrompt(concept: string, candidates: ZhihuDiscoveryCandidate[], ctx: JudgeContext) {
  return coreBuildJudgePrompt(concept, candidates, ctx, describeZhihuCandidate);
}

export const applyVerdict = coreApplyVerdict<ZhihuDiscoveryCandidate>;

export function judgeContinueReading(
  groups: ContinueReadingGroup[],
  ctx: JudgeContext,
  opts: { chatFn?: ChatFn; modelId?: string; perConcept?: number; timeoutMs?: number } = {},
): Promise<ContinueReadingGroup[]> {
  return judgeNextReading(groups, ctx, describeZhihuCandidate, opts);
}
