/**
 * 信息流服务 (Feed) — M15
 *
 * 替代笔记总结的 LLM 驱动信息流。
 * 核心区别：笔记总结是"全量要点清单"（同一节课所有人一样），
 * 信息流是"基于个人画像裁剪过的方向 + 延伸"（同一节课不同人不一样）。
 *
 * 输入：转录文本 + 笔记 + 困惑标记 + learnerProfile（bio + goals）
 * 输出：FeedItem[] —— 个人化总结 + 探针（near/lateral/bridge）+ 困惑关联
 *
 * 设计原则（对齐 AGENTS.md）：
 * - "回来的比发出去的更好"：不只是总结，还有延伸方向
 * - "小"：一个发现，三句话，不是长报告
 * - "有根"：每条都能指回转录时间戳
 * - The Bitter Lesson：产品层提供上下文，不用硬规则替模型判断
 */

import { chat, type ChatMessage } from './llm-service';
import type { TranscriptSegment } from '@/lib/db';
import type { FeedItem, FeedItemType, FeedActionType } from '@/types';
import { FeatureConfig } from '@/lib/config';
import { formatTranscriptWithTimestamps, parseJsonResponse } from '@/lib/utils';

// ============ 配置 ============

const DEFAULT_MODEL = FeatureConfig.feed.defaultModel;
const MAX_ITEMS = FeatureConfig.feed.maxItems;
const MAX_PROBES = FeatureConfig.feed.maxProbes;

// ============ 类型定义 ============

export interface GenerateFeedOptions {
  model?: string;
  /** 个人画像 */
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  /** 用户笔记（从 note-service 获取） */
  notes?: Array<{ text: string; source: string }>;
  /** 困惑标记 */
  confusions?: Array<{ text: string; timestampLabel?: string }>;
  /** 课程信息 */
  sessionInfo?: {
    subject?: string;
    topic?: string;
  };
}

interface RawFeedItem {
  type: string;
  title: string;
  body: string;
  timestamps?: string[];
  actionLabel?: string;
  actionType?: string;
  whyForYou?: string;
  captureId?: string;
}

interface RawFeedResult {
  items: RawFeedItem[];
}

// ============ Prompt 构建 ============

