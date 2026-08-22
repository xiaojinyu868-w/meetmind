import type { AppRenderMode, ContextTier, WorkshopAppKey } from './types';
import { COPY } from '@/lib/ui/copy';

export type { WorkshopAppKey } from './types';

export interface WorkshopAppCatalogItem {
  key: WorkshopAppKey;
  name: string;
  category: string;
  headline: string;
  description: string;
  tags: string[];
  coverImage: string;
  pluginId: string;
  intent: string;
  outputType: string;
  /** 用户此刻要完成的学习动作，而不是技术能力名称 */
  learningAction: string;
  /** 什么时候选择它 */
  bestFor: string;
  /** 让用户预判投入成本；不是生成 SLA */
  timeLabel: string;
  renderMode: AppRenderMode | 'custom(image-first)';
  status: 'ready' | 'preview';
  /**
   * 本应用支持的上下文层（PRD v1.1 §4.2）。
   *
   * - 'class'：单节课层，只放课后立即使用仍然成立的学习动作
   * - 'unit'：跨课单元层，允许比较、去重与压缩多节课
   * - 'exam'：考试层，叠加大纲、真题与时间约束
   */
  supportedTiers: ContextTier[];
  /**
   * 主舞台层。用于 UI 排序 / 推荐 hint，不影响过滤。
   *
   * 主舞台只表达产品价值最高的层，不得为了“能力丰富”把不成立的退化形态
   * 强塞到单课矩阵。
   */
  primaryTier: ContextTier;
}

