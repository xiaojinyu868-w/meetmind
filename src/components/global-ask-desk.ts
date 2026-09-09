/**
 * global-ask-desk — 问同学空态的「书桌」（纯函数）。
 *
 * 空态原来是一个居中输入框加两句建议：看不出同桌此刻在读什么，也不知道它记得你什么。
 * 书桌把这些摆成可见可点的实物：正在读（当前课堂、打开的材料）、你标记的时刻、
 * 还没稳的概念、最近学过的、留下的长期理解。每一件点一下就变成一句指向具体位置的问题
 * （"00:30 那里我没跟上，从这讲一下"），输入框坐在这些上下文上面，而不是漂在渐变里。
 *
 * 只陈述事实，不推断学习风格；顺序是"此刻 → 最近 → 长期"。全空时返回空数组，UI 显示空桌面。
 */

import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import { conceptLabel, type MasteryTrailEntry } from '@/components/mastery-trail';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { formatTimestamp } from '@/lib/utils/time-utils';
import { clipDisplay, describeMoment, type MomentSegment } from '@/lib/learning/moment-title';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';

export type DeskGroupId = 'reading' | 'moments' | 'unstable' | 'recent' | 'memory';

export interface DeskItem {
  id: string;
  label: string;
  /** 右侧小字：时间点 / 状态词 / 类型 */
  meta?: string;
  /** 点击后填进输入框的问题 */
  prompt: string;
  tone?: 'pine' | 'vermilion';
  /** 这件事发生的时间（ISO；课 / 最近学过才有）——开口时能说"昨天听的" */
  at?: string;
}

export interface DeskGroup {
  id: DeskGroupId;
  title: string;
  items: DeskItem[];
  /** 超出展示上限的数量（只有正在读会有） */
  overflow?: number;
}

export interface DeskAnchor {
  id: string;
  timestamp: number;
  type: 'confusion' | 'important' | 'question';
  note?: string;
  resolved: boolean;
  cancelled: boolean;
}

export interface AskDeskInput {
  /** 当前课堂有转录（capture editor 里有 segments） */
  hasCurrentTranscript: boolean;
  /** 当前课堂的转录段：给「你标的」每个时刻起名（老师那一刻的原话），chip 不再只是一个时间 */
  segments?: readonly MomentSegment[];
  /** 当前课堂标题（可得时点名；不可得用"这节课"） */
  currentLessonTitle?: string;
  /** 当前课堂上课时间（ISO）；开口据此判断"刚听完"还是"那节" */
  currentLessonAt?: string;
  /** 当前会带进对话的材料标题（不含转录） */
  materialTitles: readonly string[];
  anchors: readonly DeskAnchor[];
  recentActivities: readonly LearningActivityEntry[];
  trail: readonly MasteryTrailEntry[];
  memories: readonly LearningMemoryEntry[];
}

/** 截断按显示宽度算（CJK 记 2、其余记 1），英文课名才不会在半句就被剪掉 */
const TITLE_MAX = 36;
const LABEL_MAX = 48;
const READING_MAX = 3;
const MOMENTS_MAX = 3;
const UNSTABLE_MAX = 3;
const RECENT_MAX = 2;
const MEMORY_MAX = 2;

const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function shortTitle(title: string, maxUnits = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  let units = 0;
  for (let i = 0; i < t.length; i += 1) {
    units += WIDE_CHAR.test(t[i]) ? 2 : 1;
    if (units > maxUnits) return `${t.slice(0, i).trimEnd()}…`;
  }
  return t;
}

function isGenericLessonTitle(title: string | undefined): boolean {
  return isPlaceholderLessonTitle(title) || title === GLOBAL_ASK_COPY.sourceCurrentLesson;
}

function displayWidth(text: string): number {
  let units = 0;
  for (const ch of text) units += WIDE_CHAR.test(ch) ? 2 : 1;
  return units;
}

/**
 * 能放进《》里念出来的才是标题。口袋收下的一句话（"这台设备上的课堂历史已同步到账号。"）、
 * 随手贴的对话（"hello 你好你好。感觉不对劲，为什么现在又可以了?"）都是内容，不是材料名——
 * 念成"帮我讲清《这台设备上的课堂历史已同步到账号。》里最难的地方"就露怯了。
 * 规则：不含句末标点、不以英文句号收尾（文件扩展名除外）、不长过 40 个汉字宽。
 */
