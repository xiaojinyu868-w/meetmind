import type { AppRenderMode } from './types';

export type WorkshopAppKey =
  | 'audio-overview'
  | 'flashcards'
  | 'quiz'
  | 'mindmap'
  | 'infographic';

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
  renderMode: AppRenderMode | 'custom(image-first)';
  status: 'ready' | 'preview';
}

export const WORKSHOP_APP_CATALOG: WorkshopAppCatalogItem[] = [
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
    renderMode: 'audio',
    status: 'ready',
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
    renderMode: 'flashcards',
    status: 'ready',
  },
  {
    key: 'quiz',
    name: '测验工坊',
    category: '理解检验',
    headline: '课堂理解测验生成',
    description: '自动生成可作答测验，提交后即时反馈并定位证据。',
    tags: ['课堂测验', '错题复盘', '作答'],
    coverImage: '/images/apps/quiz-cover.svg',
    pluginId: 'quiz-arena',
    intent: '生成课堂测验，检验理解并输出可回放证据。',
    outputType: '可作答测验',
    renderMode: 'quiz',
    status: 'ready',
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
    renderMode: 'mindmap',
    status: 'ready',
  },
  {
    key: 'infographic',
    name: '信息图工坊',
    category: '视觉表达',
    headline: '课堂信息图生成',
    description: '先生成信息图文案草案，再确认一键生图输出海报。',
    tags: ['文生图', '信息图', '视觉总结'],
    coverImage: '/images/apps/infographic-cover.svg',
    pluginId: 'studio-workshop',
    intent: '生成课堂信息图，先输出图文结构草案，再生成最终图片。',
    outputType: '真实图片',
    renderMode: 'custom(image-first)',
    status: 'preview',
  },
];

export function isWorkshopAppKey(value: string): value is WorkshopAppKey {
  return WORKSHOP_APP_CATALOG.some((item) => item.key === value);
}

export function getWorkshopAppByKey(key: string): WorkshopAppCatalogItem | undefined {
  return WORKSHOP_APP_CATALOG.find((item) => item.key === key);
}
