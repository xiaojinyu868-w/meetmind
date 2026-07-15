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
   * - 'class'：单节课层（本期所有应用必含）
   * - 'unit'：跨课单元层（v1.1 推迟）
   * - 'exam'：考试层（v1.1 推迟）
   *
   * 即使本期 tier='class' 是唯一落地的层，这里也按设计意图标注全集；
   * `WorkshopYellowPage` 当前只过滤含 'class' 的应用。
   */
  supportedTiers: ContextTier[];
  /**
   * 主舞台层。用于 UI 排序 / 推荐 hint，不影响过滤。
   *
   * 即使主舞台是 'unit'（如 mindmap），本期未落地时仍按 supportedTiers 包含的
   * 'class' 层在课堂矩阵里展示其退化形态。
   */
  primaryTier: ContextTier;
}

export const WORKSHOP_APP_CATALOG: WorkshopAppCatalogItem[] = [
  {
    key: 'cheatsheet',
    name: '考试速查表',
    category: '应试准备',
    headline: '一页纸考试速查表',
    description: '把课堂核心定义、公式、易错点整成可打印的一页卡片，考前最后一刻复习。',
    tags: ['考试', '速查', '一页纸', '打印'],
    coverImage: '/images/apps/study-report-cover.svg',
    pluginId: 'cheatsheet-gen',
    intent: '生成考试速查表：核心定义、公式/步骤、易错点各一组，适合一页打印。',
    outputType: '可打印卡片',
    learningAction: COPY.apps.matrix.catalogMeta.cheatsheet.action,
    bestFor: COPY.apps.matrix.catalogMeta.cheatsheet.bestFor,
    timeLabel: COPY.apps.matrix.catalogMeta.cheatsheet.time,
    renderMode: 'document',
    status: 'ready',
    supportedTiers: ['class', 'unit', 'exam'],
    primaryTier: 'class',
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
    name: '信息图应用',
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
];

export function isWorkshopAppKey(value: string): value is WorkshopAppKey {
  return WORKSHOP_APP_CATALOG.some((item) => item.key === value);
}

export function getWorkshopAppByKey(key: string): WorkshopAppCatalogItem | undefined {
  return WORKSHOP_APP_CATALOG.find((item) => item.key === key);
}
