/**
 * composeFirstHello — 同桌的第一句话（动态）
 *
 * 设计意图：
 *   用户进课堂的第一眼，同桌说的第一句话必须基于他今天的真实情况。
 *   这就是"收→酿→应"里的"应"：不是 AI 主动推送，而是用户转身时，
 *   AI 已经准备好那句"对的话"。
 *
 * Taste 约束：
 *   - 不播报（不说"你今天有 3 节课，其中 1 节已理解"）
 *   - 不穷举（从多节课里只挑最显眼的那一个提）
 *   - 不刻意（像随口一句，不是开场白演讲）
 *   - 不追问（说完就停）
 *   - 最多 30 字（一行的物理长度）
 *
 * 分支优先级（选第一个匹配）：
 *   1. recording：正在录，就不说话（打扰）
 *   2. 完全没数据：新用户 magic moment
 *   3. 有 processing：强调"刚那节还在听"
 *   4. 今天有 upcoming：预报今天
 *   5. 今天有 ready：今天刚录完
 *   6. 昨天/最近有 ready：召唤复习
 *   7. 都是很久前：轻推新录
 *
 * 这个函数是纯的，便于测试，也便于未来接入 AI 生成（先静态枚举起步）。
 */

import type { Lesson } from './types';

export interface ComposeHelloInput {
  lessons: Lesson[];
  /** 当前"今天"的 YYYY-MM-DD。传入方便测试。 */
  today?: string;
  /** 是否正在录课——录课时就不说废话。 */
  isRecording?: boolean;
}

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterdayString(today: string): string {
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/** 截短课名到指定字符数，超出加 … */
function shortTitle(title: string, max = 14): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max)}…`;
}

/**
 * 返回同桌第一句话，或 null 表示"这种场景下不说话"。
 */
export function composeFirstHello(input: ComposeHelloInput): string | null {
  const { lessons, isRecording = false } = input;
  const today = input.today ?? todayString();
  const yesterday = yesterdayString(today);

  // 1. 录课中：不说废话（listening 态另有 markListening 接管）
  if (isRecording) return null;

  // 2. 完全没数据：新用户 magic moment
  if (lessons.length === 0) {
    return '我在这里。等你录第一节课，我就开始陪你。';
  }

  // 3. 有正在酿的课（刚录完）——优先级最高，因为"刚发生"
  const processingLesson = lessons.find((l) => l.status === 'processing');
  if (processingLesson) {
    return `刚那节《${shortTitle(processingLesson.title)}》我还在听，等下我们一起过。`;
  }

  // 4. 今天有 upcoming
  const todayUpcoming = lessons
    .filter((l) => l.status === 'upcoming' && l.date === today)
    .sort((a, b) => a.time.localeCompare(b.time))[0];
  if (todayUpcoming) {
    return `今天 ${todayUpcoming.time} 有节《${shortTitle(todayUpcoming.title)}》，到点了叫你。`;
  }

  // 5. 今天有 ready（今天录完、已理解）
  const todayReady = lessons
    .filter((l) => l.status === 'ready' && l.date === today)
    .sort((a, b) => b.time.localeCompare(a.time))[0];
  if (todayReady) {
    return `今天那节《${shortTitle(todayReady.title)}》录下来了。想聊聊再叫我。`;
  }

  // 6. 昨天/最近有 ready——召唤复习
  // 取最近的 ready
  const recentReady = lessons
    .filter((l) => l.status === 'ready')
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))[0];

  if (recentReady) {
    // 判断"最近"：3 天内
    const daysBetween = daysBetweenDates(recentReady.date, today);
    if (recentReady.date === yesterday) {
      return `昨天那节《${shortTitle(recentReady.title)}》，要不我们再过一遍？`;
    }
    if (daysBetween <= 3) {
      return `前阵子那节《${shortTitle(recentReady.title)}》，还记得吗？`;
    }
    // 超过 3 天——很久没见
    return '好久没见了。今天要不要录一节新的？';
  }

  // fallback：只有 upcoming 但不是今天的
  const anyUpcoming = lessons.find((l) => l.status === 'upcoming');
  if (anyUpcoming) {
    return `你排了《${shortTitle(anyUpcoming.title)}》，到时候见。`;
  }

  // 真的什么都判断不出来
  return null;
}

function daysBetweenDates(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.abs(Math.round((b - a) / (1000 * 60 * 60 * 24)));
}
