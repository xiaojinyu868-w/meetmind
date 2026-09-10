import type { TranscriptSegment } from '@/types';
import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import {
  JUDGE_SAY_MAX_CHARS,
  JudgeStreamParser,
  recentJudgeIds,
  trimPanelHistory,
  type TeachBackPanelEvent,
} from '@/lib/ai-native/teach-back-panel';
import {
  buildTeachBackPanelSystemPrompt,
  buildTeachBackPanelUserPrompt,
} from '@/lib/prompts/teach-back-panel-prompt';
import { chatStream } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { createLogger } from '@/lib/logger';

const log = createLogger('teach-back-panel');

/** 课堂原文给评委看的预算：回合是实时的，首 token 延迟直接决定"像不像通话"，不给 48k */
const TRANSCRIPT_BUDGET_CHARS = 9_000;
const HISTORY_BUDGET_CHARS = 5_000;

export interface TeachBackPanelInput {
  targets: TeachBackTarget[];
  /** 本场至今（不含 segment） */
  turns: TeachBackTurn[];
  /** 他刚讲完的这一段；check-in 模式可为空 */
  segment: string;
  transcript: TranscriptSegment[];
  metadata?: { title?: string; subject?: string };
  mode: 'turn' | 'check-in';
  signal?: AbortSignal;
}

/** 评委席模型：默认 workshop（qwen3.7-plus，thinking 关；实测首 token 0.6~1.5s），一行 env 可切 flash */
export function resolveTeachBackPanelModel(): string {
  return (process.env.TEACH_BACK_PANEL_MODEL || '').trim() || ModelDefaults.workshop;
}

/**
 * 评委席回合：流式产出 SSE 事件（judge → delta* → done | silent | error）。
 * 任何失败都收成 error 事件而不是 throw——评委没开口不是错误，讲述流不该被打断。
 */
export async function* streamTeachBackPanel(input: TeachBackPanelInput): AsyncGenerator<TeachBackPanelEvent> {
  const targets = input.targets.slice(0, 8);
  const history = trimPanelHistory(input.turns, HISTORY_BUDGET_CHARS);
  const recentSpeakers = recentJudgeIds(input.turns);
  const transcriptContext = buildPromptTranscriptContext(input.transcript, {
    maxChars: TRANSCRIPT_BUDGET_CHARS,
    includeIndex: false,
    includeTimestamp: false,
  });
  const model = resolveTeachBackPanelModel();
  const parser = new JudgeStreamParser(recentSpeakers);
  let said = '';
  let announced = false;

  try {
    const stream = chatStream(
      [
        {
          role: 'system',
          content: buildTeachBackPanelSystemPrompt({
            lessonTitle: input.metadata?.title,
            subject: input.metadata?.subject,
            targets,
          }),
        },
        {
          role: 'user',
          content: buildTeachBackPanelUserPrompt({
            transcriptContext: transcriptContext.text || '（这节课的原文暂不可用，只凭他的讲述判断）',
            history,
            latestSegment: input.segment,
            mode: input.mode,
            recentSpeakers,
          }),
        },
      ],
      model,
      { temperature: 0.7, maxTokens: 320, smooth: 'off', thinking: false },
    );

    for await (const chunk of stream) {
      if (input.signal?.aborted) return;
      if (chunk.type !== 'content' || !chunk.content) continue;
      for (const piece of parser.push(chunk.content)) {
        if (piece.judge !== undefined) {
          if (piece.judge === null) {
            yield { type: 'silent' };
            return;
          }
          announced = true;
          yield { type: 'judge', judgeId: piece.judge };
        }
        if (piece.text) {
          const room = JUDGE_SAY_MAX_CHARS - said.length;
          if (room <= 0) continue;
          const text = piece.text.slice(0, room);
          said += text;
          yield { type: 'delta', text };
        }
      }
      if (said.length >= JUDGE_SAY_MAX_CHARS) break;
    }
    for (const piece of parser.flush()) {
      if (piece.judge === null) {
        yield { type: 'silent' };
        return;
      }
      if (piece.judge && !announced) {
        announced = true;
        yield { type: 'judge', judgeId: piece.judge };
      }
      if (piece.text && said.length < JUDGE_SAY_MAX_CHARS) {
        const text = piece.text.slice(0, JUDGE_SAY_MAX_CHARS - said.length);
        said += text;
        yield { type: 'delta', text };
      }
    }
    const judgeId = parser.judgeId;
    if (!judgeId || !said.trim()) {
      yield { type: 'silent' };
      return;
    }
    yield { type: 'done', judgeId, text: said.trim() };
  } catch (error) {
    if (input.signal?.aborted) return;
    log.warn('teach-back panel turn failed', {
      model,
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    yield { type: 'error', message: '评委这次没反应过来' };
  }
}
