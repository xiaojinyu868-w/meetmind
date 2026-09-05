/**
 * Studio Workshop Plugin — multi-format learning app generator.
 *
 * Supports: podcast / video / report / infographic / slides / table / general.
 * Sub-modules:
 *   - studio-workshop.types.ts    — types, constants, mode/parse helpers
 *   - studio-workshop.podcast.ts  — podcast pipeline (plan, assembly, pollution, rounds)
 *   - studio-workshop.renderers.ts — render payload builders (slides, infographic, etc.)
 */
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import {
  generateVolcPodcast,
  isVolcPodcastEnabled,
  type VolcPodcastResult,
} from '@/lib/services/volc-podcast';
import {
  generateInfographicImage,
  isInfographicImageEnabled,
} from '@/lib/services/infographic-image-provider';
import {
  buildInfographicSkillSystemPrompt,
  buildInfographicSkillUserPrompt,
  assembleInfographicImagePrompt,
  INFOGRAPHIC_PRESET,
} from '@/lib/services/infographic-skill-service';
import type {
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginTools,
} from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

import type { StudioMode, StudioOutput } from './studio-workshop.types';
import {
  MODE_HINTS,
  detectMode,
  resolveRenderMode,
  modeRole,
  modeContract,
  formatTimestamp,
  toTimestamp,
  toStringArray,
  toMatrix,
  toDialogue,
  pickEvidenceSegments,
} from './studio-workshop.types';
import {
  resolvePodcastTimeoutMs,
  sanitizePodcastNarration,
  generatePodcastPlan,
  hasTimestampPollution,
  buildPodcastInputText,
  buildPodcastRoundCards,
  selectPodcastScriptLines,
} from './studio-workshop.podcast';
import {
  generateDashscopePodcast,
  isDashscopePodcastEnabled,
} from '@/lib/services/dashscope-podcast';
import { buildInfographicDraft, buildRenderPayload } from './studio-workshop.renderers';

// ── LLM: generic studio output ────────────────────────────────────

