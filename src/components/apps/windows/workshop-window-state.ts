/**
 * workshop-window-state — 应用窗口的状态类型与默认展示模式（纯模块，零 React / 零重库）。
 *
 * 抽出来的原因：useWorkshopWindows（首屏就会执行的 hook）此前从 WorkshopWindowManager.tsx 取这两样东西，
 * 结果把整棵应用窗口树（板书 KaTeX、速查表 react-markdown、讲给同桌听…）静态带进 /app 首屏 JS。
 * page.tsx 对 WorkshopWindowManager 本身是 dynamic 的，但 hook 的一行静态 import 让 dynamic 形同虚设。
 * 类型和常量放这里，组件文件从这里 re-export，消费方不必改。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export type WorkshopDisplayMode = 'panel' | 'fullscreen';

export interface FloatingWorkshopWindowState {
  appKey: WorkshopAppKey;
  minimized: boolean;
  zIndex: number;
  displayMode: WorkshopDisplayMode;
}

/** 应用的默认展示模式 */
const DEFAULT_DISPLAY_MODES: Partial<Record<WorkshopAppKey, WorkshopDisplayMode>> = {
  mindmap: 'fullscreen',
  infographic: 'fullscreen',
  'audio-overview': 'panel',
  flashcards: 'fullscreen',
  quiz: 'fullscreen',
  cheatsheet: 'fullscreen',
  'teach-back': 'fullscreen',
};

export function getDefaultDisplayMode(appKey: WorkshopAppKey): WorkshopDisplayMode {
  return DEFAULT_DISPLAY_MODES[appKey] || 'panel';
}