export function isMaterialTitle(title: string | undefined): title is string {
  if (!title) return false;
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t || isPlaceholderLessonTitle(t)) return false;
  if (/[。！？!?…；;]/.test(t)) return false;
  if (/\.\s*$/.test(t) && !/\.[A-Za-z0-9]{1,5}$/.test(t)) return false;
  if (displayWidth(t) > 80) return false;
  return true;
}

/** "完成了「测验」"是活动描述，不是课名 */
function isActivityDescription(title: string): boolean {
  const prefix = GLOBAL_ASK_COPY.appActivity('').slice(0, -1);
  return prefix.length > 0 && title.startsWith(prefix);
}

/**
 * 长期理解的标题常是模型写的目标句（"关注线性规划的建模与转化能力"）；放进「」里念，
 * 开头的动词要去掉——"围绕「关注线性规划…」"不是人话。
 */
const LEADING_VERBS = /^(?:关注|学习|掌握|理解|提升|练习|巩固|复习|加强|正在学|在学|想学|想要|需要|希望)\s*/;
export function topicLabel(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const stripped = t.replace(LEADING_VERBS, '').trim();
  return stripped.length >= 2 ? stripped : t;
}

/** 记忆标题能不能念：不是一整句话、不长过 30 个汉字宽 */
function isSpeakableMemoryTitle(title: string): boolean {
  const t = title.trim();
  return t.length > 0 && !/[。！？!?…；;]/.test(t) && displayWidth(t) <= 60;
}

