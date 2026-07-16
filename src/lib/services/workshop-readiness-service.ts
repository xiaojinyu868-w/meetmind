import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import {
  fallbackWorkshopReadiness,
  sanitizeWorkshopReadinessAssessment,
  type AssessWorkshopReadinessInput,
} from '@/lib/ai-native/workshop-readiness';
import type { WorkshopReadinessAssessment } from '@/lib/ai-native/types';
import { createLogger } from '@/lib/logger';
import { chat } from '@/lib/services/llm-service';

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

  const transcriptContext = buildPromptTranscriptContext(input.transcript, {
    maxChars: 9_000,
    includeIndex: true,
    includeTimestamp: true,
  });

  const system = `你是学习产品的内容判断层。你的职责不是尽量生成应用，而是判断当前材料是否足以支持一个有证据、不会夸大的学习产物。

输出 JSON：
{
  "status": "ready|limited|not_ready",
  "contentKind": "lecture|discussion|reading|casual|administrative|fragment|unreliable|unknown",
  "recommendedAppKey": "cheatsheet|flashcards|quiz|mindmap|infographic|audio-overview|null",
  "allowedAppKeys": ["ready 时必须返回全部六个 app key；limited 时只返回当前可靠的 app key"],
  "reason": "ready|partial_learning|insufficient_content|not_learning|unreliable_transcript",
  "confidence": "high|medium|low"
}

判断原则：
- 允许结论是 not_ready。闲聊、寒暄、行政通知、零散句子、严重错乱的转录不能包装成课程。
- 必须结合场景标题和来源类型判断。语言听力材料、案例对话、题目讲解和练习原文仍是学习内容，不能只因为原文是对话就判成日常闲聊。
- 不得因为产品有六个应用就硬选一个。recommendedAppKey 可以为 null。
- cheatsheet 只适合原文里真实存在定义、公式、步骤、框架或可核对要点的内容，不能默认推荐，更不能擅自引入“考试、必考、老师强调”。
- flashcards 适合可独立回忆的稳定知识；quiz 适合存在可检验命题；mindmap 适合多个主题及其关系；infographic 适合结构完整且值得视觉表达的内容；audio-overview 需要足够丰富的多段内容。
- ready 表示材料足以支撑完整学习加工；allowedAppKeys 必须包含全部六个应用，recommendedAppKey 只负责指出此刻最值得先做的一项。
- limited 表示材料确有学习价值但只支持一两个低风险应用；allowedAppKeys 最多 2 个，其余能力由前端保留展示但暂不允许生成。
- not_ready 时 recommendedAppKey 必须为 null，allowedAppKeys 必须为空。
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
    return sanitizeWorkshopReadinessAssessment(JSON.parse(response.content), input);
  } catch (error) {
    log.warn('readiness assessment fallback', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return fallback;
  }
}
