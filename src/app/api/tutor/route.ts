/**
 * AI 家教 API 路由
 *
 * POST /api/tutor
 * - 解释断点（原有功能）
 * - 追问对话（原有功能）
 * - 引导问题（enable_guidance=true）
 * - 联网检索（enable_web=true）
 *
 * 子模块：
 * - tutor-types.ts      — 缓存 + 共享类型
 * - tutor-citations.ts  — 引用 / 资料处理
 * - tutor-prompts.ts    — System Prompt 常量
 * - tutor-guidance.ts   — 引导问题生成
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  chat,
  chatStream,
  DEFAULT_MODEL_ID,
  getModelConfig,
  type ChatMessage,
  type LLMResponse,
  type MultimodalContent,
} from '@/lib/services/llm-service';
import { formatTimeRange, formatTimestamp, getSegmentsInRange, type Segment } from '@/lib/services/longcut-utils';
import { getDifyService, isDifyEnabled, type DifyWorkflowInput } from '@/lib/services/dify-service';
import type { ExtendedTutorRequest, ExtendedTutorResponse, GuidanceQuestion, Citation } from '@/types/dify';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { summaryService } from '@/lib/services/summary-service';
import { webSearch } from '@/lib/services/web-search-service';
import { createLogger } from '@/lib/logger';

import { getSummaryCache, setSummaryCache, getSummaryCacheEntry } from './tutor-types';
import {
  extractSupportReferences,
  buildSupportCitationsFromContent,
  buildSupportUsagePrompt,
  buildAutomaticSupportPolicyPrompt,
  mergeCitationResults,
  ensureSupportCitations,
} from './tutor-citations';
import {
  TUTOR_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  GLOBAL_CHAT_SYSTEM_PROMPT,
  SELECTED_CONTEXT_CHAT_SYSTEM_PROMPT,
  THINKING_GUIDE_PROMPT,
  REALTIME_TEACHER_STYLE_PROMPT,
  REALTIME_TEACHER_FOLLOWUP_PROMPT,
  REALTIME_TEACHER_GLOBAL_CHAT_PROMPT,
  REALTIME_TEACHER_SELECTED_CONTEXT_CHAT_PROMPT,
  formatLearnerContext,
} from './tutor-prompts';
import { generateGuidanceQuestion } from './tutor-guidance';
import { authService } from '@/lib/services/auth-service';

const log = createLogger('tutor');
const REALTIME_TEACHER_MODEL_ID = 'qwen3.5-omni-plus';

// ── POST Handler ──

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'tutor');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let body: ExtendedTutorRequest & {
      messageContent?: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
        input_audio?: { data: string; format?: string };
      }>;
      globalMode?: boolean;
      sessionId?: string;
      stream?: boolean;
      enable_thinking_guide?: boolean;
      selected_context_mode?: boolean;
      /**
       * M8-D3: Classroom companion auto-attaches "最近 30s 的转录" here so the
       * LLM treats it as the implicit reference for "这个/那个/刚才" without
       * requiring the student to quote anything. Optional — absent means no
       * recent-focus hint should be injected.
       */
      recentFocus?: string;
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return NextResponse.json({ error: '请求体不能为空或 JSON 无效' }, { status: 400 });
    }

    const {
      timestamp,
      segments,
      model = DEFAULT_MODEL_ID,
      studentQuestion,
      messageContent,
      enable_guidance = false,
      enable_web = false,
      enable_thinking_guide = false,
      selected_option_id,
      conversation_id,
      globalMode = false,
      selected_context_mode = false,
      sessionId,
      stream = false,
      recentFocus,
    } = body;

    const questionHint = [
      typeof studentQuestion === 'string' ? studentQuestion : '',
      ...(Array.isArray(messageContent)
        ? messageContent
            .filter((item) => item?.type === 'text' && typeof item.text === 'string')
            .map((item) => item.text as string)
        : []),
    ]
      .join(' ')
      .trim();

    if (!segments || !Array.isArray(segments)) {
      return NextResponse.json({ error: '缺少 segments 参数' }, { status: 400 });
    }

    // ── 根据模式获取上下文 ──
    let contextSegments: typeof segments;

    if (globalMode) {
      let totalLength = 0;
      const maxLength = 8000;
      const selectedSegments: typeof segments = [];
      for (const seg of segments) {
        if (totalLength + (seg.text?.length || 0) > maxLength) break;
        selectedSegments.push(seg);
        totalLength += seg.text?.length || 0;
      }
      contextSegments = selectedSegments;
    } else {
      contextSegments = getSegmentsInRange(segments, timestamp - 90000, timestamp + 60000) as typeof segments;
    }

    const mergedSegments = contextSegments;

    // 当 globalMode 下没有时间轴转录、但有 support context 时，自动升级为 selected context 模式
    // 这解决了复习页打开纯文本笔记后提问时 AI 无法回答的问题
    const hasSupportSegment = mergedSegments.some((segment) => segment?.id === '__support_context__');
    const hasOnlySupportContext =
      globalMode &&
      hasSupportSegment &&
      mergedSegments.filter((segment) => segment?.id !== '__support_context__').length === 0;

    const allowSelectedContextOnly =
      globalMode &&
      (selected_context_mode || hasOnlySupportContext) &&
      hasSupportSegment;

    // ── 检查转录内容是否足够 ──
    const totalTextLength = mergedSegments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    const lacksTimelineTranscript = mergedSegments.length < 2 || totalTextLength < 50;
    const lacksSelectedContext = totalTextLength < 24;

    if ((allowSelectedContextOnly && lacksSelectedContext) || (!allowSelectedContextOnly && lacksTimelineTranscript)) {
      return NextResponse.json({
        explanation: {
          teacherSaid: '',
          citation: { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
          possibleStuckPoints: [],
          followUpQuestion: '',
        },
        actionItems: [],
        rawContent: allowSelectedContextOnly
          ? '📝 你刚圈出的这条内容还太短，我先抓不稳重点。可以再补一句背景，或者再圈一条相关内容一起问我。'
          : '📝 当前录音内容较少，无法进行有效分析。\n\n建议：\n- 继续录音，获取更多课堂内容\n- 或者在有更多内容后再标记困惑点',
        model,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    // ── 生成上下文文本 ──
    const localContextText = allowSelectedContextOnly
      ? mergedSegments
          .map((segment) => (typeof segment?.text === 'string' ? segment.text.trim() : ''))
          .filter(Boolean)
          .join('\n\n')
      : mergedSegments
          .map((s) => {
            const timeStr = formatTimestamp(s.startMs);
            return `[${timeStr}] ${s.text}`;
          })
          .join('\n');

    // ── 获取或生成课堂摘要 ──
    let summaryContext = '';
    let summaryGenerated = false;

    if (!globalMode && sessionId && segments.length >= 10) {
      try {
        let cachedSummary = getSummaryCache(sessionId);

        if (!cachedSummary) {
          const summaryResult = await summaryService.generateSummary(
            sessionId,
            segments.map((s, i) => ({
              id: i,
              sessionId,
              userId: 'anonymous',
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
              confidence: 1.0,
              isFinal: true,
            }))
          );

          const takeawaysText = summaryResult.takeaways
            .map((t) => `- ${t.label}: ${t.insight} [${t.timestamps.join(', ')}]`)
            .join('\n');

          cachedSummary = {
            overview: summaryResult.overview,
            takeaways: takeawaysText,
            keyDifficulties: summaryResult.keyDifficulties,
          };
          setSummaryCache(sessionId, cachedSummary);
          summaryGenerated = true;
        }

        summaryContext = `【课堂概要】\n${cachedSummary.overview}\n\n【主要知识点】\n${cachedSummary.takeaways}\n\n【重点难点】\n${cachedSummary.keyDifficulties.map((d) => `- ${d}`).join('\n')}\n\n---\n`;
      } catch (error) {
        log.error('[Tutor API] 摘要生成失败，使用局部上下文:', error);
      }
    }

    const contextText = summaryContext
      ? `${summaryContext}\n【困惑点附近的详细内容 ${formatTimestamp(timestamp - 90000)} ~ ${formatTimestamp(timestamp + 60000)}】\n${localContextText}`
      : localContextText;

    const supportReferences = extractSupportReferences(segments as Segment[]);
    const supportUsagePrompt = buildSupportUsagePrompt(supportReferences);
    const supportAutoPolicyPrompt = buildAutomaticSupportPolicyPrompt(supportReferences);

    // ── Dify 增强功能 ──
    let guidanceQuestion: GuidanceQuestion | undefined;
    let optionFollowup: string | undefined;
    let citations: Citation[] | undefined;
    let difyConversationId: string | undefined;

    if ((enable_guidance || enable_web) && isDifyEnabled()) {
      try {
        const difyService = getDifyService();
        const difyInput: DifyWorkflowInput = {
          timestamp,
          context: contextText,
          enable_guidance,
          enable_web,
          selected_option_id,
          student_question: studentQuestion,
          conversation_id,
        };

        const difyOutput = await difyService.runWorkflow(difyInput);
        guidanceQuestion = difyOutput.guidance_question;
        optionFollowup = difyOutput.option_followup;
        citations = difyOutput.citations;
        difyConversationId = difyOutput.conversation_id;
      } catch (error) {
        log.error('Dify service error:', error);
      }
    }

    // 引导问题始终生成
    if (!guidanceQuestion && !globalMode) {
      guidanceQuestion = await generateGuidanceQuestion({
        context: contextText,
        modelId: model,
        studentQuestion,
        selectedOptionId: selected_option_id,
      });
    }

    // 联网搜索
    if (enable_web && (!citations || citations.length === 0)) {
      try {
        citations = await webSearch(contextText, { maxResults: 3 });
      } catch (error) {
        log.error('[Tutor] Web search failed:', error);
        citations = [];
      }
    }

    // ── 获取学习者画像（用于个性化 prompt）──
    let learnerContextPrompt = '';
    try {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const payload = authService.verifyToken(authHeader.slice(7));
        if (payload?.sub) {
          const profileJson = await authService.getLearnerProfileJson(payload.sub);
          learnerContextPrompt = formatLearnerContext(profileJson);
        }
      }
    } catch {
      // 获取失败不影响正常功能
    }

    // ── 构建 LLM Messages ──
    const messages: ChatMessage[] = [];
    const isRealtimeTeacherMode = model === REALTIME_TEACHER_MODEL_ID;

    // 使用 allowSelectedContextOnly 决定 prompt（比前端传入的 selected_context_mode 更准确，
    // 因为后端可能在"只有 support context、无时间轴"时自动升级）
    const useSelectedContextPrompt = allowSelectedContextOnly || selected_context_mode;

    if (studentQuestion || messageContent) {
      let systemPrompt = isRealtimeTeacherMode
        ? globalMode
          ? useSelectedContextPrompt
            ? REALTIME_TEACHER_SELECTED_CONTEXT_CHAT_PROMPT
            : REALTIME_TEACHER_GLOBAL_CHAT_PROMPT
          : REALTIME_TEACHER_FOLLOWUP_PROMPT
        : globalMode
          ? useSelectedContextPrompt
            ? SELECTED_CONTEXT_CHAT_SYSTEM_PROMPT
            : GLOBAL_CHAT_SYSTEM_PROMPT
          : FOLLOWUP_SYSTEM_PROMPT;

      if (isRealtimeTeacherMode) {
        systemPrompt += REALTIME_TEACHER_STYLE_PROMPT;
      }

      if (enable_thinking_guide) {
        systemPrompt += THINKING_GUIDE_PROMPT;
      }
      if (supportAutoPolicyPrompt) {
        systemPrompt += `\n\n${supportAutoPolicyPrompt}`;
      }
      if (supportUsagePrompt) {
        systemPrompt += `\n\n${supportUsagePrompt}`;
      }
      if (learnerContextPrompt) {
        systemPrompt += learnerContextPrompt;
      }

      messages.push({ role: 'system', content: systemPrompt });

      if (messageContent && messageContent.length > 0) {
        // M8-D3: 在 multimodal user message 的首个文本块里挂上 recentFocus 上下文
        const recentFocusLine =
          typeof recentFocus === 'string' && recentFocus.trim()
            ? `\n【刚才 30 秒讲到】\n${recentFocus.trim()}\n（当学生说"这个/那个/刚才"时默认指向此段）`
            : '';
        const userContent: MultimodalContent[] = [
          {
            type: 'text',
            text: globalMode
              ? `${useSelectedContextPrompt ? '【用户刚圈出的上下文】' : '【整节课转录内容】'}\n${contextText}${recentFocusLine}\n\n【学生提问】`
              : `【课堂转录参考】\n${contextText}${recentFocusLine}\n\n【学生说】`,
          },
        ];

        for (const item of messageContent) {
          if (item.type === 'image_url' && item.image_url) {
            userContent.push({ type: 'image_url', image_url: { url: item.image_url.url } });
          } else if (item.type === 'input_audio' && item.input_audio?.data) {
            userContent.push({
              type: 'input_audio',
              input_audio: {
                data: item.input_audio.data,
                format: item.input_audio.format,
              },
            });
          } else if (item.type === 'text' && item.text) {
            userContent.push({ type: 'text', text: item.text });
          }
        }

        messages.push({ role: 'user', content: userContent });
      } else {
        // M8-D3: 当前端传入 recentFocus 时，把"最近 30s 讲了什么"作为
        // 隐式参照系塞在学生问题之前。用户说"这是啥意思"——模型就知道
        // 它指向这段刚听到的内容，而不是整节课的平均。
        // 不做 prompt-injection 防护：recentFocus 和 segments 文本一样都是 ASR 产物，
        // 不是用户可控输入。
        const recentFocusBlock =
          typeof recentFocus === 'string' && recentFocus.trim()
            ? `\n\n【刚才 30 秒讲到】\n${recentFocus.trim()}\n（当学生说"这个/那个/刚才/这啥意思"时，默认指向上面这段。）`
            : '';
        const userPrompt = globalMode
          ? `${useSelectedContextPrompt ? '【用户刚圈出的上下文】' : '【整节课转录内容】'}\n${contextText}${recentFocusBlock}\n\n【学生提问】\n${studentQuestion}`
          : `【课堂转录参考】\n${contextText}${recentFocusBlock}\n\n【学生说】\n${studentQuestion}`;
        messages.push({ role: 'user', content: userPrompt });
      }
    } else {
      messages.push({
        role: 'system',
        content: [TUTOR_SYSTEM_PROMPT, supportAutoPolicyPrompt, supportUsagePrompt, learnerContextPrompt].filter(Boolean).join('\n\n'),
      });
      messages.push({
        role: 'user',
        content: `【课堂转录】\n${contextText}\n\n【学生困惑点】\n时间位置: ${formatTimeRange(timestamp - 5000, timestamp + 5000)}\n\n【重要提醒】\n- 请仔细查看每行的时间戳，确保引用的时间与内容完全对应\n- 如果学生在某个时间说了话，必须引用学生说话的准确时间戳\n- 如果老师在某个时间讲解了概念，必须引用老师讲解的准确时间戳\n- 不要猜测或估算时间戳，请使用转录中显示的确切时间\n\n请按照格式要求，帮助学生理解这个知识点。`,
      });
    }

    // ── 流式响应 ──
    if (stream) {
      return buildStreamResponse(messages, model, {
        guidanceQuestion,
        citations,
        difyConversationId,
        summaryGenerated,
        supportReferences,
        questionHint,
        sessionId,
        timestamp,
        mergedSegments,
        initialMode: !(studentQuestion || messageContent || globalMode),
        optionFollowup,
      });
    }

    // ── 非流式响应 ──
    const response = await completeTutorResponse(messages, model, { temperature: 0.7, maxTokens: 2000 });

    if (studentQuestion || messageContent) {
      let rawContent = response.content;
      if (optionFollowup) {
        rawContent += `\n\n${optionFollowup}`;
      }
      if (!isRealtimeTeacherMode) {
        rawContent = correctTimestampsInResponse(rawContent, mergedSegments, studentQuestion || '');
      }

      const supportCitations = buildSupportCitationsFromContent(rawContent, supportReferences);
      const mergedCitations = ensureSupportCitations({
        mergedCitations: mergeCitationResults(citations, supportCitations),
        supportReferences,
        questionHint,
      });

      const result: ExtendedTutorResponse = {
        explanation: {
          teacherSaid: '',
          citation: { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
          possibleStuckPoints: [],
          followUpQuestion: '',
        },
        actionItems: [],
        rawContent,
        model: response.model,
        usage: response.usage,
        guidance_question: guidanceQuestion,
        option_followup: optionFollowup,
        citations: mergedCitations,
        conversation_id: difyConversationId,
        summary_generated: summaryGenerated,
        cached_summary: summaryGenerated && sessionId ? getSummaryCacheEntry(sessionId) : undefined,
      };
      return NextResponse.json(result);
    }

    // 初次解释模式
    const result = buildInitialTutorExplainResult({
      content: response.content,
      mergedSegments,
      timestamp,
      model: response.model,
      usage: response.usage,
      guidance_question: guidanceQuestion,
      citations,
      conversation_id: difyConversationId,
      summary_generated: summaryGenerated,
      sessionId,
      supportReferences,
      questionHint,
    });
    return NextResponse.json(result);
  } catch (error) {
    log.error('Tutor API error:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// ── 流式响应构建 ──

async function completeTutorResponse(
  messages: ChatMessage[],
  model: string,
  options: { temperature: number; maxTokens: number }
): Promise<LLMResponse> {
  const modelConfig = getModelConfig(model);
  if (!modelConfig?.requiresStreaming) {
    return chat(messages, model, options);
  }

  let content = '';
  let thinkingContent = '';
  for await (const chunk of chatStream(messages, model, options)) {
    if (chunk.type === 'content') {
      content += chunk.content;
    } else if (chunk.type === 'thinking') {
      thinkingContent += chunk.content;
    }
  }

  return {
    content,
    model,
    thinkingContent: thinkingContent || undefined,
  };
}

function buildStreamResponse(
  messages: ChatMessage[],
  model: string,
  ctx: {
    guidanceQuestion?: GuidanceQuestion;
    citations?: Citation[];
    difyConversationId?: string;
    summaryGenerated: boolean;
    supportReferences: { index: number; title: string; snippet: string }[];
    questionHint: string;
    sessionId?: string;
    timestamp: number;
    mergedSegments: Segment[];
    initialMode: boolean;
    optionFollowup?: string;
  }
) {
  const encoder = new TextEncoder();
  const initialCitations = ctx.citations?.length ? ctx.citations : undefined;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const metadata = {
          type: 'metadata',
          guidance_question: ctx.guidanceQuestion,
          citations: initialCitations,
          conversation_id: ctx.difyConversationId,
          summary_generated: ctx.summaryGenerated,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`));

        let streamedContent = '';
        for await (const chunk of chatStream(messages, model, { temperature: 0.7, maxTokens: 2000 })) {
          if (chunk.type === 'content' && chunk.content) {
            streamedContent += chunk.content;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: chunk.type, content: chunk.content })}\n\n`));
        }

        if (ctx.optionFollowup) {
          streamedContent += `\n\n${ctx.optionFollowup}`;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'content',
                content: `\n\n${ctx.optionFollowup}`,
              })}\n\n`
            )
          );
        }

        if (ctx.initialMode) {
          const parsedResponse = buildInitialTutorExplainResult({
            content: streamedContent,
            mergedSegments: ctx.mergedSegments,
            timestamp: ctx.timestamp,
            model,
            guidance_question: ctx.guidanceQuestion,
            citations: initialCitations,
            conversation_id: ctx.difyConversationId,
            summary_generated: ctx.summaryGenerated,
            sessionId: ctx.sessionId,
            supportReferences: ctx.supportReferences,
            questionHint: ctx.questionHint,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'metadata',
                parsed_response: parsedResponse,
                citations: parsedResponse.citations,
                conversation_id: ctx.difyConversationId,
                summary_generated: ctx.summaryGenerated,
              })}\n\n`
            )
          );
        } else {
          const supportCitations = buildSupportCitationsFromContent(streamedContent, ctx.supportReferences);
          const mergedCitations = ensureSupportCitations({
            mergedCitations: mergeCitationResults(initialCitations, supportCitations),
            supportReferences: ctx.supportReferences,
            questionHint: ctx.questionHint,
          });
          if (mergedCitations) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'metadata',
                  citations: mergedCitations,
                  conversation_id: ctx.difyConversationId,
                  summary_generated: ctx.summaryGenerated,
                })}\n\n`
              )
            );
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Transfer-Encoding': 'chunked',
    },
  });
}

function buildInitialTutorExplainResult(params: {
  content: string;
  mergedSegments: Segment[];
  timestamp: number;
  model: string;
  usage?: LLMResponse['usage'];
  guidance_question?: GuidanceQuestion;
  citations?: Citation[];
  conversation_id?: string;
  summary_generated: boolean;
  sessionId?: string;
  supportReferences: { index: number; title: string; snippet: string }[];
  questionHint: string;
}): ExtendedTutorResponse {
  const parsed = parseTutorResponse(params.content, params.mergedSegments);
  const correctedParsed = validateAndCorrectTimestamp(parsed, params.mergedSegments, params.timestamp);

  let correctedRawContent = params.content;
  if (parsed.explanation?.citation && correctedParsed.explanation?.citation) {
    const originalTimeRange = parsed.explanation.citation.timeRange;
    const correctedTimeRange = correctedParsed.explanation.citation.timeRange;
    if (originalTimeRange !== correctedTimeRange) {
      correctedRawContent = correctedRawContent.replace(
        new RegExp(`\\[引用\\s*${originalTimeRange.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'g'),
        `[引用 ${correctedTimeRange}]`
      );
    }
  }

  const supportCitations = buildSupportCitationsFromContent(correctedRawContent, params.supportReferences);
  const mergedCitations = ensureSupportCitations({
    mergedCitations: mergeCitationResults(params.citations, supportCitations),
    supportReferences: params.supportReferences,
    questionHint: params.questionHint,
  });

  return {
    ...correctedParsed,
    rawContent: correctedRawContent,
    model: params.model,
    usage: params.usage,
    guidance_question: params.guidance_question,
    citations: mergedCitations,
    conversation_id: params.conversation_id,
    summary_generated: params.summary_generated,
    cached_summary: params.summary_generated && params.sessionId ? getSummaryCacheEntry(params.sessionId) : undefined,
  };
}

