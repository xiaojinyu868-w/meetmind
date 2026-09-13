/**
 * 「从材料开一节课」这项能力的输入：与来源无关的候选材料。
 *
 * 知乎收藏、B 站收藏、口袋收下的网页、PDF——都先映射成 MaterialCandidate 再进选材 / 分线 / 预算，
 * 能力层不认识任何来源（`docs/plans/2026-09-13-material-lessons.md`）。
 */

/** 材料的体裁：决定"能不能讲"与列表上的标签 */
export type MaterialKind = 'answer' | 'article' | 'question' | 'video' | 'post' | 'other';

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  answer: '回答',
  article: '文章',
  question: '问题',
  video: '视频',
  post: '想法',
  other: '内容',
};

/** 有正文可讲的体裁；视频 / 想法只留在收集流里 */
export function isTeachableKind(kind: MaterialKind): boolean {
  return kind === 'answer' || kind === 'article' || kind === 'question';
}

export interface MaterialCandidate {
  /** 来源方的 id（capture id 等），进材料包的 sourceId */
  id: string;
  title: string;
  author: string | null;
  url: string;
  kind: MaterialKind;
  /** 正文（有全文时是全文，否则是摘要）；空串 = 连摘要都没有 */
  text: string;
  /** 一行摘要（列表 / 分线用） */
  summary: string;
  /** text 是不是全文 */
  hasFullText: boolean;
  /** 社区信号：赞同 / 点赞数，选材排序用 */
  votes: number;
  comments: number;
  /** 收进来的时间（秒级时间戳），同赞同时新的在前 */
  collectedAt: number;
  /** 一行元信息（体裁 · 赞同 · 评论 · 收藏时间），来源方按自己的字段拼好 */
  meta: string;
}