export function buildAskDesk(input: AskDeskInput): DeskGroup[] {
  const copy = GLOBAL_ASK_COPY.desk;
  const groups: DeskGroup[] = [];

  // 正在读：当前课堂 + 打开的材料
  const reading: DeskItem[] = [];
  if (input.hasCurrentTranscript) {
    const named = !isGenericLessonTitle(input.currentLessonTitle);
    reading.push({
      id: 'reading:current-lesson',
      label: named ? shortTitle(input.currentLessonTitle as string, LABEL_MAX) : copy.currentLesson,
      meta: named ? copy.currentLessonMeta : undefined,
      prompt: named ? copy.promptFromLesson(shortTitle(input.currentLessonTitle as string)) : copy.promptFromCurrentLesson,
      at: input.currentLessonAt,
    });
  }
  const materials = input.materialTitles.map((t) => t.trim()).filter(isMaterialTitle);
  for (const title of materials) {
    if (reading.length >= READING_MAX) break;
    reading.push({ id: `reading:${title}`, label: shortTitle(title, LABEL_MAX), prompt: copy.promptFromMaterial(shortTitle(title)) });
  }
  if (reading.length > 0) {
    const shown = reading.length - (input.hasCurrentTranscript ? 1 : 0);
    groups.push({ id: 'reading', title: copy.readingTitle, items: reading, overflow: Math.max(0, materials.length - shown) || undefined });
  }

  // 你标记的时刻：只在当前课堂有转录时出现——时刻属于这节课
  if (input.hasCurrentTranscript) {
    const live = input.anchors.filter((a) => !a.cancelled);
    const ordered = [...live].sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.timestamp - b.timestamp);
    const moments: DeskItem[] = ordered.slice(0, MOMENTS_MAX).map((anchor) => {
      const time = formatTimestamp(anchor.timestamp);
      const note = anchor.note?.trim();
      // 时刻的名字：学生备注 → 老师那一刻的原话首句（moment-title，与复习页困惑点列表、同桌开场同一套命名）
      const named = describeMoment(anchor, input.segments ?? []);
      const quoteTitle = named.source === 'quote' ? clipDisplay(named.title) : '';
      return {
        id: `moment:${anchor.id}`,
        label: quoteTitle ? `${time} · ${quoteTitle}` : time,
        meta: note ? shortTitle(note, 24) : copy.anchorType[anchor.type],
        prompt: anchor.type === 'important'
          ? copy.promptFromImportant(time)
          : note
            ? copy.promptFromNotedMoment(time, shortTitle(note, TITLE_MAX))
            : named.title
              ? copy.promptFromNamedMoment(time, named.title)
              : copy.promptFromMoment(time),
        tone: anchor.type === 'confusion' && !anchor.resolved ? 'vermilion' : undefined,
      };
    });
    if (moments.length > 0) groups.push({ id: 'moments', title: copy.momentsTitle, items: moments });
  }

  // 还没稳 / 刚记住：检验留下的事实。还没稳的先上桌（轨迹本身已这样排，这里不依赖它）
  const unstable: DeskItem[] = [...input.trail]
    .filter((entry) => entry.status !== 'stable')
    .sort((a, b) => Number(a.status !== 'unstable') - Number(b.status !== 'unstable'))
    .slice(0, UNSTABLE_MAX)
    .map((entry) => {
      const label = conceptLabel(entry.concept);
      return {
        id: `concept:${entry.concept}`,
        label,
        meta: entry.status === 'unstable' ? GLOBAL_ASK_COPY.masteryTrail.statusUnstable : GLOBAL_ASK_COPY.masteryTrail.statusImproving,
        prompt: entry.status === 'unstable' ? copy.promptFromUnstable(label) : copy.promptFromImproving(label),
        tone: entry.status === 'unstable' ? 'vermilion' : 'pine',
      };
    });
  if (unstable.length > 0) groups.push({ id: 'unstable', title: copy.unstableTitle, items: unstable });

  // 最近学过：没有当前课堂时才需要它把人接回上一节
  if (!input.hasCurrentTranscript) {
    // 应用活动的标题是"完成了「测验」"，课名要顺着 sessionId 找回那节课
    // "昨天听的"指的是听课那天，不是做应用那天——时间也跟着课走
    const lessonBySession = new Map<string, { title: string; at: string }>();
    for (const activity of input.recentActivities) {
      if (activity.kind === 'lesson' && activity.sessionId && activity.title.trim()) {
        lessonBySession.set(activity.sessionId, { title: activity.title.trim(), at: activity.occurredAt });
      }
    }
    const seen = new Set<string>();
    const recent: DeskItem[] = [];
    for (const activity of [...input.recentActivities].reverse()) {
      if (activity.kind !== 'lesson' && activity.kind !== 'app') continue;
      let title = activity.title.trim();
      let at = activity.occurredAt;
      if (activity.kind === 'app') {
        const lesson = activity.sessionId ? lessonBySession.get(activity.sessionId) : undefined;
        if (lesson) { title = lesson.title; at = lesson.at; }
        else if (isActivityDescription(title)) continue;
      }
      if (!isMaterialTitle(title) || seen.has(title)) continue;
      seen.add(title);
      recent.push({
        id: `recent:${activity.id}`,
        label: shortTitle(title, LABEL_MAX),
        meta: activity.kind === 'app' && activity.appKey ? GLOBAL_ASK_COPY.masteryTrail.stepLabels[activity.appKey] : undefined,
        prompt: copy.promptFromRecent(shortTitle(title)),
        at,
      });
      if (recent.length >= RECENT_MAX) break;
    }
    if (recent.length > 0) groups.push({ id: 'recent', title: copy.recentTitle, items: recent });
  }

  // 长期理解：还没过去的困惑先出现，其后是在学的主题（偏好 / 长处 / 进度不是问题的起点，不上桌）
  const memoryRank: Partial<Record<LearningMemoryEntry['kind'], number>> = { challenge: 0, topic: 1 };
  const memory: DeskItem[] = [...input.memories]
    .filter((m) => m.status === 'active' && m.kind in memoryRank && isSpeakableMemoryTitle(m.title))
    .sort((a, b) => (memoryRank[a.kind] ?? 9) - (memoryRank[b.kind] ?? 9))
    .slice(0, MEMORY_MAX)
    .map((m) => {
      const label = topicLabel(m.title);
      return {
        id: `memory:${m.id}`,
        label: shortTitle(label, LABEL_MAX),
        meta: m.kind === 'challenge' ? copy.memoryChallenge : copy.memoryTopic,
        prompt: m.kind === 'challenge' ? copy.promptFromChallenge(shortTitle(label)) : copy.promptFromTopic(shortTitle(label)),
        tone: m.kind === 'challenge' ? 'vermilion' : undefined,
      } as DeskItem;
    });
  if (memory.length > 0) groups.push({ id: 'memory', title: copy.memoryTitle, items: memory });

  return groups;
}
