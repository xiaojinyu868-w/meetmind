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

export type DeskGroupId = 'reading' | 'moments' | 'unstable' | 'recent' | 'memory';

export interface DeskItem {
  id: string;
  label: string;
  /** 右侧小字：时间点 / 状态词 / 类型 */
  meta?: string;
  /** 点击后填进输入框的问题 */
  prompt: string;
  tone?: 'pine' | 'vermilion';
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
  return !title || title === GLOBAL_ASK_COPY.sourceCurrentLesson;
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
    });
  }
  const materials = input.materialTitles.map((t) => t.trim()).filter(Boolean);
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
    const seen = new Set<string>();
    const recent: DeskItem[] = [];
    for (const activity of [...input.recentActivities].reverse()) {
      if (activity.kind !== 'lesson' && activity.kind !== 'app') continue;
      const title = activity.title.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      recent.push({
        id: `recent:${activity.id}`,
        label: shortTitle(title, LABEL_MAX),
        meta: activity.kind === 'app' && activity.appKey ? GLOBAL_ASK_COPY.masteryTrail.stepLabels[activity.appKey] : undefined,
        prompt: copy.promptFromRecent(shortTitle(title)),
      });
      if (recent.length >= RECENT_MAX) break;
    }
    if (recent.length > 0) groups.push({ id: 'recent', title: copy.recentTitle, items: recent });
  }

  // 长期理解：还没过去的困惑先出现，其后是在学的主题（偏好 / 长处 / 进度不是问题的起点，不上桌）
  const memoryRank: Partial<Record<LearningMemoryEntry['kind'], number>> = { challenge: 0, topic: 1 };
  const memory: DeskItem[] = [...input.memories]
    .filter((m) => m.status === 'active' && m.title.trim() && m.kind in memoryRank)
    .sort((a, b) => (memoryRank[a.kind] ?? 9) - (memoryRank[b.kind] ?? 9))
    .slice(0, MEMORY_MAX)
    .map((m) => ({
      id: `memory:${m.id}`,
      label: shortTitle(m.title, LABEL_MAX),
      meta: m.kind === 'challenge' ? copy.memoryChallenge : copy.memoryTopic,
      prompt: m.kind === 'challenge' ? copy.promptFromChallenge(shortTitle(m.title)) : copy.promptFromTopic(shortTitle(m.title)),
      tone: m.kind === 'challenge' ? 'vermilion' : undefined,
    }));
  if (memory.length > 0) groups.push({ id: 'memory', title: copy.memoryTitle, items: memory });

  return groups;
}
