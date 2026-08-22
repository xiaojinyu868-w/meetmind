import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { directBoardScript, isDirectorAvailable } from '@/lib/services/board-director-service';
import { createLogger } from '@/lib/logger';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { buildExplainerSystemPrompt, buildExplainerUserPrompt } from './explainer-prompts';
import { validateExplainerQuotes } from './explainer-quotes';
import { sanitizeBoardScript } from './board-script';
import type { BoardQuote, BoardScript } from './board-script';

const log = createLogger('explainer-plugin');

export interface ExplainerQuoteStats {
  total: number;
  verified: number;
  downgraded: number;
}

export interface ExplainerRenderPayload {
  script: BoardScript;
  quoteStats: ExplainerQuoteStats;
}

async function generateBoardScriptWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string,
  systemPrompt: string,
): Promise<unknown | null> {
  const response = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: buildExplainerUserPrompt({
          goalIntent: context.goal.intent,
          transcriptContext,
          anchorContext,
          terminologyHint: context.memory.terminologyHint,
        }),
      },
    ],
    model,
    // thinking:false 显式关闭——DeepSeek V4 API 默认思考开启，32k JSON
    // 生成会拖过 180s HTTP 超时（2026-08-18 拍题链路同款 502 后排查确认）
    { temperature: 0.5, maxTokens: 32000, responseFormat: 'json_object', thinking: false }
  );

  return parseJsonResponse<unknown>(response.content);
}

/**
 * 校验失败的引用：在 narration 里把「原话」的书名号去掉（降级为转述），
 * 并从 quotes 中移除。找不到书名号也只是移出 quotes，不阻断产物。
 */
function downgradeInvalidQuotes(
  script: BoardScript,
  invalid: BoardQuote[],
): { script: BoardScript; downgraded: number } {
  if (invalid.length === 0) return { script, downgraded: 0 };

  const pages = script.pages.map((page) => ({
    segments: page.segments.map((segment) => ({ ...segment })),
  }));

  let downgraded = 0;
  for (const quote of invalid) {
    const target = `「${quote.text}」`;
    for (const page of pages) {
      let hit = false;
      for (const segment of page.segments) {
        const index = segment.narration.indexOf(target);
        if (index === -1) continue;
        segment.narration =
          segment.narration.slice(0, index) + quote.text + segment.narration.slice(index + target.length);
        hit = true;
        break;
      }
      if (hit) break;
    }
    downgraded += 1;
  }

  const validTexts = new Set(
    script.quotes
      .filter((quote) => !invalid.some((bad) => bad.text === quote.text))
      .map((quote) => quote.text),
  );

  return {
    script: { ...script, pages, quotes: script.quotes.filter((quote) => validTexts.has(quote.text)) },
    downgraded,
  };
}

function buildFallbackResult(
  context: AppExecutionContext,
  tools: AppPluginTools,
  model: string,
  traceExtras: string[],
): AppExecutionResult {
  return {
    pluginId: 'explainer',
    version: '0.2.0',
    model,
    trace: [
      `intent=${context.goal.intent}`,
      `model=${model}`,
      `transcript_segments=${context.input.transcript.length}`,
      ...traceExtras,
      'llm=fallback',
    ],
    cards: [
      {
        id: 'explainer-fallback',
        type: 'insight',
        title: '板书精讲这次没做好',
        body: '课堂内容仍然保留着，稍后可以再做一版。',
        priority: 'medium',
      },
    ],
    tasks: [],
    raw: {
      generatedAt: tools.now(),
    },
  };
}

