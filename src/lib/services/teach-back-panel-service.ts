import type { TranscriptSegment } from '@/types';
import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import {
  JUDGE_SAY_MAX_CHARS,
  JudgeStreamParser,
  recentJudgeIds,
  selectRelevantTranscript,
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

/**
 * 课堂原文给评委看的预算（2026-09-11 从 9k 收到 5k）：评委回应的是刚讲的这段，给它的是与这段相关的原文窗口
 * （selectRelevantTranscript：命中段 + 邻居 + 目标点证据段，整段原话不截半句），不是逐段压缩的整节课。
 * 实测 qwen3.7-plus 首 token 对 8k / 5k / 2.5k 原文不敏感（1.09 / 1.12 / 0.96s，噪声内），收预算是为了原文完整可核对、成本减半。
 */
const TRANSCRIPT_BUDGET_CHARS = 5_000;
/** 本场记录：最近两回合（他讲的两段 + 评委对它们的回应），字数封顶兜底 */
const HISTORY_BUDGET_CHARS = 1_500;
const HISTORY_MAX_USER_TURNS = 2;

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
  const history = trimPanelHistory(input.turns, HISTORY_BUDGET_CHARS, HISTORY_MAX_USER_TURNS);
  const recentSpeakers = recentJudgeIds(input.turns);
  // check-in 没有"刚讲的这段"：用他最近讲的一段选窗口
  const focus = input.segment || [...input.turns].reverse().find((turn) => turn.role === 'user')?.text || '';
  const window = selectRelevantTranscript(input.transcript, focus, targets, { maxChars: TRANSCRIPT_BUDGET_CHARS });
  const transcriptContext = buildPromptTranscriptContext(window.segments as TranscriptSegment[], {
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
            transcriptWindowed: window.windowed,
            history,
            latestSegment: input.segment,
            mode: input.mode,
            recentSpeakers,
          }),
        },
      ],
      model,
      // maxTokens 是上限不是目标：头行 + 一句话 + 一个问题 ≈ 40-60 token；留到 160 是给英文课 / 罕见长句的余量
      { temperature: 0.7, maxTokens: 160, smooth: 'off', thinking: false },
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