function buildFeedPrompt(
  segments: TranscriptSegment[],
  options: GenerateFeedOptions,
): string {
  const transcriptText = formatTranscriptWithTimestamps(segments);

  // 个人上下文段落
  const profileLines: string[] = [];
  if (options.learnerProfile?.bio?.headline) {
    profileLines.push(`这个人：${options.learnerProfile.bio.headline}`);
    if (options.learnerProfile.bio.detail) {
      profileLines.push(options.learnerProfile.bio.detail);
    }
  }
  const activeGoals = (options.learnerProfile?.goals ?? [])
    .filter((g) => !g.summary || g.summary !== 'completed')
    .slice(0, 3);
  if (activeGoals.length > 0) {
    profileLines.push('他正在追的事：');
    activeGoals.forEach((g) => {
      profileLines.push(`  · ${g.title}${g.summary ? `（${g.summary.slice(0, 50)}）` : ''}`);
    });
  }
  const profileSection = profileLines.length > 0
    ? profileLines.join('\n')
    : '（还没有个人画像信息）';

  // 笔记段落
  const notesSection = (options.notes ?? []).length > 0
    ? options.notes!.slice(0, 8).map((n) => `  · ${n.text}`).join('\n')
    : '（这节课没有笔记）';

  // 困惑标记段落
  const confusionsSection = (options.confusions ?? []).length > 0
    ? options.confusions!.map((c) => `  · ${c.text}${c.timestampLabel ? ` [${c.timestampLabel}]` : ''}`).join('\n')
    : '（没有标记困惑）';

  // 课程信息
  const sessionLine = options.sessionInfo?.subject || options.sessionInfo?.topic
    ? `${options.sessionInfo.subject ?? ''}${options.sessionInfo.topic ? ` · ${options.sessionInfo.topic}` : ''}`
    : '（未知课程）';

  return `<task>
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从这节课里挑出对他重要的部分，再给出他可能想接着看的方向。</role>
<context>
这是「${sessionLine}」的一节课。

【这个人】
${profileSection}

【他在这节课记的笔记】
${notesSection}

【他标记的困惑】
${confusionsSection}
</context>
<goal>生成一份信息流，不是全量总结，而是基于这个人的画像裁剪过的。让他感觉"这个同学真的懂我在学什么、我哪里卡住了"。</goal>
<instructions>
  <step name="个人化总结（1条，type=summary）">
    <description>2-3句话概括这节课的核心，但要从「对他」的角度写——基于他的目标/阶段/困惑，说这节课里哪些部分对他重要。</description>
    <example>你今天学了不定积分。换元法那段你标了困惑，而这恰好是考研高频题型——值得重点搞懂。</example>
  </step>
  <step name="延伸探针（${MAX_PROBES}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于他的画像和这节课内容，给出他可能想接着看的方向。每个方向一句话说清是什么，一句话说为什么对他重要。</description>
    <types>
      <item>probe-near：同主题的下一步（如这节课讲了积分，下一步是定积分）</item>
      <item>probe-lateral：相关方向（如基于考研目标，积分的应用题）</item>
      <item>probe-bridge：跨界关联（如编程里的数值积分）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须基于他的画像或困惑，不要编造。</criteria>
  </step>
  <step name="困惑关联（如有困惑标记，1-2条，type=confusion-link）">
    <description>把他标记的困惑点和课堂内容或前置知识关联起来，给他一个可以着手的下一步。</description>
    <example>你在换元法处标了困惑——这节课[15:30]老师讲了选 u 的技巧，可以先跳回去重听这段。</example>
  </step>
</instructions>
<qualityControl>
  <item>总条数不超过 ${MAX_ITEMS} 条</item>
  <item>每条 body 控制在 2 句话以内</item>
  <item>时间戳必须对应转录里的真实时刻</item>
  <item>不要面面俱到——省略对他不重要的部分</item>
  <item>不要用"建议""应该"这种指令语气——像旁边同学递话</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象：
{
  "items": [
    {
      "type": "summary" | "probe-near" | "probe-lateral" | "probe-bridge" | "confusion-link",
      "title": "标题（不超过12字）",
      "body": "2句话以内的说明",
      "timestamps": ["MM:SS"],
      "actionLabel": "动作按钮文案（如\"跳回去听\"、\"做成闪卡\"）",
      "actionType": "jump-timestamp" | "make-flashcard" | "ask-tutor" | "review-prev",
      "whyForYou": "为什么对他重要（基于画像，1句话）"
    }
  ]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
<transcript><![CDATA[
${transcriptText}
]]></transcript>
</task>`;
}

// ============ 验证与清理 ============

const VALID_TYPES: FeedItemType[] = [
  'summary', 'probe-near', 'probe-lateral', 'probe-bridge', 'confusion-link',
];

const VALID_ACTIONS: FeedActionType[] = [
  'jump-timestamp', 'make-flashcard', 'ask-tutor', 'review-prev',
];

function validateFeedItems(raw: RawFeedItem[]): FeedItem[] {
  return raw
    .filter((item) => item.title && item.body && VALID_TYPES.includes(item.type as FeedItemType))
    .map((item) => {
      const feedItem: FeedItem = {
        type: item.type as FeedItemType,
        title: item.title.slice(0, 20),
        body: item.body,
      };
      if (Array.isArray(item.timestamps) && item.timestamps.length > 0) {
        feedItem.timestamps = item.timestamps.slice(0, 2);
      }
      if (item.actionLabel) {
        feedItem.actionLabel = item.actionLabel.slice(0, 12);
      }
      if (item.actionType && VALID_ACTIONS.includes(item.actionType as FeedActionType)) {
        feedItem.actionType = item.actionType as FeedActionType;
      }
      if (item.whyForYou) {
        feedItem.whyForYou = item.whyForYou;
      }
      return feedItem;
    })
    .slice(0, MAX_ITEMS);
}