async function generateStudioOutput(
  context: AppExecutionContext,
  model: string,
  mode: StudioMode,
  transcriptContext: string,
  anchorContext: string,
  controlledSystemPrompt?: string,
): Promise<StudioOutput | null> {
  // 信息图走 skill 管线:手册材料(基座模板+预设画风+预设版式)进 system,
  // LLM 单次过整节课转录,直接产出可交生图模型的完整提示词。
  const systemPrompt = controlledSystemPrompt || (mode === 'infographic'
    ? buildInfographicSkillSystemPrompt()
    : `你是${modeRole(mode)}，目标是把课堂内容转成可直接使用的学习产物。严格基于课堂证据，不编造。输出纯 JSON。`);
  const userPrompt = mode === 'infographic'
    ? buildInfographicSkillUserPrompt({
        goalIntent: context.goal.intent,
        transcriptContext,
        anchorContext,
        terminologyHint: context.memory.terminologyHint,
      })
    : `应用目标：${context.goal.intent}
应用形态：${MODE_HINTS[mode]}
用户目标：用更低的认知成本完成课堂复盘，直接可用，不要"模板化空话"。

最小输出契约（仅字段约束）：
${modeContract(mode)}

说明：
- 你可以自由决定模块数量与结构层次
- startMs/endMs/relatedTimestamp 为可选证据定位字段，不确定可留空
- 文风要自然、可执行、可复述

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}` : ''}${buildTerminologyHintBlock(context.memory.terminologyHint)}`;
  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    model,
    { temperature: 0.25, maxTokens: mode === 'infographic' ? 6000 : 2800, responseFormat: 'json_object' }
  );

  const output = parseJsonResponse<StudioOutput>(response.content);
  // 信息图:生图提示词由代码按手册基座模板确定性拼装(LLM 只出内容,不抄模板),
  // 防止 LLM 留下 {{CONTENT}} 空占位符导致生图模型自由发挥跑题。
  if (mode === 'infographic' && output?.infographic) {
    output.infographic.imagePrompt = assembleInfographicImagePrompt({
      title: output.infographic.title?.trim() || output.title?.trim() || '课堂信息图',
      subtitle: output.infographic.subtitle?.trim() || '',
      keyPoints: toStringArray(output.infographic.keyPoints, 8),
      contentOutline: (output.infographic as { contentOutline?: string }).contentOutline?.trim()
        || toStringArray(output.infographic.keyPoints, 8).join('\n'),
      textLabels: toStringArray((output.infographic as { textLabels?: unknown }).textLabels, 40),
    });
  }
  return output;
}

// ── Plugin export ──────────────────────────────────────────────────

export const studioWorkshopPlugin: AppPlugin = {
  manifest: {
    id: 'studio-workshop',
    name: '学习应用工坊',
    version: '0.2.0',
    description: '一个插件驱动多种小程序形态，支持播客/报告/信息图/幻灯片/数据表。',
    tags: ['studio', 'apps', 'multi-format'],
    capabilities: ['multi-app', 'structured-output', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    return context.input.transcript.length > 0;
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const mode = detectMode(context.goal.intent, context.goal.appKey);
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 56,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(context.input.transcript, 8);
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;
    const trace: string[] = [
      `intent=${context.goal.intent}`,
      `app_key=${context.goal.appKey || 'none'}`,
      `mode=${mode}`,
      `model=${model}`,
      `transcript_segments=${context.input.transcript.length}`,
      `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
      `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
    ];

    let output: StudioOutput | null = null;
    let podcastPlan: import('./studio-workshop.types').PodcastPlan | null = null;
    if (mode === 'podcast') {
      try {
        podcastPlan = await generatePodcastPlan(context, model, context.runtimeControl?.systemPrompt);
        trace.push('llm=podcast_plan_enabled');
      } catch {
        podcastPlan = null;
        trace.push('llm=podcast_plan_fallback');
      }
      trace.push('podcast_pipeline=volc_direct');
    } else {
      try {
        output = await generateStudioOutput(context, model, mode, promptContext.text, anchorContext, context.runtimeControl?.systemPrompt);
        trace.push('llm=enabled');
      } catch {
        output = null;
        trace.push('llm=fallback');
      }
    }

    const fallbackSummary =
      mode === 'podcast'
        ? '基于课堂证据直接生成真实播客音频与双人脚本。'
        : '请继续采集课堂内容后重试。';
    const defaultTitle = mode === 'podcast' ? '课堂播客' : '学习应用结果';
    const podcastPlanSummary = podcastPlan
      ? [
          podcastPlan.opening || '',
          ...(Array.isArray(podcastPlan.keyTakeaways) ? podcastPlan.keyTakeaways.slice(0, 3) : []),
        ]
          .map((item) => sanitizePodcastNarration(String(item || '').trim()))
          .filter(Boolean)
          .join(' ')
      : '';

    const cards: AppExecutionResult['cards'] = [
      {
        id: 'studio-overview',
        type: 'insight',
        title: output?.title?.trim() || defaultTitle,
        body:
          output?.summary?.trim() ||
          podcastPlanSummary ||
          tools.summarizeSegments(context.input.transcript, 260) ||
          fallbackSummary,
        priority: 'high',
      },
    ];

    if (mode !== 'podcast') {
      (output?.cards || []).slice(0, 12).forEach((draft, index) => {
        const fallback = evidenceSegments[index % Math.max(1, evidenceSegments.length)];
        const startMs = toTimestamp(draft.startMs, fallback?.startMs || 0);
        const endMs = toTimestamp(draft.endMs, fallback?.endMs || startMs + 8000);
        const bullets = toStringArray(draft.bullets, 10);
        const columns = toStringArray(draft.columns, 8);
        const rows = toMatrix(draft.rows, Math.max(1, columns.length || 3), 24);
        const dialogue = toDialogue(draft.dialogue);

        cards.push({
          id: `studio-card-${index + 1}`,
          type: 'timeline',
          title: draft.title?.trim() || `输出模块 ${index + 1}`,
          body: draft.body?.trim() || fallback?.text || '',
          priority: index < 3 ? 'high' : 'medium',
          citations: fallback
            ? [
                {
                  startMs,
                  endMs,
                  snippet: fallback.text.slice(0, 120),
                },
              ]
            : undefined,
          actions: [
            {
              id: `seek-studio-${index + 1}`,
              label: `回放 ${formatTimestamp(startMs)}`,
              kind: 'seek',
              payload: { timestamp: startMs },
            },
          ],
          meta: {
            cardKind: draft.cardKind || mode,
            bullets,
            columns,
            rows,
            dialogue,
          },
        });
      });
    }

    if (cards.length === 1) {
      evidenceSegments.slice(0, 3).forEach((segment, index) => {
        cards.push({
          id: `studio-fallback-${index + 1}`,
          type: 'timeline',
          title: `证据模块 ${index + 1}`,
          body: segment.text,
          priority: index === 0 ? 'high' : 'medium',
          citations: [
            {
              startMs: segment.startMs,
              endMs: segment.endMs,
              snippet: segment.text.slice(0, 120),
            },
          ],
          actions: [
            {
              id: `seek-fallback-${index + 1}`,
              label: `回放 ${formatTimestamp(segment.startMs)}`,
              kind: 'seek',
              payload: { timestamp: segment.startMs },
            },
          ],
        });
      });
    }

    let podcastResult: VolcPodcastResult | null = null;
    let podcastError = '';
    if (mode === 'podcast') {
      // provider 一行切换：dashscope（默认；百炼 qwen3-tts 逐句合成 + ffmpeg 拼接，
      // 复用已付费 DASHSCOPE_API_KEY）/ volc（火山 podcasttts 一键成品，账号需在
      // 控制台开通 volc.service_type.10050，否则建连 403）。
      const provider = (process.env.PODCAST_TTS_PROVIDER || 'dashscope').trim().toLowerCase();
      trace.push(`podcast_provider=${provider}`);
      trace.push(`podcast_plan=${podcastPlan ? 'yes' : 'no'}`);
      if (provider === 'volc') {
        const enabled = isVolcPodcastEnabled();
        trace.push(`podcast_enabled=${enabled ? 'true' : 'false'}`);
        if (enabled) {
          try {
            const podcastInput = buildPodcastInputText(context, output, evidenceSegments, cards, podcastPlan);
            const podcastTimeoutMs = resolvePodcastTimeoutMs(podcastInput.length);
            trace.push(`podcast_input_chars=${podcastInput.length}`);
            trace.push(`podcast_timeout_ms=${podcastTimeoutMs}`);
            podcastResult = await generateVolcPodcast({
              inputText: podcastInput,
              timeoutMs: podcastTimeoutMs,
              format: 'mp3',
              sampleRate: 24000,
              speechRate: 0,
              useHeadMusic: false,
              useTailMusic: false,
            });
            if (hasTimestampPollution(podcastResult.rounds)) {
              trace.push('podcast_retry=timestamp_pollution_detected');
              const retryInput = buildPodcastInputText(context, output, evidenceSegments, cards, podcastPlan, true);
              const retryTimeoutMs = resolvePodcastTimeoutMs(retryInput.length);
              trace.push(`podcast_retry_input_chars=${retryInput.length}`);
              trace.push(`podcast_retry_timeout_ms=${retryTimeoutMs}`);
              podcastResult = await generateVolcPodcast({
                inputText: retryInput,
                timeoutMs: retryTimeoutMs,
                format: 'mp3',
                sampleRate: 24000,
                speechRate: 0,
                useHeadMusic: false,
                useTailMusic: false,
              });
            }
            trace.push(`podcast_rounds=${podcastResult.roundCount}`);
            trace.push(`podcast_audio_url=${podcastResult.audioUrl ? 'yes' : 'no'}`);
            trace.push(`podcast_audio_bytes=${podcastResult.audioBytes}`);
          } catch (error) {
            podcastError = error instanceof Error ? error.message : '播客生成失败';
            trace.push(`podcast_error=${podcastError}`);
          }
        } else {
          podcastError =
            '未配置火山播客参数（VOLCENGINE_PODCAST_APP_ID / VOLCENGINE_PODCAST_ACCESS_TOKEN）。';
        }
      } else if (isDashscopePodcastEnabled()) {
        try {
          const scriptLines = selectPodcastScriptLines(podcastPlan, cards);
          trace.push(`podcast_script_lines=${scriptLines.length}`);
          const startedAt = Date.now();
          const ds = await generateDashscopePodcast(scriptLines);
          trace.push(`podcast_dashscope_ms=${Date.now() - startedAt}`);
          trace.push(`podcast_audio_bytes=${ds.audioBytes}`);
          podcastResult = {
            inputId: `dashscope_${Date.now()}`,
            sessionId: context.input.sessionId,
            requestId: `dashscope_${Date.now()}`,
            audioUrl: ds.audioUrl,
            audioBytes: ds.audioBytes,
            roundCount: ds.lines.length,
            rounds: ds.lines.map((line, index) => ({
              roundId: index + 1,
              speaker: line.speaker,
              text: line.text,
            })),
            usage: { inputTextTokens: 0, outputAudioTokens: 0 },
            events: {},
            trace: [],
          };
        } catch (error) {
          podcastError = error instanceof Error ? error.message : '播客生成失败';
          trace.push(`podcast_error=${podcastError}`);
        }
      } else {
        podcastError = '未配置 DASHSCOPE_API_KEY，播客语音合成不可用。';
      }

      // 「不出音频不算好」：与信息图同一契约——音频没拿到（含上游 403/超时/未配置）
      // 整个 execute 报错，前端卡片进失败重试态；不再出现"做好了"却只能看脚本的假完成。
      if (!podcastResult?.audioUrl) {
        throw new Error(`播客出音频失败：${podcastError || '未返回可播放音频'}`);
      }

      const roundCards = buildPodcastRoundCards(podcastResult?.rounds || [], evidenceSegments);
      if (roundCards.length > 0) {
        cards.push(...roundCards);
        trace.push(`podcast_script_cards=${roundCards.length}`);
      }
    }

    const tasks = (output?.tasks || []).slice(0, 6).map((task, index) => ({
      id: `studio-task-${index + 1}`,
      label: task.label?.trim() || `完成应用步骤 ${index + 1}`,
      reason: task.reason?.trim() || '根据结果完成一次复述或输出。',
      estimatedMinutes: typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : 5,
      relatedTimestamp:
        typeof task.relatedTimestamp === 'number'
          ? task.relatedTimestamp
          : evidenceSegments[index % Math.max(1, evidenceSegments.length)]?.startMs,
    }));

    if (mode === 'podcast' && tasks.length === 0) {
      tasks.push({
        id: 'studio-task-listen',
        label: '完整试听一次播客',
        reason: '确认信息完整度与节奏是否符合课堂复盘需求。',
        estimatedMinutes: 8,
        relatedTimestamp: evidenceSegments[0]?.startMs ?? 0,
      });
    }

    const renderMode = resolveRenderMode(mode);
    const infographicDraft = mode === 'infographic' ? buildInfographicDraft(output, cards) : undefined;

    // 一键生成 = 真的出图。draft 出来后直接串一次图片生成(横版,预设画风在 skill 管线里)。
    // 「不出图不算好」:生图失败先自动重试一次,仍失败则整个 execute 报错——
    // 前端只会提示失败重试,不会再出现"做好了"却点进去干等的情况。
    let infographicImage:
      | { imageUrl: string; requestId: string; model: string }
      | undefined;
    if (mode === 'infographic' && infographicDraft) {
      if (!isInfographicImageEnabled()) {
        throw new Error('未配置图片生成服务的 API Key,请先完成环境变量配置。');
      }
      const imgStart = Date.now();
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 2 && !infographicImage; attempt += 1) {
        try {
          const imgResult = await generateInfographicImage({
            prompt: infographicDraft.imagePrompt,
            stylePreset: INFOGRAPHIC_PRESET.stylePresetLabel,
            orientation: INFOGRAPHIC_PRESET.orientation,
            detailLevel: infographicDraft.suggestedDetailLevel,
            scenePreset: infographicDraft.suggestedScene,
          });
          // 写服务端文件返回 HTTP URL——base64 data URL 太大,进 localStorage 会被
          // stripLargeInlineData 剥空、进分享 snapshotJson 也不可靠(分享页没图)。
          // 动态 import 避免客户端 bundle fs。
          const { persistInfographicImage } = await import('@/lib/services/infographic-image-storage');
          infographicImage = {
            imageUrl: persistInfographicImage(imgResult.base64, imgResult.mimeType, imgResult.requestId || 'infographic'),
            requestId: imgResult.requestId,
            model: imgResult.model,
          };
          trace.push(`infographic_image=ok`);
          trace.push(`infographic_image_ms=${Date.now() - imgStart}`);
          if (attempt > 1) trace.push(`infographic_image_retry=${attempt}`);
        } catch (error) {
          lastError = error;
          trace.push(`infographic_image=error_attempt_${attempt}`);
        }
      }
      if (!infographicImage) {
        const message = lastError instanceof Error ? lastError.message : '图片生成失败';
        trace.push(`infographic_image_error=${message.slice(0, 120)}`);
        throw new Error(`信息图出图失败:${message}`);
      }
    }

    return {
      pluginId: 'studio-workshop',
      version: '0.2.0',
      model,
      trace,
      cards,
      tasks,
      render: {
        mode: renderMode,
        title: output?.title?.trim() || defaultTitle,
        description: output?.summary?.trim() || MODE_HINTS[mode],
        payload: buildRenderPayload({
          renderMode,
          cards,
          output,
          evidenceSegments,
          podcastResult,
          podcastError,
          mode,
          infographicImage,
        }),
      },
      raw: {
        generatedAt: tools.now(),
        mode,
        appKey: context.goal.appKey || undefined,
        infographicDraft,
        infographicImageUrl: infographicImage?.imageUrl,
        infographicImageRequestId: infographicImage?.requestId,
        infographicImageModel: infographicImage?.model,
        podcastPlan: podcastPlan || undefined,
        podcast: podcastResult
          ? {
              inputId: podcastResult.inputId,
              sessionId: podcastResult.sessionId,
              requestId: podcastResult.requestId,
              audioUrl: podcastResult.audioUrl,
              audioBytes: podcastResult.audioBytes,
              roundCount: podcastResult.roundCount,
              usage: podcastResult.usage,
            }
          : undefined,
        podcastError: podcastError || undefined,
      },
    };
  },
};
