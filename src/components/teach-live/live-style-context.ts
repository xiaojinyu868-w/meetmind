'use client';

/**
 * live-style-context —— 舞台级视觉开关：手绘感（rough.js 笔迹）。
 * LiveStage 提供，ProgressiveSvg 消费；<plot> 强制工整不受影响。默认开，localStorage 记住选择。
 */

import * as React from 'react';

export interface LiveStyle {
  rough: boolean;
}

export const LiveStyleContext = React.createContext<LiveStyle>({ rough: true });

const STORAGE_KEY = 'meetmind.teach-live.rough';

export function readRoughPreference(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === null ? true : v === '1';
}

export function writeRoughPreference(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
}
