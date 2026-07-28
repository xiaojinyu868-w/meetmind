import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import {
  fallbackWorkshopReadiness,
  sanitizeWorkshopReadinessAssessment,
  type AssessWorkshopReadinessInput,
} from '@/lib/ai-native/workshop-readiness';
import type { WorkshopReadinessAssessment } from '@/lib/ai-native/types';
import { createLogger } from '@/lib/logger';
import { chat } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';

export {
  fallbackWorkshopReadiness,
  getWorkshopEvidence,
  sanitizeWorkshopReadinessAssessment,
  type AssessWorkshopReadinessInput,
} from '@/lib/ai-native/workshop-readiness';

const log = createLogger('workshop-readiness');

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

export async function assessWorkshopReadiness(
  input: AssessWorkshopReadinessInput,
): Promise<WorkshopReadinessAssessment> {
  const fallback = fallbackWorkshopReadiness(input);
  if (fallback.status === 'not_ready') return fallback;
  // 官方试听课的内容和证据由产品内置，不需要再让模型把 90 秒样本误判成
  // “只支持一两个应用”。这也避免访客首轮额外消耗一次 readiness 调用。
  if (input.contextType?.trim().toLowerCase() === 'demo') return fallback;

  const transcriptContext = buildPromptTranscriptContext(input.transcript, {
    maxChars: 9_000,
    includeIndex: true,
    includeTimestamp: true,
  });
  const contextTier = input.contextTier ?? 'class';
  const tierAppKeys = fallback.allowedAppKeys;

  const system = `你是学习产品的内容判断层。你的职责不是尽量生成应用，而是判断当前材料是否足以支持一个有证据、不会夸大的学习产物。

当前学习对象层级：${contextTier}
这一层产品允许的应用：${tierAppKeys.join(', ') || '无'}

输出 JSON：
{
  "status": "ready|limited|not_ready",
  "contentKind": "lecture|discussion|reading|casual|administrative|fragment|unreliable|unknown",
  "recommendedAppKey": "cheatsheet|flashcards|quiz|mindmap|infographic|audio-overview|teach-back|null",
  "allowedAppKeys": ["始终返回当前层允许的全部 app key——这个字段不用于裁剪能力"],
  "reason": "ready|partial_learning|insufficient_content|not_learning|unreliable_transcript",
  "confidence": "high|medium|low"
}

判断原则：
- 你的输出只决定“推荐什么”和“如何描述材料”，不决定用户能用什么。allowedAppKeys 永远返回当前层的完整集合，不要替用户做能力裁剪。
- 必须结合场景标题和来源类型判断。语言听力材料、案例对话、题目讲解和练习原文仍是学习内容，不能只因为原文是对话就判成日常闲聊。
- 不得因为产品有六个应用就硬选一个。recommendedAppKey 可以为 null。
- class（单节课）绝不允许推荐 cheatsheet；单课的高价值交付是检验、回忆、结构与复述，不是假装考试范围已经完整。
- cheatsheet 只属于 unit / exam：必须建立在多节课堂或明确考试范围之上，并且原文里真实存在定义、公式、条件、步骤、对比或可核对要点。不能默认推荐，更不能擅自引入“必考、老师强调、高频考点”。
- flashcards 适合可独立回忆的稳定知识；quiz 适合存在可检验命题；mindmap 适合多个主题及其关系；infographic 适合结构完整且值得视觉表达的内容；audio-overview 需要足够丰富的多段内容。
- ready 表示材料足以支撑当前层的完整学习加工；recommendedAppKey 只负责指出此刻最值得先做的一项。
- limited 表示材料确有学习价值但偏短，只影响你给出推荐的把握，不影响用户可选的能力。
- not_ready 只用于闲聊、寒暄、行政通知、零散句子、严重错乱的转录等确实不含可学习内容的材料；此时 recommendedAppKey 必须为 null。
- 只判断材料支持什么，不推断用户学习风格或能力。
仅输出 JSON。`;

  const context = [
    input.contextTitle ? `场景标题：${compact(input.contextTitle, 300)}` : '',
    input.contextType ? `场景来源：${compact(input.contextType, 80)}` : '',
    input.summary ? `已有摘要：${compact(input.summary, 1_200)}` : '',
    input.goalIntent ? `用户当前目标：${compact(input.goalIntent, 500)}` : '',
    input.keyDifficulties?.length ? `已知难点：${input.keyDifficulties.map((item) => compact(item, 120)).join('；')}` : '',
    `未解决标记数：${Math.max(0, input.activeAnchorCount ?? 0)}`,
    `课堂原文：\n${transcriptContext.text}`,
  ].filter(Boolean).join('\n\n');

  try {
    const response = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: context },
      ],
      undefined,
      { temperature: 0.1, maxTokens: 500, responseFormat: 'json_object' },
    );
    return sanitizeWorkshopReadinessAssessment(parseJsonResponse(response.content), input);
  } catch (error) {
    log.warn('readiness assessment fallback', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return fallback;
  }
}
