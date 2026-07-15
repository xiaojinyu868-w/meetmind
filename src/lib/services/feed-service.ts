/**
 * 信息流服务 (Feed) — M15
 *
 * 替代笔记总结的 LLM 驱动信息流。
 * 核心区别：笔记总结是"全量要点清单"（同一节课所有人一样），
 * 信息流是"基于真实上下文与当前目标裁剪过的方向 + 延伸"。
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
import type { FeedItem, FeedItemType, FeedActionType, FeedContentKind, FeedPerspective } from '@/types';
import { FeatureConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { formatTranscriptWithTimestamps, parseJsonResponse } from '@/lib/utils';
import {
  retrieveExternalCandidates,
  scoreSource,
  type ExternalDiscoveryBrief,
  type ExternalFeedCandidate,
} from './feed-retrieval-service';
import type { FeedPreference } from '@/lib/feed-preferences';

// ============ 配置 ============

const DEFAULT_MODEL = FeatureConfig.feed.defaultModel;
const MAX_ITEMS = FeatureConfig.feed.maxItems;
const MAX_PROBES = FeatureConfig.feed.maxProbes;
const log = createLogger('feed-cross-course');

// ============ 类型定义 ============

export interface GenerateFeedOptions {
  model?: string;
  /** 用户明确提供的个人上下文与当前目标 */
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
  externalDiscoveries?: RawExternalDiscovery[];
}

interface RawExternalDiscovery {
  query: string;
  academicQuery?: string;
  bookQuery?: string;
  reason: string;
  perspective?: FeedPerspective;
  contentKinds?: FeedContentKind[];
  sourceCaptureIds?: string[];
  goalLabel?: string;
}

interface RawExternalRankResult {
  selected?: Array<{ index: number; qualityReason?: string }>;
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
    : '（还没有明确的个人上下文或目标）';

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
<goal>生成一份信息流，不是全量总结。只根据用户明确提供的目标、笔记、困惑和课堂证据做取舍。</goal>
<instructions>
  <step name="个人化总结（1条，type=summary）">
    <description>2-3句话概括这节课的核心，但要从「对他」的角度写——基于他的目标/阶段/困惑，说这节课里哪些部分对他重要。</description>
    <example>你今天学了不定积分。换元法那段你标了困惑，而这恰好是考研高频题型——值得重点搞懂。</example>
  </step>
  <step name="延伸探针（${MAX_PROBES}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于当前目标、笔记、困惑和课堂内容，给出可能值得接着看的方向。</description>
    <types>
      <item>probe-near：同主题的下一步（如这节课讲了积分，下一步是定积分）</item>
      <item>probe-lateral：相关方向（如基于考研目标，积分的应用题）</item>
      <item>probe-bridge：跨界关联（如编程里的数值积分）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须引用明确目标、笔记或困惑；没有根据就省略，不要编造。</criteria>
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
      "whyForYou": "为什么现在对他有用（必须有真实上下文根据）"
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
  source?: {
    platformLabel?: string;
    author?: string;
    contentState?: 'received' | 'extracting' | 'complete' | 'partial' | 'link-only' | 'failed';
    completeness?: number;
  };
}

export interface GenerateCrossCourseFeedOptions {
  model?: string;
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
  feedback?: FeedPreference[];
  learningContext?: {
    activeThread?: { title: string; intent?: string; lastSummary?: string; nextStep?: string };
    memories?: Array<{ title: string; detail?: string; kind?: string }>;
    recentActivities?: Array<{ title: string; detail?: string; kind?: string }>;
  };
}

