/**
 * demo-app-outputs.ts — 首屏 hero 能力预览条使用的静态缩略图描述。
 *
 * 为什么不做"可交互的 preview 窗口"：
 *   如果每个能力都预渲染真实的 app window，就需要维护多套 fixture payload，
 *   跟随插件演化而漂移；任何插件小改动都可能打破 demo。
 *   我们选择更克制的做法：
 *     - 首屏 capability strip 里每张卡片是一个静态视觉缩略图（SVG/HTML）
 *     - 点击不打开真实 app window，而是把用户引导到"试听一节 demo 课"
 *     - 加载完 demo 后，用户可以在真正的课堂视图里点对应 chip 看真实产出
 *   这样"预览 → 真实体验"的路径更顺，也避免维护多份 fixture 的重复成本。
 *
 * 每个 preview 的组成：
 *   - appKey：对应的插件 key
 *   - title：短标签（2-6 字）
 *   - tagline：一句话描述这张卡片是什么
 *   - sampleLine：缩略图里展示的一行"样品内容"（让用户一眼知道这是什么）
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface DemoAppPreview {
  appKey: Extract<WorkshopAppKey, 'cheatsheet' | 'mindmap'>;
  title: string;
  tagline: string;
  sampleLine: string;
}

export const DEMO_APP_PREVIEWS: DemoAppPreview[] = [
  {
    appKey: 'cheatsheet',
    title: '一页速查表',
    tagline: '核心定义、公式、易错点压成一张可打印的卡',
    sampleLine: '核心定义 · 关键公式 · 易错点',
  },
  {
    appKey: 'mindmap',
    title: '思维导图',
    tagline: '这节课的结构和分支一眼看完',
    sampleLine: '根主题 · 分支 · 节点跳回放',
  },
];