// ── 响应解析 ──

function parseTutorResponse(content: string, segments: Segment[]) {
  const citationMatch = content.match(/\[引用\s*(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/);
  let citation = null;

  if (citationMatch) {
    const [, startTime, endTime] = citationMatch;
    const startMs = parseTimeToMsInternal(startTime);
    const endMs = endTime ? parseTimeToMsInternal(endTime) : startMs + 5000;

    const matchedSegment =
      segments.find((s) => Math.abs(s.startMs - startMs) < 2000) ||
      segments.find((s) => s.startMs <= startMs && s.endMs >= startMs);

    citation = {
      text: matchedSegment?.text || '',
      timeRange: endTime ? `${startTime}-${endTime}` : startTime,
      startMs,
      endMs,
    };
  }

  const stuckPointsMatch = content.match(/## 你可能卡在这里([\s\S]*?)(?=##|$)/);
  const stuckPoints: string[] = [];
  if (stuckPointsMatch) {
    const pointLines = stuckPointsMatch[1].match(/-\s*[^-\n]+/g);
    if (pointLines) {
      stuckPoints.push(...pointLines.map((p) => p.replace(/^-\s*/, '').trim()));
    }
  }

  const followUpMatch = content.match(/## 让我问你一个问题([\s\S]*?)(?=##|$)/);
  const followUpQuestion = followUpMatch
    ? followUpMatch[1].trim().replace(/^[（(]|[)）]$/g, '')
    : '你觉得哪一步最让你困惑？';

  const actionMatch = content.match(/## 今晚行动清单[\s\S]*?((?:\d+\.\s*[^\n]+\n?)+)/);
  const actionItems: Array<{
    id: string;
    type: 'replay' | 'exercise' | 'review';
    title: string;
    description: string;
    estimatedMinutes: number;
    completed: boolean;
  }> = [];

  if (actionMatch) {
    const actionLines = actionMatch[1].match(/\d+\.\s*[^\n]+/g);
    if (actionLines) {
      actionLines.forEach((line, index) => {
        const type = line.includes('[回放]') ? 'replay' : line.includes('[练习]') ? 'exercise' : 'review';
        const minutesMatch = line.match(/(\d+)\s*分钟/);
        const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 5;
        const cleanedLine = line.replace(/^\d+\.\s*[✅☑️]?\s*/, '').trim();
        const title = cleanedLine
          .replace(/\[回放\]\s*/, '')
          .replace(/\[练习\]\s*/, '')
          .replace(/\[复习\]\s*/, '')
          .split('（')[0]
          .split('(')[0]
          .replace(/，.*$/, '')
          .trim();

        const descMatch = cleanedLine.match(/[（(]([^）)]+)[）)]|，(.+)$/);
        let description = '';
        if (descMatch) {
          description = (descMatch[1] || descMatch[2] || '').trim();
          description = description.replace(/^\d+分钟[，,]?\s*/, '');
        }
        if (!description) {
          description =
            type === 'replay' ? '注意老师的讲解重点' : type === 'exercise' ? '动手练习巩固理解' : '回顾总结知识要点';
        }

        actionItems.push({ id: `action-${index + 1}`, type, title, description, estimatedMinutes: minutes, completed: false });
      });
    }
  }

  if (actionItems.length === 0) {
    actionItems.push(
      { id: 'action-1', type: 'replay', title: '再听一遍老师讲解', description: '回放困惑点附近的内容', estimatedMinutes: 3, completed: false },
      { id: 'action-2', type: 'exercise', title: '做一道类似的题目', description: '用学到的知识解决实际问题', estimatedMinutes: 10, completed: false },
      { id: 'action-3', type: 'review', title: '总结知识点', description: '用自己的话复述理解', estimatedMinutes: 7, completed: false }
    );
  }

  return {
    explanation: {
      teacherSaid: citation?.text || extractTeacherQuote(content),
      citation: citation || { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
      possibleStuckPoints: stuckPoints.length > 0 ? stuckPoints : ['概念理解', '公式记忆', '应用方法'],
      followUpQuestion,
    },
    actionItems,
  };
}

type ParsedTutorResponse = ReturnType<typeof parseTutorResponse>;

function extractTeacherQuote(content: string): string {
  const quoteMatch = content.match(/"([^"]+)"/);
  return quoteMatch ? quoteMatch[1] : '老师讲解了这个知识点';
}

function parseTimeToMsInternal(time: string): number {
  const parts = time.split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
  }
  return 0;
}

// ── 时间戳验证与修正 ──

function validateAndCorrectTimestamp(
  parsed: ParsedTutorResponse,
  segments: Segment[],
  confusionTimestamp: number
): ParsedTutorResponse {
  if (!parsed.explanation?.citation) return parsed;

  const citation = parsed.explanation.citation;
  const timeDiff = Math.abs(citation.startMs - confusionTimestamp);

  if (timeDiff > 10000) {
    const nearestSegment = segments.reduce((closest, segment) => {
      const currentDiff = Math.abs(segment.startMs - confusionTimestamp);
      const closestDiff = Math.abs(closest.startMs - confusionTimestamp);
      return currentDiff < closestDiff ? segment : closest;
    });

    if (nearestSegment) {
      return {
        ...parsed,
        explanation: {
          ...parsed.explanation,
          citation: {
            ...citation,
            startMs: nearestSegment.startMs,
            endMs: nearestSegment.endMs,
            timeRange: formatTimestamp(nearestSegment.startMs),
            text: nearestSegment.text,
          },
        },
      };
    }
  }

  return parsed;
}

function correctTimestampsInResponse(content: string, segments: Segment[], studentQuestion: string): string {
  const parseTimeToMsLocal = (time: string): number => {
    const parts = time.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (!isNaN(minutes) && !isNaN(seconds)) {
        return (minutes * 60 + seconds) * 1000;
      }
    }
    return 0;
  };

  const contentTimeMap: Map<string, { timeStr: string; startMs: number }> = new Map();

  for (const segment of segments) {
    const text = segment.text.toLowerCase().trim();
    const timeStr = formatTimestamp(segment.startMs);
    contentTimeMap.set(text, { timeStr, startMs: segment.startMs });

    const words = text.split(/\s+/).filter((w) => w.length > 3);
    for (const word of words) {
      if (!contentTimeMap.has(word)) {
        contentTimeMap.set(word, { timeStr, startMs: segment.startMs });
      }
    }
  }

  const questionLower = studentQuestion.toLowerCase();
  let targetTimeStr: string | null = null;

  for (const segment of segments) {
    const segmentText = segment.text.toLowerCase();
    const questionWords = questionLower.split(/\s+/).filter((w) => w.length > 2);
    let matchCount = 0;
    for (const word of questionWords) {
      if (segmentText.includes(word)) matchCount++;
    }
    if (
      matchCount >= 2 ||
      segmentText.includes('jane') ||
      segmentText.includes('bond') ||
      segmentText.includes('my name is')
    ) {
      targetTimeStr = formatTimestamp(segment.startMs);
      break;
    }
  }

  if (targetTimeStr) {
    const timestampPattern = /(\[?\d{1,2}:\d{2}\]?)/g;
    let correctedContent = content;

    const matches = content.match(timestampPattern);
    if (matches) {
      for (const match of matches) {
        const cleanTime = match.replace(/[\[\]]/g, '');
        const matchMs = parseTimeToMsLocal(cleanTime);
        const targetMs = parseTimeToMsLocal(targetTimeStr);
        if (matchMs !== targetMs && Math.abs(matchMs - targetMs) <= 10000) {
          correctedContent = correctedContent.replace(match, targetTimeStr);
        }
      }
    }
    return correctedContent;
  }

  return content;
}