export const WORKSHOP_APP_CATALOG: WorkshopAppCatalogItem[] = [
  {
    key: 'cheatsheet',
    name: '考试速查表',
    category: '应试准备',
    headline: '一页纸考试速查表',
    description: '把多节课、课件、笔记与考试范围压成可编辑、可打印的高密度参考表。',
    tags: ['考试', '速查', '一页纸', '打印'],
    coverImage: '/images/apps/study-report-cover.svg',
    pluginId: 'cheatsheet-gen',
    intent: '基于跨课与考试范围生成速查表：去重核心定义、公式、条件、对比、易错点和题型套路。',
    outputType: '可打印卡片',
    learningAction: COPY.apps.matrix.catalogMeta.cheatsheet.action,
    bestFor: COPY.apps.matrix.catalogMeta.cheatsheet.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.cheatsheet.time,
    renderMode: 'document',
    status: 'ready',
    supportedTiers: ['unit', 'exam'],
    primaryTier: 'exam',
  },
  {
    key: 'audio-overview',
    name: '课堂播客',
    category: '音频生成',
    headline: '双人课堂播客生成器',
    description: '把课堂内容转成可收听播客，支持章节定位与回放复盘。',
    tags: ['火山播客', '课堂复盘', '音频'],
    coverImage: '/images/apps/audio-overview-cover.svg',
    pluginId: 'studio-workshop',
    intent: '生成课堂播客，输出可播放音频和可回放章节。',
    outputType: '真实播客音频',
    learningAction: COPY.apps.matrix.catalogMeta['audio-overview'].action,
    bestFor: COPY.apps.matrix.catalogMeta['audio-overview'].bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta['audio-overview'].time,
    renderMode: 'audio',
    status: 'ready',
    supportedTiers: ['class'],
    primaryTier: 'class',
  },
  {
    key: 'flashcards',
    name: '闪卡训练',
    category: '记忆训练',
    headline: '主动回忆闪卡训练器',
    description: '围绕课堂重点生成训练闪卡，支持翻面与掌握度打分。',
    tags: ['主动回忆', '间隔复习', '训练'],
    coverImage: '/images/apps/flashcards-cover.svg',
    pluginId: 'flashcards-lab',
    intent: '生成课堂闪卡训练，帮助学生主动回忆并巩固核心知识。',
    outputType: '训练型闪卡',
    learningAction: COPY.apps.matrix.catalogMeta.flashcards.action,
    bestFor: COPY.apps.matrix.catalogMeta.flashcards.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.flashcards.time,
    renderMode: 'flashcards',
    status: 'ready',
    supportedTiers: ['class', 'unit', 'exam'],
    primaryTier: 'class',
  },
  {
    key: 'quiz',
    name: '课堂测验',
    category: '理解检验',
    headline: '课堂理解测验生成',
    description: '自动生成可作答测验，提交后即时反馈并定位证据。',
    tags: ['课堂测验', '错题复盘', '作答'],
    coverImage: '/images/apps/quiz-cover.svg',
    pluginId: 'quiz-arena',
    intent: '生成课堂测验，检验理解并输出可回放证据。',
    outputType: '可作答测验',
    learningAction: COPY.apps.matrix.catalogMeta.quiz.action,
    bestFor: COPY.apps.matrix.catalogMeta.quiz.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.quiz.time,
    renderMode: 'quiz',
    status: 'ready',
    supportedTiers: ['class', 'unit', 'exam'],
    primaryTier: 'class',
  },
  {
    key: 'mindmap',
    name: '思维导图',
    category: '结构学习',
    headline: '课堂知识导图生成',
    description: '把课堂内容结构化为可交互导图，便于复述与迁移。',
    tags: ['结构化', '导图', '知识框架'],
    coverImage: '/images/apps/mindmap-cover.svg',
    pluginId: 'mindmap-outline',
    intent: '生成课堂思维导图，呈现主干、分支与关键证据。',
    outputType: '交互导图',
    learningAction: COPY.apps.matrix.catalogMeta.mindmap.action,
    bestFor: COPY.apps.matrix.catalogMeta.mindmap.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.mindmap.time,
    renderMode: 'mindmap',
    status: 'ready',
    supportedTiers: ['class', 'unit'],
    primaryTier: 'unit',
  },
  {
    key: 'infographic',
    name: '课堂信息图',
    category: '视觉表达',
    headline: '一张图带走这节课',
    description: '一键生成"一张图带走这节课"卡片：上=课程名+老师+日期，中=3 核心概念+老师金句，下=一句话总结。结构干净，可直接分享。',
    tags: ['一张图', '课堂卡', '可分享', '视觉总结'],
    coverImage: '/images/apps/infographic-cover.svg',
    pluginId: 'studio-workshop',
    intent: '生成"一张图带走这节课"固定版式卡片：上中下三段，结构干净零个人化痕迹。',
    outputType: '图片',
    learningAction: COPY.apps.matrix.catalogMeta.infographic.action,
    bestFor: COPY.apps.matrix.catalogMeta.infographic.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.infographic.time,
    renderMode: 'custom(image-first)',
    status: 'ready',
    supportedTiers: ['class', 'unit'],
    primaryTier: 'class',
  },
  {
    key: 'teach-back',
    name: '讲给同桌听',
    category: '理解检验',
    headline: '讲一遍，才知道真懂没有',
    description: '挑几个这节课应该能讲出来的点，讲给同桌听；同桌对照课堂原声核对你讲的，标出讲透的和盲区。',
    tags: ['费曼检验', '讲授', '盲区', '理解检验'],
    coverImage: '/images/apps/quiz-cover.svg',
    pluginId: 'teach-back-lab',
    intent: '从这节课真实内容中选出 3-5 个学生应该能亲口讲出来的目标点，并把每个目标锚定到课堂证据。',
    outputType: '讲述评估卡',
    learningAction: COPY.apps.matrix.catalogMeta['teach-back'].action,
    bestFor: COPY.apps.matrix.catalogMeta['teach-back'].bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta['teach-back'].time,
    renderMode: 'custom',
    status: 'ready',
    supportedTiers: ['class'],
    primaryTier: 'class',
  },
  {
    key: 'explainer',
    name: COPY.apps.matrix.catalogMeta.explainer.name,
    category: '理解精讲',
    headline: COPY.apps.matrix.catalogMeta.explainer.headline,
    description: COPY.apps.matrix.catalogMeta.explainer.description,
    tags: ['板书', '边写边讲', '老师原话', '圈点勾画'],
    coverImage: '/images/apps/study-report-cover.svg',
    pluginId: 'explainer',
    intent: '把这节课的转录变成一段黑板板书精讲：边写边讲、圈点勾画、老师原话逐字引用。',
    outputType: '板书精讲',
    learningAction: COPY.apps.matrix.catalogMeta.explainer.action,
    bestFor: COPY.apps.matrix.catalogMeta.explainer.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.explainer.time,
    renderMode: 'board',
    status: 'ready',
    supportedTiers: ['class'],
    primaryTier: 'class',
  },
];

export function isWorkshopAppKey(value: string): value is WorkshopAppKey {
  return WORKSHOP_APP_CATALOG.some((item) => item.key === value);
}

export function getWorkshopAppByKey(key: string): WorkshopAppCatalogItem | undefined {
  return WORKSHOP_APP_CATALOG.find((item) => item.key === key);
}

export function getWorkshopAppKeysForTier(tier: ContextTier): WorkshopAppKey[] {
  return WORKSHOP_APP_CATALOG
    .filter((item) => item.supportedTiers.includes(tier))
    .map((item) => item.key);
}