export const explainerPlugin: AppPlugin = {
  manifest: {
    id: 'explainer',
    name: '板书精讲',
    version: '0.2.0',
    description: '把一节课转录变成可汗学院式黑板板书：讲稿 + 板书动作脚本，播放器边写边讲；老师原话逐字校验。',
    tags: ['student', 'explainer', 'blackboard', 'board-script'],
    capabilities: ['board-render', 'quote-verification'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // 结构性守卫：必须有转录；分发权交给上游 appKey，不抢 legacy 自动匹配的兜底位。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'explainer';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: true,
      includeTimestamp: true,
      minCharsPerSegment: 48,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const systemPrompt = context.runtimeControl?.systemPrompt || buildExplainerSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    const traceExtras = [
      `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
      `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
    ];

    let llmOutput: unknown | null = null;
    try {
      llmOutput = await generateBoardScriptWithLLM(
        context,
        model,
        promptContext.text,
        anchorContext,
        systemPrompt,
      );
    } catch (error) {
      log.error('explainer LLM failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      llmOutput = null;
    }

    if (!llmOutput) {
      return buildFallbackResult(context, tools, model, traceExtras);
    }

    // 坏动作跳过记 trace，不崩（AmIWrite）；一页都留不住时 sanitize 给保底结构，
    // 但完全空的输出（无任何 segment 留住）按失败处理。
    const { script: rawScript, dropped } = sanitizeBoardScript(llmOutput);
    const segmentActionCount = (segment: (typeof rawScript.pages)[number]['segments'][number]) =>
      segment.type === 'checkpoint' ? segment.demoActions.length : segment.actions.length;
    const hasContent =
      rawScript.pages.some((page) => page.segments.some((segment) => segmentActionCount(segment) > 0)) &&
      rawScript.pages.some((page) => page.segments.length > 0);
    if (!hasContent) {
      return buildFallbackResult(context, tools, model, [...traceExtras, `dropped=${dropped}`]);
    }

    // 唯一防线：老师原话必须逐字出自转录。失败的引用去掉「」降级为转述，不阻断产物。
    const { valid, invalid } = validateExplainerQuotes(rawScript.quotes, context.input.transcript);
    const { script: cleanedScript, downgraded } = downgradeInvalidQuotes(
      { ...rawScript, quotes: valid },
      invalid,
    );

    // 导演 pass（第二次 LLM 调用，只做节奏标注：全量 cue + 段后呼吸）。
    // 离线链路用宽松超时（15s/页并行）；模型不可用/超时保留原节奏，不阻断。
    let script = cleanedScript;
    let directorTrace = 'director=unavailable';
    if (isDirectorAvailable()) {
      const directed = await directBoardScript(cleanedScript, { perPageTimeoutMs: 15_000 });
      script = directed.script;
      directorTrace = `director=${directed.directedPages}/${directed.totalPages}(${directed.model})`;
    }

    const title = script.title || '这节课的板书';
    const actionCount = script.pages.reduce(
      (sum, page) => sum + page.segments.reduce((inner, segment) => inner + segmentActionCount(segment), 0),
      0,
    );
    const quoteStats: ExplainerQuoteStats = {
      total: rawScript.quotes.length,
      verified: valid.length,
      downgraded,
    };

    return {
      pluginId: 'explainer',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        ...traceExtras,
        'llm=enabled',
        `board_pages=${script.pages.length}`,
        `board_actions=${actionCount}`,
        `board_dropped=${dropped}`,
        `quotes_total=${quoteStats.total}`,
        `quotes_verified=${quoteStats.verified}`,
        `quotes_downgraded=${quoteStats.downgraded}`,
        directorTrace,
      ],
      cards: [
        {
          id: 'explainer-overview',
          type: 'insight',
          title,
          body:
            quoteStats.verified > 0
              ? `一段边写边讲的板书：${script.pages.length} 页板书；${quoteStats.verified} 处老师原话已逐字核对。`
              : `一段边写边讲的板书：${script.pages.length} 页板书。`,
          priority: 'high',
        },
      ],
      tasks: [],
      render: {
        mode: 'board',
        title,
        description: '黑板上边写边讲，圈点勾画跟着讲解走。',
        payload: {
          script,
          quoteStats,
        } satisfies ExplainerRenderPayload,
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
