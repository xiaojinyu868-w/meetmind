/**
 * 「继续看」的真判断：候选是知乎搜索按权威 / 赞同排出来的，但"为什么是它"不能只是元数据拼句——
 * 产品论点 §5：先给「为什么是它」，再让用户点开。这里让一个快模型读完候选摘要，针对**这位学生刚刚没稳的那个概念**，
 * 挑出最能补上这个缺口的 1–2 条，并写一句有根的理由（只能用摘要里有的内容，不许编）。
 *
 * 失败（超时 / 解析不了 / 没配模型）就退回元数据理由，不阻断；额度上一个概念一次调用，几百 token。
 */

import { chat, type ChatMessage } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { createLogger } from '@/lib/logger';
import type { ContinueReadingGroup, ZhihuDiscoveryCandidate } from './zhihu-discovery-service';

const log = createLogger('zhihu-continue-judge');

export interface JudgeContext {
  /** 课题 / 收藏夹名 */
  topic?: string;
  /** 这节课材料的标题，帮模型知道学生已经看过什么，别推重复的 */
  materialTitles?: string[];
}

interface JudgeVerdict {
  picks: Array<{ index: number; reason: string }>;
}

export type ChatFn = (messages: ChatMessage[], modelId: string, options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }) => Promise<{ content: string }>;

export function buildJudgePrompt(concept: string, candidates: ZhihuDiscoveryCandidate[], ctx: JudgeContext): ChatMessage[] {
  const list = candidates
    .map((c, i) => {
      const meta = [c.contentType === 'Article' ? '文章' : '回答', c.author ? `作者 ${c.author}` : null, c.authorityLevel ? `权威等级 ${c.authorityLevel}/4` : null, `赞同 ${c.voteUpCount}`]
        .filter(Boolean)
        .join(' · ');
      const comments = c.featuredComments.length ? `\n  评论区：${c.featuredComments.slice(0, 2).map((x) => x.replace(/\s+/g, ' ').slice(0, 80)).join(' ／ ')}` : '';
      return `${i + 1}. 《${c.title}》（${meta}）\n  摘要：${c.snippet.slice(0, 260)}${comments}`;
    })
    .join('\n');
  const already = ctx.materialTitles?.length ? `\n学生这节课已经读过：${ctx.materialTitles.map((t) => `《${t}》`).join('、')}。不要推讲法雷同的。` : '';
  const system = `你是一位懂这门课的同学，在帮一位刚做完测验的学生挑"接下来看哪一篇"。学生在「${concept}」上还没稳${ctx.topic ? `（这节课的主题是「${ctx.topic}」）` : ''}。${already}
下面是知乎上搜到的候选。请只从中挑最能补上这个缺口的 1–2 篇：优先讲清"为什么"而不是只给结论的、用例子或图把概念说透的、和学生的缺口直接对得上的。
理由一句话（≤40 字），必须落在摘要里真有的内容上，说清它对这个缺口有什么用；不要复述标题，不要编摘要里没有的东西。
只输出 JSON：{"picks":[{"index":<候选编号>,"reason":"<一句话>"}]}。都不合适就输出 {"picks":[]}。`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: list },
  ];
}

export function applyVerdict(candidates: ZhihuDiscoveryCandidate[], verdict: JudgeVerdict | null, max: number): ZhihuDiscoveryCandidate[] | null {
  if (!verdict || !Array.isArray(verdict.picks)) return null;
  const seen = new Set<number>();
  const picked: ZhihuDiscoveryCandidate[] = [];
  for (const pick of verdict.picks) {
    const index = Number(pick?.index) - 1;
    const reason = typeof pick?.reason === 'string' ? pick.reason.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length || seen.has(index)) continue;
    seen.add(index);
    picked.push(reason ? { ...candidates[index], reason } : candidates[index]);
    if (picked.length >= max) break;
  }
  return picked.length ? picked : null;
}

/**
 * 对 continueReading 的每一组做一次判断；候选不足 2 条时不值得叫模型（直接用元数据理由）。
 * 返回新数组，不改入参。
 */
export async function judgeContinueReading(
  groups: ContinueReadingGroup[],
  ctx: JudgeContext,
  opts: { chatFn?: ChatFn; modelId?: string; perConcept?: number; timeoutMs?: number } = {},
): Promise<ContinueReadingGroup[]> {
  const chatFn: ChatFn = opts.chatFn ?? ((messages, modelId, options) => chat(messages, modelId, options));
  const modelId = opts.modelId ?? ModelDefaults.tutorQuick ?? ModelDefaults.workshop;
  const perConcept = Math.max(1, Math.min(3, opts.perConcept ?? 2));
  const timeoutMs = opts.timeoutMs ?? 12_000;

  return Promise.all(
    groups.map(async (group) => {
      if (group.candidates.length < 2) return group;
      try {
        const response = await Promise.race([
          chatFn(buildJudgePrompt(group.concept, group.candidates, ctx), modelId, { temperature: 0.2, maxTokens: 300, responseFormat: 'json_object' }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('judge_timeout')), timeoutMs)),
        ]);
        const verdict = parseJsonResponse<JudgeVerdict>(response.content);
        const picked = applyVerdict(group.candidates, verdict, perConcept);
        if (!picked) return { ...group, candidates: group.candidates.slice(0, perConcept) };
        return { ...group, candidates: picked };
      } catch (error) {
        log.warn('continue judge fell back to metadata reasons', { concept: group.concept, message: (error as Error)?.message });
        return { ...group, candidates: group.candidates.slice(0, perConcept) };
      }
    }),
  );
}
