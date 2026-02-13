import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['困惑', '不懂', '卡住', '听不懂', '复习', '错题', '练习'];

function getUnresolvedAnchor(anchors: Anchor[]): Anchor | undefined {
  return anchors.find((anchor) => !anchor.cancelled && !anchor.resolved);
}

function getSegmentsAroundAnchor(
  transcript: TranscriptSegment[],
  anchorTimestamp: number,
  beforeMs: number = 90_000,
  afterMs: number = 60_000
): TranscriptSegment[] {
  const start = Math.max(0, anchorTimestamp - beforeMs);
  const end = anchorTimestamp + afterMs;
  return transcript.filter((segment) => segment.endMs >= start && segment.startMs <= end);
}

function buildResult(
  context: AppExecutionContext,
  tools: AppPluginTools,
  focusAnchor?: Anchor,
  focusSegments: TranscriptSegment[] = []
): AppExecutionResult {
  const focusSummary = tools.summarizeSegments(focusSegments, 300);
  const focusTimestamp = focusAnchor?.timestamp;

  return {
    pluginId: 'confusion-drill',
    version: '0.1.0',
    trace: [
      `intent=${context.goal.intent}`,
      `transcript_segments=${context.input.transcript.length}`,
      `anchors=${context.input.anchors.length}`,
      `focus_anchor=${focusAnchor?.id ?? 'none'}`,
    ],
    cards: [
      {
        id: 'confusion-focus-card',
        type: 'insight',
        title: '困惑点聚焦',
        body: focusSummary || '暂未找到可用片段，建议继续录音后再分析。',
        priority: 'high',
        citations: focusSegments.slice(0, 2).map((segment) => ({
          startMs: segment.startMs,
          endMs: segment.endMs,
          snippet: segment.text.slice(0, 80),
        })),
        actions: focusTimestamp
          ? [
              {
                id: 'seek-anchor',
                label: '回到困惑时间点',
                kind: 'seek',
                payload: { timestamp: focusTimestamp },
              },
            ]
          : undefined,
      },
      {
        id: 'confusion-step-card',
        type: 'task',
        title: '三步补救路径',
        body: '先回放原句，再做1道同类型题，最后用自己的话复述老师讲法。',
        priority: 'medium',
      },
    ],
    tasks: [
      {
        id: 'task-replay',
        label: '回放困惑片段并标注没听懂的句子',
        reason: '先定位原始理解断点',
        estimatedMinutes: 3,
        relatedTimestamp: focusTimestamp,
      },
      {
        id: 'task-practice',
        label: '完成1道同类题并记录卡住步骤',
        reason: '验证是否真的掌握',
        estimatedMinutes: 8,
      },
      {
        id: 'task-restate',
        label: '用30秒复述本知识点',
        reason: '输出即理解',
        estimatedMinutes: 4,
      },
    ],
    nextSuggestedPlugins: ['review-plan'],
    raw: {
      generatedAt: tools.now(),
      focusAnchorId: focusAnchor?.id ?? null,
    },
  };
}

export const confusionDrillPlugin: AppPlugin = {
  manifest: {
    id: 'confusion-drill',
    name: '困惑补救插件',
    version: '0.1.0',
    description: '围绕困惑锚点生成最小补救训练闭环。',
    tags: ['student', 'confusion', 'drill'],
    capabilities: ['anchor-focus', 'action-plan'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    const intent = context.goal.intent.toLowerCase();
    if (KEYWORDS.some((word) => intent.includes(word))) {
      return true;
    }
    return context.input.anchors.some((anchor) => !anchor.cancelled && !anchor.resolved);
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const focusAnchor = getUnresolvedAnchor(context.input.anchors);
    let focusSegments: TranscriptSegment[] = [];

    if (focusAnchor) {
      focusSegments = getSegmentsAroundAnchor(context.input.transcript, focusAnchor.timestamp);
    }

    if (focusSegments.length === 0) {
      focusSegments = tools.searchTranscript({
        transcript: context.input.transcript,
        query: context.goal.intent,
        limit: 3,
      });
    }

    if (focusSegments.length === 0) {
      focusSegments = context.input.transcript.slice(0, 3);
    }

    return buildResult(context, tools, focusAnchor, focusSegments);
  },
};
