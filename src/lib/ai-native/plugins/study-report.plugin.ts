/**
 * Study Report Plugin — 听课报告（家长视角）
 *
 * 核心原则：有数据才说话，不凭空编造。
 *
 * 只基于转录时：
 *   - 课堂内容摘要（这节课讲了什么）
 *   - 课堂结构（知识点列表 + 难度）
 *   - 家长沟通建议（怎么跟孩子聊这节课）
 *   - 建议行动（做随堂检验、回放重点片段等）
 *
 * 有困惑点时额外提供：
 *   - 孩子标记的困惑点分析
 *
 * 注意：掌握度评分必须基于答题数据，当前版本不给评分。
 */

import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptTranscriptContext, buildPromptAnchorContext, buildTerminologyHintBlock } from '../prompt-context';

/** LLM 输出结构 */
interface StudyReportLLMOutput {
  /** 课堂主题 */
  title?: string;
  /** 给家长的一段话总结（3-5 句） */
  letterToParent?: string;
  /** 课堂知识点结构 */
  topics?: Array<{
    /** 知识点名 */
    name?: string;
    /** 难度：基础/进阶/拓展 */
    difficulty?: string;
    /** 一句话说这个知识点讲了什么 */
    gist?: string;
  }>;
  /** 困惑点分析（仅当有困惑点数据时） */
  confusionAnalysis?: string;
  /** 家长可以和孩子聊的话题（2-3 个具体话题，不是空洞建议） */
  chatTopics?: string[];
  /** 建议下一步（具体可操作） */
  nextSteps?: string[];
}

async function generateReport(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string,
): Promise<StudyReportLLMOutput | null> {
  const anchorCount = context.input.anchors.length;
  const segmentCount = context.input.transcript.length;
  const totalDurationMs = segmentCount > 0
    ? context.input.transcript.reduce((max, s) => Math.max(max, s.endMs), 0)
    : 0;
  const totalMinutes = Math.round(totalDurationMs / 60000);

  const hasAnchors = anchorCount > 0;

  const response = await chat(
    [
      {
        role: 'system',
        content: '你是一位温暖、务实的教育顾问。一位家长把孩子的一节网课录音发来，想知道这节课讲了什么。你帮 ta 用平实的话理解课堂内容——你只看到了课堂转录，没有任何答题或互动数据，所以你不知道孩子掌握得怎么样，也不要假装知道。不评分、不评判孩子，只描述课堂本身和值得家长关注的点。',
      },
      {
        role: 'user',
        content: `课堂时长约 ${totalMinutes} 分钟，共 ${segmentCount} 段转录${hasAnchors ? `；孩子在听课时标记了 ${anchorCount} 个困惑点：\n${anchorContext}\n` : '；孩子未标记任何困惑点。'}

课堂转录：
${transcriptContext}

输出 JSON：
{
  "title": string,
  "letterToParent": string,
  "topics": [{ "name": string, "difficulty": string, "gist": string }],${hasAnchors ? `\n  "confusionAnalysis": string,` : ''}
  "chatTopics": string[],
  "nextSteps": string[]
}

letterToParent 是给家长的一段自然文字，像微信里讲话；chatTopics 是家长今晚回家可以直接问出口的具体话题；nextSteps 包含一条"做一次随堂检验来确认孩子掌握"的建议。只输出 JSON。${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.4, maxTokens: 2200, responseFormat: 'json_object' },
  );

  return parseJsonResponse<StudyReportLLMOutput>(response.content);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export const studyReportPlugin: AppPlugin = {
  manifest: {
    id: 'study-report',
    name: '听课报告',
    version: '0.2.0',
    description: '面向家长的课堂内容分析，帮助家长了解这节课讲了什么、怎么跟孩子聊。',
    tags: ['parent', 'report', 'content-analysis'],
    capabilities: ['citation-card'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeStudyReport，
    // 或前端显式传 appKey='study-report'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'study-report';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 8_000,
      includeIndex: true,
      includeTimestamp: true,
      minCharsPerSegment: 40,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 20);
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: StudyReportLLMOutput | null = null;
    try {
      llmOutput = await generateReport(context, model, promptContext.text, anchorContext);
    } catch (err) {
      console.error('[study-report-plugin] generateReport failed:', err instanceof Error ? err.message : err);
      llmOutput = null;
    }

    const title = llmOutput?.title?.trim() || '听课报告';
    const letterToParent = llmOutput?.letterToParent?.trim() || '';

    const topics = Array.isArray(llmOutput?.topics)
      ? llmOutput.topics
          .filter((t) => t?.name && typeof t.name === 'string')
          .map((t) => ({
            name: t.name!.trim(),
            difficulty: typeof t.difficulty === 'string' ? t.difficulty.trim() : '基础',
            gist: typeof t.gist === 'string' ? t.gist.trim() : '',
          }))
      : [];

    const confusionAnalysis = llmOutput?.confusionAnalysis?.trim() || '';
    const chatTopics = toStringArray(llmOutput?.chatTopics);
    const nextSteps = toStringArray(llmOutput?.nextSteps);

    const cards: AppExecutionResult['cards'] = [
      {
        id: 'report-overview',
        type: 'insight',
        title,
        body: letterToParent,
        priority: 'high',
      },
    ];

    return {
      pluginId: 'study-report',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `anchors=${context.input.anchors.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: [],
      render: {
        mode: 'document',
        title,
        description: letterToParent,
        payload: {
          title,
          letterToParent,
          topics,
          confusionAnalysis,
          chatTopics,
          nextSteps,
          hasAnchors: context.input.anchors.length > 0,
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
