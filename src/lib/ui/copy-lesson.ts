/**
 * 同学讲的课（teach-live 物化进复习页）的用户面文案。与 copy.ts 同一口吻规则：人话、不摆功能、不进内部黑话。
 * 这是复习页的一块，与来源（知乎 / B 站 / PDF）无关；来源特有的字句在各来源自己的 copy-* 里。
 */
export const LESSON_COPY = {
  /** 复习页左栏顶部的材料卡 */
  cardEyebrow: '同学讲的课',
  cardFrom: (collection: string): string => `来自你收藏的「${collection}」`,
  taughtSingle: '这节课讲的是这一篇',
  taughtTheme: (count: number): string => `这节课把这 ${count} 篇连起来讲`,
  taughtFavlist: (count: number): string => `这节课从这 ${count} 篇里讲`,
  pickedBecause: (why: string): string => `同学先讲它，因为：${why}`,
  coverageFull: '老师读了全文',
  coverageOutline: '老师读了骨架',
  coverageSummary: '老师只有摘要',
  notMentioned: '这节课还没讲到',
  openOriginal: '看原文',
  priorLessons: (count: number): string => `这几篇之前讲过 ${count} 节`,
  pagesTaught: (count: number): string => `讲了 ${count} 页`,
  continueTeaching: '接着讲',
  continueTeachingHint: '回到舞台，老师从上次停下的地方往下讲。',
  unsettled: '这一轮还没讲完，老师还在讲。',
  recordFailed: '这节课的材料没读回来，稍后再试。',
} as const;
