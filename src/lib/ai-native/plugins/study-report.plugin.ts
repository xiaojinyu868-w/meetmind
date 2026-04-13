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

const KEYWORDS = ['听课报告', '学习报告', '家长', '认真', '专注', 'study-report', '网课'];

function includesKeyword(intent: string): boolean {
  return KEYWORDS.some((keyword) => intent.includes(keyword));
}

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
        content: `你是一位温暖、务实的教育顾问。家长把孩子的一节网课录音发给你，想知道这节课讲了什么。

你的职责是帮家长快速理解课堂内容，而不是评判孩子。

铁律：
- 你只能分析"课堂讲了什么"，不能评价"孩子掌握了多少"——你没有任何答题或互动数据，不知道孩子听懂没有
- 不要给任何评分（没有 1-5 分、没有百分比、没有"掌握度"）
- 不要说"孩子已掌握""孩子理解了"这类话，你不知道
- 温暖但诚实，不制造焦虑也不编造好消息
- letterToParent 是给家长的一段自然文字（3-5 句），像微信聊天一样平实

严格输出 JSON。`,
      },
      {
        role: 'user',
        content: `课堂信息：
- 时长：约 ${totalMinutes} 分钟
- 转录片段：${segmentCount} 段
${hasAnchors ? `- 孩子标记了 ${anchorCount} 个困惑点\n\n困惑点详情：\n${anchorContext}` : '- 孩子未标记困惑点'}

课堂转录：
${transcriptContext}

请输出 JSON：
{
  "title": "这节课的主题（简短）",
  "letterToParent": "给家长的一段话。用平实的语言告诉家长这节课讲了什么，大概什么难度，有什么值得关注的内容。${hasAnchors ? '也提一下孩子标记的困惑点意味着什么。' : ''}不要评价孩子掌握了多少。",
  "topics": [
    { "name": "知识点名", "difficulty": "基础/进阶/拓展", "gist": "一句话说这个点讲了什么" }
  ],
  ${hasAnchors ? '"confusionAnalysis": "孩子在哪些地方标记了困惑，这可能意味着什么（客观分析，不要下结论）",' : ''}
  "chatTopics": ["今天回家可以问孩子的具体话题1", "话题2"],
  "nextSteps": ["建议做一次随堂检验来了解掌握情况", "其他具体建议"]
}

要求：
- topics 3-6 个，覆盖主要内容
- chatTopics 2-3 个，要具体到可以直接问出口（如"今天老师讲的 XXX 是什么意思？"）
- nextSteps 必须包含"做一次随堂检验"的建议${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 3072, responseFormat: 'json_object' },
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
    if (context.input.transcript.length === 0) return false;
    const intent = context.goal.intent.toLowerCase();
    return includesKeyword(intent) || context.goal.appKey === 'study-report';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 20_000,
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
