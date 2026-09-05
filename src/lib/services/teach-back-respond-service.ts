import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { buildTeachBackStudentInstructions } from '@/lib/ai-native/teach-back-prompts';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { createLogger } from '@/lib/logger';

const log = createLogger('teach-back-respond');

const SAY_MAX_CHARS = 120;

export interface TeachBackRespondInput {
  targets: TeachBackTarget[];
  teachingTurns: TeachBackTurn[];
  metadata?: { title?: string; subject?: string };
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

/**
 * 正规化同桌的开口（纯函数，可单测）：
 * - say 非字符串 / 纯空白 / 字面量「null」→ null（同桌保持安静）
 * - 去多余空白，截断 ≤120 字（一句话，不长篇大论）
 */
export function normalizeTeachBackSay(raw: unknown): string | null {
  const say = (raw ?? {}) as { say?: unknown };
  if (typeof say.say !== 'string') return null;
  const text = say.say.replace(/\s+/g, ' ').trim();
  if (!text || text.toLowerCase() === 'null') return null;
  return text.slice(0, SAY_MAX_CHARS);
}

/**
 * 半双工语音版「讲给同桌听」的同桌应答：
 * 学生每讲完一段调一次，同桌（AI 学生）决定开口还是继续安静听。
 * 任何失败（LLM 抖动 / 非法 JSON）都收为 null，绝不 throw——
 * 同桌不开口不是错误，讲课流不该被打断。
 */
export async function respondTeachBack(input: TeachBackRespondInput): Promise<string | null> {
  const targets = input.targets.slice(0, 8);
  if (targets.length === 0) return null;
  const teachingText = input.teachingTurns
    .map((turn) => `${turn.role === 'user' ? '学生' : '同桌'}：${compact(turn.text, 600)}`)
    .join('\n')
    .slice(0, 8_000);

  try {
    const response = await chat(
      [
        {
          role: 'system',
          content: buildTeachBackStudentInstructions({
            lessonTitle: input.metadata?.title,
            subject: input.metadata?.subject,
            targets,
          }),
        },
        {
          role: 'user',
          content: `讲述到目前为止的记录（「学生：」是正在讲的同学，「同桌：」是你之前说过的话）：
${teachingText || '（他还没有开口）'}

现在轮到你决定：开口说一句话，还是继续安静听。
输出 JSON：
{ "say": string | null }

- say 为 null 表示你继续安静听，不打扰他
- 要开口时只说一句口语化的话（不超过 40 字），遵循你的行为准则

只输出 JSON，不解释。`,
        },
      ],
      ModelDefaults.workshop,
      { temperature: 0.6, maxTokens: 200, responseFormat: 'json_object' },
    );
    return normalizeTeachBackSay(parseJsonResponse<{ say?: unknown }>(response.content));
  } catch (error) {
    log.warn('teach-back respond failed', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return null;
  }
}
