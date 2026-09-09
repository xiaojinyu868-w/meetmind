/**
 * global-ask-starters — 问同学空态的建议入口（纯函数）。
 *
 * 原来两条建议是写死的通用句（"帮我解释刚才课堂里最难的概念"），谁看都一样。
 * 同桌应该从这个人正在学的地方接话：有当前材料就点名材料，最近上过课就点名那节课，
 * 长期理解里有还没过去的困惑就先提它。不推断学习风格，全是学生自己留下的事实。
 */

import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';

export interface GlobalAskStarterInput {
  depth: 'quick' | 'deep';
  /** 当前会带进对话的材料标题（当前课堂转录、打开的资料…） */
  currentMaterialTitles: readonly string[];
  recentActivities: readonly LearningActivityEntry[];
  memories: readonly LearningMemoryEntry[];
}

const MAX_STARTERS = 2;
const TITLE_MAX = 18;

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

function isGenericTitle(title: string): boolean {
  return title === GLOBAL_ASK_COPY.sourceCurrentLesson;
}

export function buildGlobalAskStarters(input: GlobalAskStarterInput): string[] {
  const copy = GLOBAL_ASK_COPY.starters;
  const out: string[] = [];
  const push = (text: string) => {
    if (out.length < MAX_STARTERS && !out.includes(text)) out.push(text);
  };

  const material = input.currentMaterialTitles.find((title) => title.trim());
  const recentLesson = [...input.recentActivities].reverse().find((item) => item.kind === 'lesson' && item.title.trim());
  const openChallenge = input.memories.find((memory) => memory.status === 'active' && memory.kind === 'challenge' && memory.title.trim());

  if (input.depth === 'deep') {
    if (recentLesson) push(copy.deepFromLesson(shortTitle(recentLesson.title)));
    else if (material && !isGenericTitle(material)) push(copy.deepFromMaterial(shortTitle(material)));
    for (const fallback of GLOBAL_ASK_COPY.deepExamples) push(fallback);
    return out;
  }

  if (material) {
    push(isGenericTitle(material) ? copy.quickFromCurrentLesson : copy.quickFromMaterial(shortTitle(material)));
  }
  if (openChallenge) push(copy.quickFromChallenge(shortTitle(openChallenge.title)));
  if (recentLesson && !(material && isGenericTitle(material))) push(copy.quickFromLesson(shortTitle(recentLesson.title)));
  for (const fallback of GLOBAL_ASK_COPY.quickExamples) push(fallback);
  return out;
}

/** 底栏「会参考…」：只有一份当前材料时直接点名，比"1 份当前内容"更像人话。 */
export function describeGlobalAskContext(input: {
  currentMaterialTitles: readonly string[];
  recentCount: number;
  memoryCount: number;
}): string {
  if (input.currentMaterialTitles.length === 1) {
    return GLOBAL_ASK_COPY.contextSummaryNamed(shortTitle(input.currentMaterialTitles[0]), input.recentCount, input.memoryCount);
  }
  return GLOBAL_ASK_COPY.contextSummary(input.currentMaterialTitles.length, input.recentCount, input.memoryCount);
}