export function buildCrossCoursePrompt(
  captures: CrossCourseCapture[],
  options: GenerateCrossCourseFeedOptions,
): string {
  // captures 段落：每条标题 + 截断正文
  const MAX_CAPTURE_TEXT = 800;
  const capturesSection = captures.slice(0, 12).map((c, i) => {
    const text = (c.normalizedText ?? '').slice(0, MAX_CAPTURE_TEXT);
    const when = c.occurredAt ? `（${c.occurredAt.slice(0, 10)}）` : '';
    const sourceBits = [c.source?.platformLabel, c.source?.author].filter(Boolean).join(' · ');
    const stateLabel = c.source?.contentState === 'complete'
      ? '正文完整'
      : c.source?.contentState === 'partial'
        ? '只有摘要'
        : c.source?.contentState === 'link-only'
          ? '只有原链接'
          : c.source?.contentState === 'failed'
            ? '正文读取失败'
            : c.source?.contentState === 'extracting'
              ? '正文仍在读取'
              : '';
    const provenanceLine = sourceBits || stateLabel
      ? `来源：${sourceBits || '未标注'}${stateLabel ? `；${stateLabel}` : ''}`
      : '';
    return `【收集${i + 1}】[id=${c.id}] ${c.title}${when}\n${provenanceLine}${provenanceLine ? '\n' : ''}${text || '（没有可验证正文，只能使用标题和来源，不能推断文章观点）'}`;
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
    : '（还没有明确的个人上下文或目标）';

  const learningContextLines: string[] = [];
  if (options.learningContext?.activeThread?.title) {
    const thread = options.learningContext.activeThread;
    learningContextLines.push(`正在继续：${thread.title}`);
    if (thread.intent) learningContextLines.push(`目标：${thread.intent}`);
    if (thread.lastSummary) learningContextLines.push(`已经对齐：${thread.lastSummary}`);
    if (thread.nextStep) learningContextLines.push(`下一步：${thread.nextStep}`);
  }
  for (const memory of options.learningContext?.memories?.slice(-8) ?? []) {
    learningContextLines.push(`长期线索：${memory.title}${memory.detail ? `（${memory.detail.slice(0, 100)}）` : ''}`);
  }
  for (const activity of options.learningContext?.recentActivities?.slice(-6) ?? []) {
    learningContextLines.push(`最近做过：${activity.title}${activity.detail ? `（${activity.detail.slice(0, 100)}）` : ''}`);
  }
  const learningContextSection = learningContextLines.length > 0
    ? learningContextLines.join('\n')
    : '（还没有持续学习线索）';

  // 笔记段落（跨课程）
  const notesSection = (options.notes ?? []).length > 0
    ? (options.notes ?? []).slice(0, 10).map((n) => `  · ${n.text}`).join('\n')
    : '（还没有笔记）';

  const feedbackSection = (options.feedback ?? []).length > 0
    ? (options.feedback ?? []).slice(0, 12).map((item) => (
        `  · ${item.rating === 'up' ? '有用' : '不相关'}：${item.title}${item.whyForYou ? `（${item.whyForYou}）` : ''}`
      )).join('\n')
    : '（还没有信息流反馈）';

  return `<task>
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从他的学习线和最近收集里挑出重要方向，再给出他可能想接着看的下一步。即使暂时没有新收藏，只要他刚确认了明确目标，也可以从那条学习线出发寻找真实资料。</role>
<context>
这个人最近有 ${captures.length} 条可用收集；同时保留了他正在推进的学习线。

【这个人】
${profileSection}

【正在形成的学习线】
${learningContextSection}

【他跨课程记的笔记】
${notesSection}

【他对过去推荐的反馈】
${feedbackSection}

【他最近的收集】
${capturesSection || '（还没有收集内容）'}
</context>
<goal>生成一份跨课程信息流，不是每条收集的复述。从真实收藏、明确目标、学习活动和过去反馈中判断现在值得关注的方向。</goal>
<instructions>
  <step name="跨课程沉淀（1条，type=summary）">
    <description>2-3句话，概括他最近收集的整体走向——从他的目标/阶段角度，说这些内容合在一起在指向什么。不要逐条复述。</description>
    <example>你最近收的这几节课都在讲积分技巧，加上那篇换元法的文章——你在啃考研数学的硬骨头。</example>
  </step>
  <step name="延伸探针（${MAX_PROBES}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于明确目标、收藏内容和反馈，给出现在值得接着看的方向。</description>
    <types>
      <item>probe-near：同主题的下一步</item>
      <item>probe-lateral：相关方向</item>
      <item>probe-bridge：跨界关联（如编程/物理里对应的概念）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须指回某条真实收藏、目标或反馈；没有根据就省略。</criteria>
  </step>
</instructions>
<qualityControl>
  <item>总条数不超过 ${MAX_ITEMS} 条</item>
  <item>每条 body 控制在 2 句话以内</item>
  <item>不要面面俱到——省略对他不重要的收集</item>
  <item>不要用"建议""应该"这种指令语气——像旁边同学递话</item>
  <item>不要输出时间戳——这是跨课程信息流，没有统一时间轴</item>
  <item>actionType 只用 open-capture（让用户跳回某条收集）或 ask-tutor；不要用 jump-timestamp</item>
  <item>同时生成 3 个用于外部检索的检索计划，不要直接编造外部内容：至少 1 个 deepen，至少 1 个 counterpoint</item>
  <item>不要把用户归类成固定人群。查询必须同时来至这次真实收藏上下文和用户当前目标</item>
  <item>counterpoint 不是随机猎奇：它要与当前问题共享事实基础，但提供不同学科、不同方法或不同立场，帮助用户检验原有判断</item>
  <item>contentKinds 从 web / paper / book / report 中选 1-3 种；学术问题优先包含 paper，人文与长期理解优先包含 book</item>
  <item>academicQuery 使用适合论文数据库的英文主题词；bookQuery 使用适合图书目录的主题、作者或经典书名线索。没有必要时可以省略</item>
  <item>尊重过去反馈：延续“有用”内容的价值类型，避免与“不相关”内容重复选题，但不要由一次反馈永久封闭一个主题</item>
  <item>禁止心理诊断和隐性动机推断：不要使用“焦虑投射”“强迫”“安全感”等缺少用户明确表达的心理归因。只描述可见的收藏、目标和行为</item>
  <item>有真实收藏时，每个查询返回 1-3 个 sourceCaptureIds；没有收藏但有明确学习线时，sourceCaptureIds 允许为空，必须把查询落到真实 activeThread / memory，并用对应标题作为 goalLabel</item>
  <item>优先使用“正文完整”的收藏形成结论；“只有摘要”只能支持有限判断；“只有原链接/读取失败”的内容不得据此概括原文观点</item>
  <item>来源平台和作者只是可信度线索，不代表内容一定正确；推荐理由仍要落到实际正文和用户目标</item>
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
      "whyForYou": "为什么现在对他有用（必须有真实上下文根据）"
    }
  ],
  "externalDiscoveries": [
    {
      "query": "可直接交给搜索引擎的精确查询，包含主题、内容类型与必要的来源限定",
      "academicQuery": "适合论文数据库的英文关键词，可省略",
      "bookQuery": "适合图书目录的中英文关键词，可省略",
      "reason": "它与用户哪条收藏或哪个目标相关",
      "perspective": "deepen | adjacent | counterpoint",
      "contentKinds": ["web", "paper", "book", "report"],
      "sourceCaptureIds": ["上下文中真实的收藏 id"],
      "goalLabel": "上下文中真实的目标标题，无匹配时省略"
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
    .filter((item) => !containsUnsupportedPsychology(`${item.title} ${item.body} ${item.whyForYou ?? ''}`))
    .map((item) => {
      const feedItem: FeedItem = {
        type: item.type as FeedItemType,
        title: item.title.slice(0, 20),
        body: item.body,
      };
      if (item.actionLabel && !/^暂?无|不操作|无需/.test(item.actionLabel)) {
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
 * 跨课程信息流：基于 workspace 收藏 + 明确目标 + 笔记 + 反馈生成。
 * 不依赖某节课的 transcript，产物无单课时间戳语义。
 */
export async function generateCrossCourseFeed(
  captures: CrossCourseCapture[],
  options: GenerateCrossCourseFeedOptions = {},
): Promise<{ items: FeedItem[] }> {
  const hasLearningContext = Boolean(
    options.learningContext?.activeThread?.title
      || options.learningContext?.memories?.length
      || options.learnerProfile?.goals?.length,
  );
  if (captures.length === 0 && !hasLearningContext && !(options.learnerProfile?.goals?.length)) {
    throw new Error('还没有可用于生成情报的学习上下文');
  }

  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildCrossCoursePrompt(captures, options);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  const response = await chat(messages, model, {
    temperature: 0.4,
    maxTokens: 2400,
    responseFormat: 'json_object',
  });

  log.info('generation completed', {
    responseChars: response.content.length,
    usage: response.usage,
  });

  const raw = parseJsonResponse<RawFeedResult>(response.content);
  if (!raw || !Array.isArray(raw.items)) {
    log.error('response parse failed', { responseChars: response.content.length });
    throw new Error('无法解析信息流响应');
  }
  const internalItems = validateCrossCourseItems(raw.items);

  // 外部发现由 MeetMind 服务端完成：先检索真实网页/论文/书籍，再让模型只做候选排序。
  let externalItems: FeedItem[] = [];
  try {
    const fallbackDiscovery: RawExternalDiscovery = {
      query: internalItems.filter((item) => item.type !== 'summary').slice(0, 2).map((item) => item.title).join(' ')
        || captures[0]?.title
        || options.learningContext?.activeThread?.title
        || options.learningContext?.memories?.at(-1)?.title
        || options.learnerProfile?.goals?.[0]?.title
        || '学习方法',
      reason: captures.length > 0 ? '延伸你最近收集的主题' : '沿着你正在推进的学习目标补充真实资料',
      perspective: 'deepen',
      contentKinds: ['web', 'paper', 'book'],
      sourceCaptureIds: captures.slice(0, 2).map((capture) => capture.id),
      goalLabel: options.learningContext?.activeThread?.title || options.learnerProfile?.goals?.[0]?.title,
    };
    const discoveries = (raw.externalDiscoveries ?? [])
      .filter((item) => item.query && item.reason)
      .slice(0, 3);
    const activeDiscoveries = (discoveries.length > 0 ? discoveries : [fallbackDiscovery])
      .map(normalizeDiscoveryBrief);
    const candidates = (await retrieveExternalCandidates(activeDiscoveries))
      .filter((candidate) => isAcceptableExternalResult(candidate.url));

    const selectedCandidates = await rankExternalCandidates(candidates, options, model);
    externalItems = selectedCandidates.map(({ candidate, qualityReason }) => {
      const { discovery } = candidate;
      return {
        type: 'web-recommend' as const,
        title: candidate.title.slice(0, 100),
        body: candidate.snippet.slice(0, 360),
        contentUrl: candidate.url,
        upName: candidate.sourceLabel,
        coverUrl: candidate.coverUrl,
        contentKind: candidate.contentKind,
        authors: candidate.authors,
        publishedAt: candidate.publishedAt,
        perspective: discovery.perspective,
        actionType: 'open-external' as const,
        actionLabel: '打开原文',
        // 每张卡只展示一段理由。优先用排序阶段针对该条材料的增量说明，
        // 再用 goalLabel 独立告知它对齐了哪个目标；不把两段“为什么相关”拼在一起。
        whyForYou: (qualityReason || discovery.reason).slice(0, 120),
        sourceCaptureIds: filterValidCaptureIds(discovery.sourceCaptureIds, captures),
        goalLabel: filterValidGoalLabel(discovery.goalLabel, [
          ...(options.learnerProfile?.goals ?? []),
          ...(options.learningContext?.activeThread?.title
            ? [{ title: options.learningContext.activeThread.title }]
            : []),
        ]),
      };
    });
  } catch (error) {
    log.warn('external discovery failed', error);
  }

  return { items: [...internalItems, ...externalItems] };
}

const LOW_QUALITY_HOSTS = ['baijiahao.baidu.com', 'sohu.com', '163.com', 'blog.csdn.net'];

export function isAcceptableExternalResult(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return !LOW_QUALITY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function scoreExternalResult(url: string): number {
  return scoreSource(url);
}

export function containsUnsupportedPsychology(value: string): boolean {
  return /焦虑投射|细节强迫症|零容忍心态|寻找.{0,8}安全感|消除.{0,8}不确定性/.test(value);
}

export function filterValidCaptureIds(
  candidateIds: string[] | undefined,
  captures: CrossCourseCapture[],
): string[] {
  const validIds = new Set(captures.map((capture) => capture.id));
  return [...new Set(candidateIds ?? [])].filter((id) => validIds.has(id)).slice(0, 3);
}

export function filterValidGoalLabel(
  candidate: string | undefined,
  goals: Array<{ title: string }> | undefined,
): string | undefined {
  if (!candidate) return undefined;
  const matched = (goals ?? []).find((goal) => goal.title === candidate);
  return matched?.title.slice(0, 60);
}

async function rankExternalCandidates(
  candidates: ExternalFeedCandidate[],
  options: GenerateCrossCourseFeedOptions,
  model: string,
): Promise<Array<{ candidate: ExternalFeedCandidate; qualityReason?: string }>> {
  if (candidates.length === 0) return [];

  const goals = [
    ...(options.learnerProfile?.goals ?? []).slice(0, 3).map((goal) => goal.title),
    ...(options.learningContext?.activeThread?.title ? [options.learningContext.activeThread.title] : []),
  ].join('、') || '未设置';
  const candidateText = candidates.map((candidate, index) => (
    `[${index}] ${candidate.title}\n类型：${candidate.contentKind}\n来源：${candidate.sourceLabel}\n作者：${candidate.authors?.join('、') || '未标注'}\n出版：${candidate.publishedAt || '未标注'}\n摘要：${candidate.snippet}\n视角：${candidate.discovery.perspective}\n推荐线索：${candidate.discovery.reason}`
  )).join('\n\n');

  const prompt = `<task>
<role>你是 MeetMind 的信息编辑。你只在真实搜索候选中做选择，不生成新链接。</role>
<context>用户当前目标：${goals}</context>
<criteria>
  <item>选 3-4 条，可以一条都不选；如果候选质量足够，至少包含 1 条 paper 或 book</item>
  <item>必须包含 1 条 perspective=counterpoint 的候选，除非所有 counterpoint 候选都明显低质或不相关</item>
  <item>先判断对这次收藏上下文是否有新信息，再判断来源是否配得上这个问题</item>
  <item>研究问题优先原始论文、大学、机构或方法文档；人文问题优先原始文本、档案、出版机构和有编辑责任的长文；实用问题优先官方文档和可验证实例</item>
  <item>拒绝 SEO 内容农场、无来源转载、只重复已知内容的浅摘要</item>
  <item>qualityReason 用一个短句说明这个来源带来的增量，不要宣称没有证据的权威性</item>
</criteria>
<candidates>
${candidateText}
</candidates>
<output>只返回 JSON：{"selected":[{"index":0,"qualityReason":"增量理由"}]}</output>
</task>`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], model, {
      temperature: 0.1,
      maxTokens: 700,
      responseFormat: 'json_object',
    });
    const ranked = parseJsonResponse<RawExternalRankResult>(response.content);
    const seenIndexes = new Set<number>();
    const selected = (ranked?.selected ?? [])
      .filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < candidates.length)
      .filter((item) => {
        if (seenIndexes.has(item.index)) return false;
        seenIndexes.add(item.index);
        return true;
      })
      .slice(0, 4)
      .map((item) => ({
        candidate: candidates[item.index],
        qualityReason: item.qualityReason?.slice(0, 80),
      }));
    return ensureExternalMix(selected, candidates);
  } catch (error) {
    log.warn('external ranking failed', error);
    const fallback = candidates
      .filter((candidate) => candidate.sourceScore >= 4)
      .slice(0, 4)
      .map((candidate) => ({ candidate }));
    return ensureExternalMix(fallback, candidates);
  }
}

function normalizeDiscoveryBrief(discovery: RawExternalDiscovery): ExternalDiscoveryBrief {
  const validKinds: FeedContentKind[] = ['web', 'paper', 'book', 'report'];
  const contentKinds = (discovery.contentKinds ?? [])
    .filter((kind): kind is FeedContentKind => validKinds.includes(kind));
  return {
    query: discovery.query.slice(0, 180),
    academicQuery: discovery.academicQuery?.slice(0, 180),
    bookQuery: discovery.bookQuery?.slice(0, 180),
    reason: discovery.reason.slice(0, 180),
    perspective: ['deepen', 'adjacent', 'counterpoint'].includes(discovery.perspective ?? '')
      ? discovery.perspective as FeedPerspective
      : 'adjacent',
    contentKinds: contentKinds.length > 0 ? contentKinds : ['web', 'paper', 'book'],
    sourceCaptureIds: discovery.sourceCaptureIds,
    goalLabel: discovery.goalLabel,
  };
}

function ensureExternalMix(
  selected: Array<{ candidate: ExternalFeedCandidate; qualityReason?: string }>,
  candidates: ExternalFeedCandidate[],
): Array<{ candidate: ExternalFeedCandidate; qualityReason?: string }> {
  const output = [...selected];
  if (output.length === 0) return output;
  const selectedUrls = new Set(output.map((item) => item.candidate.url));
  const addCandidate = (candidate: ExternalFeedCandidate | undefined): void => {
    if (!candidate || selectedUrls.has(candidate.url)) return;
    if (output.length >= 4) output.pop();
    output.push({ candidate });
    selectedUrls.add(candidate.url);
  };
  if (!output.some((item) => item.candidate.discovery.perspective === 'counterpoint')) {
    addCandidate(candidates.find((candidate) => candidate.discovery.perspective === 'counterpoint'));
  }
  if (!output.some((item) => ['paper', 'book'].includes(item.candidate.contentKind))) {
    addCandidate(candidates.find((candidate) => ['paper', 'book'].includes(candidate.contentKind)));
  }
  return output.slice(0, 4);
}

export const feedService = {
  generateFeed,
  generateCrossCourseFeed,
};
