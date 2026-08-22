/**
 * usePaywall — 全局付费拦截页状态
 *
 * 触发时机（高意向时刻，产品决策）：Tutor/应用 402 insufficient_points、
 * 录课 ASR 免费分钟用尽且余额不够按分钟续。guest 日限额不弹（先引导登录）。
 * 非 React 上下文（hook 回调、store action）用 openPaywallGlobal。
 */

'use client';

import { create } from 'zustand';
import { parsePointsBlock, type PointsBlockInfo } from './points-guard';

export type PaywallReason =
  | 'insufficient_points'
  | 'asr_quota'
  | 'membership_required'
  | 'topup'
  | 'upgrade';

export type PaywallTab = 'points' | 'membership';

export interface PaywallPayload {
  reason: PaywallReason;
  balance?: number;
  required?: number;
  /** membership_required 时后端给的最低档位（pro/max） */
  requiredTier?: string;
  /** 打开时落在哪个 Tab；缺省按 reason 推断 */
  tab?: PaywallTab;
}

interface PaywallState extends PaywallPayload {
  open: boolean;
  openPaywall: (payload: PaywallPayload) => void;
  closePaywall: () => void;
}

export const usePaywall = create<PaywallState>((set) => ({
  open: false,
  reason: 'insufficient_points',
  openPaywall: (payload) => set({ open: true, ...payload }),
  closePaywall: () => set({ open: false }),
}));

/** 非 React 调用方（hook 回调 / store）直接开门 */
export function openPaywallGlobal(payload: PaywallPayload): void {
  usePaywall.getState().openPaywall(payload);
}

/**
 * useChat（DefaultChatTransport）的非 2xx 错误：Error.message 就是响应 body 原文。
 * 纯解析：识别 402 积分/会员拦截（body 是 {error, balance, required, requiredTier} JSON），
 * 不是则返回 null，调用方走原有错误展示。
 */
export function parseChatErrorPointsBlock(error: Error | undefined | null): PointsBlockInfo | null {
  if (!error?.message) return null;
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return null;
  }
  return parsePointsBlock(402, body);
}

/**
 * useChat onError 接线：402 积分不足 / 会员专属 → 直接唤起对应 Paywall Tab
 * （对齐"点到付费处自己弹付费窗"的顶级产品交互，而不是把原始 JSON 塞进错误气泡）。
 * monthly_cost_cap / guest_daily_cap 按产品决策不弹（下月自动恢复 / 先引导登录）。
 */
export function openPaywallForChatError(error: Error | undefined | null): PointsBlockInfo | null {
  const info = parseChatErrorPointsBlock(error);
  if (!info) return null;
  if (info.kind === 'insufficient_points') {
    openPaywallGlobal({ reason: 'insufficient_points', balance: info.balance, required: info.required });
  } else if (info.kind === 'membership_required') {
    openPaywallGlobal({ reason: 'membership_required', requiredTier: info.requiredTier });
  }
  return info;
}
