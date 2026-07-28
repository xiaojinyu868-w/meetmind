import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import type {
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginTools,
  TeachBackTarget,
} from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { buildTeachBackTargetsSystemPrompt, buildTeachBackTargetsUserPrompt } from '../teach-back-prompts';

const PLUGIN_ID = 'teach-back-lab';
const PLUGIN_VERSION = '0.1.0';
const MIN_TRANSCRIPT_CHARS = 220;
const MAX_TARGETS = 5;

interface TeachBackTargetDraft {
  point?: string;
  why?: string;
  anchorText?: string;
}

interface TeachBackTargetsLLMOutput {
  targets?: TeachBackTargetDraft[];
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

/**
 * 把 LLM 选点结果正规化为 TeachBackTarget：
 * - point 必填，缺了整条丢弃（目标没有内容就没有可讲的东西）
 * - evidence 用 anchorText 重新锚回真实片段；锚不住为 null，绝不伪造时间戳
 */
export function normalizeTeachBackTargets(
  raw: unknown,
  context: AppExecutionContext,
): TeachBackTarget[] {
  const segments = context.input.transcript;
  const drafts = (raw as TeachBackTargetsLLMOutput | null)?.targets;
  if (!Array.isArray(drafts)) return [];

  const seen = new Set<string>();
  return drafts.flatMap((draft, index) => {
    const point = compact(draft?.point, 80);
    if (point.length < 4) return [];
    const signature = point.toLocaleLowerCase();
    if (seen.has(signature)) return [];
    seen.add(signature);

    const why = compact(draft?.why, 120) || undefined;
    const anchorText = compact(draft?.anchorText, 600);
    let evidence: TeachBackTarget['evidence'] = null;
    if (anchorText) {
      const grounding = resolveGroundedEvidence(anchorText, segments);
      if (grounding.supported && grounding.segment) {
        evidence = {
          startMs: grounding.segment.startMs,
          endMs: grounding.segment.endMs,
          snippet: compact(grounding.segment.text, 120),
        };
      }
    }
    return [{
      id: `target-${index + 1}`,
      point,
      ...(why ? { why } : {}),
      evidence,
    }];
  }).slice(0, MAX_TARGETS);
}

export const teachBackPlugin: AppPlugin = {
  manifest: {
    id: PLUGIN_ID,
    name: '讲给同桌听',
    version: PLUGIN_VERSION,
    description: '从课堂证据选出 3-5 个应该能亲口讲出来的目标点，支撑讲述与四象限核对。',
    tags: ['student', 'teach-back', 'feynman', 'assessment'],
    capabilities: ['citation-card', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'teach-back';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    // 单段但文字足够（早期课堂的快照式转录）也允许选点——只是没有可回跳的时间锚点
    const transcriptChars = context.input.transcript
      .reduce((total, segment) => total + (segment.text || '').trim().length, 0);
    if (transcriptChars < MIN_TRANSCRIPT_CHARS) {
      throw new Error('CONTENT_NOT_READY');
    }

    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 8_000,
      includeIndex: true,
      includeTimestamp: false,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const systemPrompt = context.runtimeControl?.systemPrompt || buildTeachBackTargetsSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    let llmOutput: TeachBackTargetsLLMOutput | null = null;
    try {
      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: buildTeachBackTargetsUserPrompt({
              goalIntent: context.goal.intent,
              transcriptContext: promptContext.text,
              anchorContext,
              terminologyHint: context.memory.terminologyHint,
            }),
          },
        ],
        model,
        { temperature: 0.3, maxTokens: 1500, responseFormat: 'json_object' },
      );
      llmOutput = parseJsonResponse<TeachBackTargetsLLMOutput>(response.content);
    } catch (error) {
      llmOutput = null;
      traceLlmError(error);
    }

    const targets = normalizeTeachBackTargets(llmOutput, context);
    if (targets.length === 0) {
      throw new Error('CONTENT_NOT_READY');
    }

    const cards: AppExecutionResult['cards'] = targets.map((target, index) => ({
      id: `teach-back-target-${index + 1}`,
      type: 'insight' as const,
      title: target.point,
      body: target.why || '',
      priority: index === 0 ? ('high' as const) : ('medium' as const),
      ...(target.evidence ? {
        citations: [{ startMs: target.evidence.startMs, endMs: target.evidence.endMs, snippet: target.evidence.snippet }],
        actions: [{
          id: `seek-teach-back-${index + 1}`,
          label: '回到课堂原声',
          kind: 'seek' as const,
          payload: { timestamp: target.evidence.startMs },
        }],
      } : {}),
      meta: { targetId: target.id, point: target.point },
    }));

    return {
      pluginId: PLUGIN_ID,
      version: PLUGIN_VERSION,
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `targets=${targets.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm=${llmOutput ? 'enabled' : 'empty'}`,
      ],
      cards,
      tasks: targets.map((target, index) => ({
        id: `teach-back-task-${index + 1}`,
        label: `讲出来：${target.point}`,
        estimatedMinutes: 2,
        relatedTimestamp: target.evidence?.startMs,
      })),
      render: {
        mode: 'custom',
        title: '讲给同桌听',
        description: '能讲出来的，才是真的懂。',
        payload: { targets },
      },
      raw: { generatedAt: tools.now() },
    };
  },
};

const log = createLogger('teach-back-plugin');

function traceLlmError(error: unknown): void {
  log.error('targets LLM failed', {
    error: error instanceof Error ? error.message : String(error),
  });
}