// ============ 主要导出函数 ============

/**
 * 生成基于个人上下文的信息流
 */
export async function generateFeed(
  sessionId: string,
  segments: TranscriptSegment[],
  options: GenerateFeedOptions = {},
): Promise<{ items: FeedItem[] }> {
  if (segments.length === 0) {
    throw new Error('转录内容为空');
  }

  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildFeedPrompt(segments, options);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  const response = await chat(messages, model, {
    temperature: 0.4,
    maxTokens: 1500,
    responseFormat: 'json_object',
  });

  const raw = parseJsonResponse<RawFeedResult>(response.content);

  if (!raw || !Array.isArray(raw.items)) {
    throw new Error('无法解析信息流响应');
  }

  return { items: validateFeedItems(raw.items) };
}

// ============ 跨课程信息流（M15：替代笔记总结的全局信息流） ============

export interface CrossCourseCapture {
  id: string;
  title: string;
  normalizedText?: string | null;
  contentType?: string;
  occurredAt?: string | null;
}

export interface GenerateCrossCourseFeedOptions {
  model?: string;
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
}

function buildCrossCoursePrompt(
  captures: CrossCourseCapture[],
  options: GenerateCrossCourseFeedOptions,
): string {
  // captures 段落：每条标题 + 截断正文
  const MAX_CAPTURE_TEXT = 800;
  const capturesSection = captures.slice(0, 12).map((c, i) => {
    const text = (c.normalizedText ?? '').slice(0, MAX_CAPTURE_TEXT);
    const when = c.occurredAt ? `（${c.occurredAt.slice(0, 10)}）` : '';
    return `【收集${i + 1}】${c.title}${when}\n${text || '（无正文，可能是图片/音频类收集）'}`;
  }).join('\n\n');

  // 个人上下文段落
  const profileLines: string[] = [];
  if (options.learnerProfile?.bio?.headline) {
    profileLines.push(`这个人：${options.learnerProfile.bio.headline}`);
    if (options.learnerProfile.bio.detail) {
      profileLines.push(options.learnerProfile.bio.detail);
    }
  }
  const activeGoals = (options.learnerProfile?.goals ?? [])
    .filter((g) => !g.summary || g.summary !== 'completed')
    .slice(0, 3);
  if (activeGoals.length > 0) {
    profileLines.push('他正在追的事：');
    activeGoals.forEach((g) => {
      profileLines.push(`  · ${g.title}${g.summary ? `（${g.summary.slice(0, 50)}）` : ''}`);
    });
  }
  const profileSection = profileLines.length > 0
    ? profileLines.join('\n')
    : '（还没有个人画像信息）';

  // 笔记段落（跨课程）
  const notesSection = (options.notes ?? []).length > 0
    ? (options.notes ?? []).slice(0, 10).map((n) => `  · ${n.text}`).join('\n')
    : '（还没有笔记）';

  return `<task>
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从他最近收集的内容里挑出对他重要的方向，再给出他可能想接着看的下一步。这里没有「一节课」的概念，而是他跨课程、跨来源一段时间内的收集。</role>
<context>
这是这个人最近收集的 ${captures.length} 条内容（课堂录音、文章、视频、笔记录音等都可能混在一起）。

【这个人】
${profileSection}

【他跨课程记的笔记】
${notesSection}

【他最近的收集】
${capturesSection || '（还没有收集内容）'}
</context>
<goal>生成一份跨课程信息流，不是每条收集的复述，而是基于这个人的画像从所有收集里提炼出「他现在最该关注的」+「他可以接着去的方向」。让他感觉"这个同学真的懂我在学什么、我手上攒了什么"。</goal>
<instructions>
  <step name="跨课程沉淀（1条，type=summary）">
    <description>2-3句话，概括他最近收集的整体走向——从他的目标/阶段角度，说这些内容合在一起在指向什么。不要逐条复述。</description>
    <example>你最近收的这几节课都在讲积分技巧，加上那篇换元法的文章——你在啃考研数学的硬骨头。</example>
  </step>
  <step name="延伸探针（${MAX_PROBES}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于他的画像和这些收集，给出他可能想接着看的方向。每个方向一句话说清是什么，一句话说为什么对他重要。</description>
    <types>
      <item>probe-near：同主题的下一步</item>
      <item>probe-lateral：相关方向</item>
      <item>probe-bridge：跨界关联（如编程/物理里对应的概念）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须基于他的画像或某条具体收集，不要编造。可以在 body 里用「来自《xxx》」指回某条收集的标题。</criteria>
  </step>
</instructions>
<qualityControl>
  <item>总条数不超过 ${MAX_ITEMS} 条</item>
  <item>每条 body 控制在 2 句话以内</item>
  <item>不要面面俱到——省略对他不重要的收集</item>
  <item>不要用"建议""应该"这种指令语气——像旁边同学递话</item>
  <item>不要输出时间戳——这是跨课程信息流，没有统一时间轴</item>
  <item>actionType 只用 open-capture（让用户跳回某条收集）或 ask-tutor；不要用 jump-timestamp</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象：
{
  "items": [
    {
      "type": "summary" | "probe-near" | "probe-lateral" | "probe-bridge",
      "title": "标题（不超过12字）",
      "body": "2句话以内的说明",
      "actionLabel": "动作按钮文案（如\"看这条收集\"、\"问同学\"）",
      "actionType": "open-capture" | "ask-tutor",
      "captureId": "若 actionType=open-capture，填对应收集的 id；否则省略",
      "whyForYou": "为什么对他重要（基于画像，1句话）"
    }
  ]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
</task>`;
}

