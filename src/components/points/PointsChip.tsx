/**
 * PointsChip — App 头部安静的积分 chip
 *
 * 显示当前余额；点击展开小面板：本月免费录课剩余分钟 + 近几笔流水 +
 * 「开通会员/升级/续费」「充积分」直达按钮（唤起 PaywallDialog，
 * 付费入口不藏在设置页里）。
 * 未登录 guest / 加载失败时静默隐藏（guest 没有积分概念）。
 *
 * 视觉约束（积分系统 Phase 2）：不要金币风、不要扎眼的徽章——
 * 一颗墨绿小点 + 等宽数字，和用户菜单安静地坐在一起。
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/lib/ui/copy';
import { usePointsSummary, type PointsTransaction } from '@/hooks/usePointsSummary';
import { openPaywallGlobal } from '@/hooks/usePaywall';
import { pointsReasonLabel, formatPointsRecordTime } from './points-format';

const PANEL_RECENT_LIMIT = 5;

function TransactionRow({ record }: { record: PointsTransaction }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] text-ink-secondary">{pointsReasonLabel(record.reason)}</p>
        <p className="text-[10.5px] text-ink-muted">{formatPointsRecordTime(record.createdAt)}</p>
      </div>
      <span
        className={`flex-shrink-0 text-[12.5px] tabular-nums ${
          record.delta > 0 ? 'text-pine' : 'text-ink-muted'
        }`}
      >
        {COPY.points.deltaLabel(record.delta)}
      </span>
    </div>
  );
}

export function PointsChip() {
  const { summary, refresh } = usePointsSummary();
  const [open, setOpen] = useState(false);

  // 未登录 / 接口未就绪：静默隐藏
  if (!summary) return null;

  const tier = summary.membership.tier;
  const membershipCta =
    tier === 'free'
      ? COPY.membership.freeTierCta
      : tier === 'pro'
        ? COPY.membership.upgradeCta
        : COPY.membership.renewCta;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // 展开时静默拉一次最新余额（打开面板的成本很低，换来数字永远是新的）
    if (next) void refresh();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        data-testid="points-chip"
        className="flex items-center gap-1.5 rounded-full border border-divider-light bg-card px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-pine/40 hover:text-pine"
      >
        <span className="size-1 rounded-full bg-pine-light" />
        {summary.membership.tier !== 'free' ? (
          <span className="rounded-full bg-pine/10 px-1.5 py-px text-[10px] font-medium text-pine">
            {COPY.membership.tierName[summary.membership.tier]}
          </span>
        ) : null}
        <span className="tabular-nums">{COPY.points.chipLabel(summary.balance)}</span>
      </button>

      {open && (
        <div
          data-testid="points-panel"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-divider-light bg-white p-4 animate-scale-in"
        >
          <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
            {COPY.points.balanceCaption}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-navy">
            {summary.balance}
            <span className="ml-1 text-xs font-normal text-ink-muted">{COPY.points.unit}</span>
          </p>

          <p className="mt-3 text-[12px] text-ink-secondary">
            {summary.asrFreeMinutesRemaining > 0
              ? COPY.points.freeMinutesRemaining(summary.asrFreeMinutesRemaining)
              : COPY.points.freeMinutesUsedUp}
          </p>

          {/* 付费直达：一级页面唤起 Paywall，不用进设置找 */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openPaywallGlobal({ reason: 'upgrade', tab: 'membership' });
              }}
              className="flex-1 rounded-lg bg-pine px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-pine-deep"
            >
              {membershipCta}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openPaywallGlobal({ reason: 'topup', tab: 'points' });
              }}
              className="flex-1 rounded-lg border border-divider px-3 py-1.5 text-[12px] text-pine transition-colors hover:border-pine/40 hover:bg-pine/5"
            >
              {COPY.membership.paywallTabPoints}
            </button>
          </div>

          <div className="mt-3 border-t border-divider-light pt-2">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
              {COPY.points.recentRecords}
            </p>
            {summary.recentTransactions.length > 0 ? (
              <div className="mt-1 divide-y divide-divider-light/60">
                {summary.recentTransactions.slice(0, PANEL_RECENT_LIMIT).map((record, index) => (
                  <TransactionRow key={`${record.createdAt}-${index}`} record={record} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-ink-muted">{COPY.points.recordsEmpty}</p>
            )}
          </div>

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="mt-3 block border-t border-divider-light pt-2.5 text-[12px] text-pine transition-colors hover:text-pine-light"
          >
            {COPY.points.settingsCaption} →
          </Link>
        </div>
      )}
    </div>
  );
}

export default PointsChip;
