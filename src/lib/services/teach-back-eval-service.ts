import type { TranscriptSegment } from '@/types';
import type {
  TeachBackConfidence,
  TeachBackCoverage,
  TeachBackEvaluation,
  TeachBackEvaluationItem,
  TeachBackQuadrant,
  TeachBackTarget,
  TeachBackTurn,
} from '@/lib/ai-native/types';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import { resolveGroundedEvidence } from '@/lib/ai-native/evidence-grounding';
import {
  buildTeachBackEvalSystemPrompt,
  buildTeachBackEvalUserPrompt,
} from '@/lib/ai-native/teach-back-prompts';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { createLogger } from '@/lib/logger';

const log = createLogger('teach-back-eval');

export interface TeachBackEvalInput {
  targets: TeachBackTarget[];
  teachingTurns: TeachBackTurn[];
  transcript: TranscriptSegment[];
  metadata?: { title?: string; subject?: string };
}

interface TeachBackEvalDraftItem {
  targetId?: string;
  coverage?: string;
  confidence?: string;
  note?: string;
  anchorText?: string;
}

interface TeachBackEvalLLMOutput {
  headline?: string;
  items?: TeachBackEvalDraftItem[];
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

function normalizeCoverage(value: unknown): TeachBackCoverage {
  return value === 'explained' || value === 'partial' || value === 'missed' ? value : 'missed';
}

function normalizeConfidence(value: unknown): TeachBackConfidence {
  return value === 'confident' ? 'confident' : 'uncertain';
}

/**
 * 四象限唯一推导入口：自信 × 有据。
 * quadrant 不信任 LLM 自报，只由服务端按 coverage × confidence 映射，
 * missed（没讲到）无法评估，返回 null。
 */
export function deriveTeachBackQuadrant(
  coverage: TeachBackCoverage,
  confidence: TeachBackConfidence,
): TeachBackQuadrant | null {
  if (coverage === 'missed') return null;
  if (coverage === 'explained') return confidence === 'confident' ? 'mastery' : 'productive-struggle';
  return confidence === 'confident' ? 'blind-spot' : 'aware-gap';
}

function allMissedEvaluation(targets: TeachBackTarget[], headline: string): TeachBackEvaluation {
  return {
    headline,
    items: targets.map((target) => ({
      targetId: target.id,
      point: target.point,
      coverage: 'missed' as const,
      confidence: 'uncertain' as const,
      quadrant: null,
      note: '没有讲到这个点。',
      evidence: target.evidence,
    })),
  };
}

/**
 * 把 LLM 评估结果正规化为 TeachBackEvaluation（纯函数，可单测）：
 * - 每个目标都有一条 item，LLM 漏判的目标按 missed 兜底
 * - coverage / confidence 枚举非法值向保守方向收口
 * - quadrant 由 deriveTeachBackQuadrant 推导，不信 LLM 自报
 * - evidence 用 anchorText 重新锚回真实片段；锚不住回退目标自带证据，绝不伪造
 */
export function normalizeTeachBackEvaluation(
  raw: unknown,
  targets: TeachBackTarget[],
  transcript: TranscriptSegment[],
): TeachBackEvaluation {
  const output = (raw ?? {}) as TeachBackEvalLLMOutput;
  const draftItems = Array.isArray(output.items) ? output.items : [];
  const byTargetId = new Map<string, TeachBackEvalDraftItem>();
  for (const draft of draftItems) {
    const targetId = compact(draft?.targetId, 60);
    if (targetId && !byTargetId.has(targetId)) byTargetId.set(targetId, draft);
  }

  const items: TeachBackEvaluationItem[] = targets.map((target) => {
    const draft = byTargetId.get(target.id);
    const coverage = normalizeCoverage(draft?.coverage);
    const confidence = normalizeConfidence(draft?.confidence);
    const note = compact(draft?.note, 240) || (coverage === 'missed' ? '没有讲到这个点。' : '');
    let evidence = target.evidence;
    const anchorText = compact(draft?.anchorText, 600);
    if (anchorText) {
      const grounding = resolveGroundedEvidence(anchorText, transcript);
      if (grounding.supported && grounding.segment) {
        evidence = {
          startMs: grounding.segment.startMs,
          endMs: grounding.segment.endMs,
          snippet: compact(grounding.segment.text, 120),
        };
      }
    }
    return {
      targetId: target.id,
      point: target.point,
      coverage,
      confidence,
      quadrant: deriveTeachBackQuadrant(coverage, confidence),
      note,
      evidence,
    };
  });

  return { headline: compact(output.headline, 200), items };
}

export async function evaluateTeachBack(input: TeachBackEvalInput): Promise<TeachBackEvaluation> {
  const targets = input.targets.slice(0, 8);
  const teachingText = input.teachingTurns
    .map((turn) => `${turn.role === 'user' ? '学生' : '同桌'}：${compact(turn.text, 600)}`)
    .join('\n')
    .slice(0, 8_000);
  const hasStudentVoice = input.teachingTurns.some(
    (turn) => turn.role === 'user' && turn.text.trim().length > 0,
  );
  if (targets.length === 0) throw new Error('TEACH_BACK_TARGETS_REQUIRED');
  // 学生一个字都没讲：不必惊动 LLM，诚实返回全部 missed
  if (!hasStudentVoice) return allMissedEvaluation(targets, '这次还没有听到你讲。');

  const transcriptContext = buildPromptTranscriptContext(input.transcript, {
    maxChars: 12_000,
    includeIndex: false,
    includeTimestamp: true,
  });

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: buildTeachBackEvalSystemPrompt() },
      {
        role: 'user',
        content: buildTeachBackEvalUserPrompt({
          targets,
          teachingText,
          transcriptContext: transcriptContext.text,
        }),
      },
    ];
    // 核对学生刚讲的内容，偶发的模型抖动不该直接变成用户可见的失败——重试一次
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await chat(messages, ModelDefaults.workshop, {
          temperature: 0.2,
          maxTokens: 2_000,
          responseFormat: 'json_object',
        });
        const parsed = parseJsonResponse<TeachBackEvalLLMOutput>(response.content);
        if (!parsed) throw new Error('TEACH_BACK_EVAL_PARSE_FAILED');
        return normalizeTeachBackEvaluation(parsed, targets, input.transcript);
      } catch (error) {
        lastError = error;
        log.warn('teach-back eval attempt failed', {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TEACH_BACK_EVAL_FAILED');
  } catch (error) {
    log.warn('teach-back evaluation failed', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    throw error;
  }
}
