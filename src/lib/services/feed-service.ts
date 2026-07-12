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
import type { FeedItem, FeedItemType, FeedActionType } from '@/types';
import { FeatureConfig } from '@/lib/config';
import { formatTranscriptWithTimestamps, parseJsonResponse } from '@/lib/utils';
import { webSearchExact } from '@/lib/services/web-search-service';
import type { FeedPreference } from '@/lib/feed-preferences';

// ============ 配置 ============

const DEFAULT_MODEL = FeatureConfig.feed.defaultModel;
const MAX_ITEMS = FeatureConfig.feed.maxItems;
const MAX_PROBES = FeatureConfig.feed.maxProbes;

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
  reason: string;
  sourceCaptureIds?: string[];
  goalLabel?: string;
}

interface ExternalCandidate {
  result: { title: string; url: string; snippet?: string };
  discovery: RawExternalDiscovery;
  score: number;
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
}

export interface GenerateCrossCourseFeedOptions {
  model?: string;
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
  feedback?: FeedPreference[];
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
    return `【收集${i + 1}】[id=${c.id}] ${c.title}${when}\n${text || '（无正文，可能是图片/音频类收集）'}`;
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
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从他最近收集的内容里挑出对他重要的方向，再给出他可能想接着看的下一步。这里没有「一节课」的概念，而是他跨课程、跨来源一段时间内的收集。</role>
<context>
这是这个人最近收集的 ${captures.length} 条内容（课堂录音、文章、视频、笔记录音等都可能混在一起）。

【这个人】
${profileSection}

【他跨课程记的笔记】
${notesSection}

【他对过去推荐的反馈】
${feedbackSection}

【他最近的收集】
${capturesSection || '（还没有收集内容）'}
</context>
<goal>生成一份跨课程信息流，不是每条收集的复述。从真实收藏、明确目标和过去反馈中判断现在值得关注的方向。</goal>
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
  <item>同时生成 1-2 个用于外部检索的精确查询，不要直接编造外部内容</item>
  <item>不要把用户归类成固定人群。查询必须同时来至这次真实收藏上下文和用户当前目标</item>
  <item>尊重过去反馈：延续“有用”内容的价值类型，避免与“不相关”内容重复选题，但不要由一次反馈永久封闭一个主题</item>
  <item>禁止心理诊断和隐性动机推断：不要使用“焦虑投射”“强迫”“安全感”等缺少用户明确表达的心理归因。只描述可见的收藏、目标和行为</item>
  <item>每个查询必须返回 1-3 个 sourceCaptureIds；有匹配目标时返回真实 goalLabel，没有就留空，禁止编造</item>
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
      "reason": "它与用户哪条收藏或哪个目标相关",
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
  const internalItems = validateCrossCourseItems(raw.items);