const VALID_CC_TYPES: FeedItemType[] = [
  'summary', 'probe-near', 'probe-lateral', 'probe-bridge',
];
const VALID_CC_ACTIONS: FeedActionType[] = ['open-capture', 'ask-tutor'];

function validateCrossCourseItems(raw: RawFeedItem[]): FeedItem[] {
  return raw
    .filter((item) => item.title && item.body && VALID_CC_TYPES.includes(item.type as FeedItemType))
    .map((item) => {
      const feedItem: FeedItem = {
        type: item.type as FeedItemType,
        title: item.title.slice(0, 20),
        body: item.body,
      };
      if (item.actionLabel) {
        feedItem.actionLabel = item.actionLabel.slice(0, 12);
      }
      const action = item.actionType as FeedActionType | undefined;
      if (action && VALID_CC_ACTIONS.includes(action)) {
        feedItem.actionType = action;
      }
      if (item.whyForYou) {
        feedItem.whyForYou = item.whyForYou;
      }
      if (item.captureId) {
        feedItem.captureId = String(item.captureId);
      }
      return feedItem;
    })
    .slice(0, MAX_ITEMS);
}

/**
 * 跨课程信息流：基于 workspace 全部 captures + 画像 + 笔记生成。
 * 不依赖某节课的 transcript，产物无单课时间戳语义。
 */
export async function generateCrossCourseFeed(
  captures: CrossCourseCapture[],
  options: GenerateCrossCourseFeedOptions = {},
): Promise<{ items: FeedItem[] }> {
  if (captures.length === 0) {
    throw new Error('还没有收集内容');
  }

  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildCrossCoursePrompt(captures, options);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  const response = await chat(messages, model, {
    temperature: 0.4,
    maxTokens: 2400,
    responseFormat: 'json_object',
  });

  console.info('[feed.cross-course] response.prefix=', response.content.slice(0, 200));
  console.info('[feed.cross-course] response.usage=', response.usage);

  const raw = parseJsonResponse<RawFeedResult>(response.content);
  if (!raw || !Array.isArray(raw.items)) {
    console.error('[feed.cross-course] 解析失败, content.len=', response.content.length);
    throw new Error('无法解析信息流响应');
  }
  return { items: validateCrossCourseItems(raw.items) };
}

export const feedService = {
  generateFeed,
  generateCrossCourseFeed,
};
