/**
 * Classroom 模块的 demo 数据
 *
 * 上线前作为占位；接真实数据源（Zustand store / API）后移除。
 * 这里设计成「一节课的三种时态」都能看到，方便 UI 调校。
 */

import type { Lesson, CompanionMessage } from './types';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export const DEMO_LESSONS: Lesson[] = [
  // 课前：今天下午的课
  {
    id: 'lesson-upcoming-1',
    title: '微观经济学 · 消费者剩余',
    date: today(),
    time: '14:00',
    hasEcho: false,
    reviewed: false,
    linkedMaterials: 2,
    status: 'upcoming',
  },
  // 课后-酿造中
  {
    id: 'lesson-processing-1',
    title: '概率论 · 条件概率与贝叶斯',
    date: today(),
    time: '10:00',
    durationMin: 48,
    hasEcho: false,
    reviewed: false,
    status: 'processing',
  },
  // 课后-已理解（昨天）
  {
    id: 'lesson-ready-1',
    title: '高等数学 · 傅里叶变换',
    date: yesterday(),
    time: '10:00',
    durationMin: 52,
    keyPoints: 3,
    hasEcho: true,
    reviewed: false,
    linkedMaterials: 1,
    status: 'ready',
  },
  {
    id: 'lesson-ready-2',
    title: '线性代数 · 特征值与特征向量',
    date: daysAgo(2),
    time: '10:00',
    durationMin: 50,
    keyPoints: 4,
    hasEcho: true,
    reviewed: true,
    status: 'ready',
  },
];

export const DEMO_COMPANION_MESSAGES: CompanionMessage[] = [
  {
    id: 'm-1',
    role: 'companion',
    content: '下午 2 点有节《消费者剩余》，你上周发进来的那份讲义我看过了。',
    createdAt: Date.now() - 1000 * 60 * 20,
  },
  {
    id: 'm-2',
    role: 'companion',
    content: '上课前如果有空，可以想想一个问题：为什么人愿意花 30 块买一杯奶茶？',
    source: '来自你发的《微观经济学讲义 · 第 3 章》',
    createdAt: Date.now() - 1000 * 60 * 19,
  },
];