  // 外部发现必须由 MeetMind 服务端完成，不向用户暴露搜索配置或插件。
  // 用模型已筛出的关键方向做查询，避免对整份收藏进行无目的广泛搜索。
  let externalItems: FeedItem[] = [];
  try {
    const fallbackDiscovery: RawExternalDiscovery = {
      query: internalItems.filter((item) => item.type !== 'summary').slice(0, 2).map((item) => item.title).join(' ') || captures[0].title,
      reason: '延伸你最近收集的主题',
      sourceCaptureIds: captures.slice(0, 2).map((capture) => capture.id),
    };
    const discoveries = (raw.externalDiscoveries ?? [])
      .filter((item) => item.query && item.reason)
      .slice(0, 2);
    const activeDiscoveries = discoveries.length > 0 ? discoveries : [fallbackDiscovery];
    const searchTasks = activeDiscoveries.flatMap((discovery) => [
      { discovery, query: discovery.query.slice(0, 180) },
      { discovery, query: `${discovery.query.slice(0, 130)} site:edu OR site:org OR filetype:pdf` },
    ]);
    const resultGroups = await Promise.all(searchTasks.map(async ({ discovery, query }) => ({
      discovery,
      results: await webSearchExact(query, {
        maxResults: 10,
        language: 'zh-CN',
        market: 'zh-CN',
      }),
    })));

    const seenUrls = new Set<string>();
    const candidates: ExternalCandidate[] = resultGroups
      .flatMap(({ discovery, results }) => results
        .filter((result) => isAcceptableExternalResult(result.url))
        .map((result) => ({ result, discovery, score: scoreExternalResult(result.url) })))
      .filter((candidate) => candidate.score >= 4)
      .sort((a, b) => b.score - a.score)
      .filter(({ result }) => {
        const normalized = result.url.replace(/[#?].*$/, '');
        if (seenUrls.has(normalized)) return false;
        seenUrls.add(normalized);
        return true;
      })
      .slice(0, 16);

    const selectedCandidates = await rankExternalCandidates(candidates, options, model);
    externalItems = selectedCandidates.map(({ candidate, qualityReason }) => {
      const { result, discovery } = candidate;
      return {
        type: 'web-recommend' as const,
        title: result.title.slice(0, 60),
        body: (result.snippet ?? '').slice(0, 240),
        contentUrl: result.url,
        upName: getExternalSourceLabel(result.url),
        actionType: 'open-external' as const,
        actionLabel: '打开原文',
        whyForYou: `${discovery.reason}${qualityReason ? `；${qualityReason}` : ''}`.slice(0, 180),
        sourceCaptureIds: filterValidCaptureIds(discovery.sourceCaptureIds, captures),
        goalLabel: filterValidGoalLabel(discovery.goalLabel, options.learnerProfile?.goals),
      };
    });
  } catch (error) {
    console.warn('[feed.cross-course] external discovery failed:', error);
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
  const hostname = getExternalSourceLabel(url).toLowerCase();
  let score = 1;
  if (/\.(edu|ac)\.|\.edu$|\.ac$|\.gov\.|\.gov$|\.org$/.test(hostname)) score += 3;
  if (/(doi\.org|arxiv\.org|nature\.com|science\.org|ieee\.org|acm\.org|pubmed|jstor\.org|archive\.org|museum|library|press\.)/.test(hostname)) score += 3;
  if (/(^|\.)docs\.|developer\.mozilla\.org|learn\.microsoft\.com|github\.com/.test(hostname)) score += 3;
  return score;
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
  candidates: ExternalCandidate[],
  options: GenerateCrossCourseFeedOptions,
  model: string,
): Promise<Array<{ candidate: ExternalCandidate; qualityReason?: string }>> {
  if (candidates.length === 0) return [];

  const goals = (options.learnerProfile?.goals ?? []).slice(0, 3).map((goal) => goal.title).join('、') || '未设置';
  const candidateText = candidates.map((candidate, index) => (
    `[${index}] ${candidate.result.title}\n来源：${getExternalSourceLabel(candidate.result.url)}\n摘要：${candidate.result.snippet ?? ''}\n推荐线索：${candidate.discovery.reason}`
  )).join('\n\n');

  const prompt = `<task>
<role>你是 MeetMind 的信息编辑。你只在真实搜索候选中做选择，不生成新链接。</role>
<context>用户当前目标：${goals}</context>
<criteria>
  <item>最多选 3 条，可以一条都不选</item>
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
    return (ranked?.selected ?? [])
      .filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < candidates.length)
      .filter((item) => {
        if (seenIndexes.has(item.index)) return false;
        seenIndexes.add(item.index);
        return true;
      })
      .slice(0, 3)
      .map((item) => ({
        candidate: candidates[item.index],
        qualityReason: item.qualityReason?.slice(0, 80),
      }));
  } catch (error) {
    console.warn('[feed.cross-course] external ranking failed:', error);
    return candidates
      .filter((candidate) => candidate.score >= 4)
      .slice(0, 3)
      .map((candidate) => ({ candidate }));
  }
}

function getExternalSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '外部资料';
  }
}

export const feedService = {
  generateFeed,
  generateCrossCourseFeed,
};
