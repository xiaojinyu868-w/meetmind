/**
 * PointsSettingsSection — 设置页「积分」区块
 *
 * 内容：当前余额、免费录课分钟进度条、最近流水
 * （earn 正 / spend 负，reason 映射为人类可读文案）。
 * 流水默认只展示最近 3 条，其余收进「查看全部 N 条记录」展开器——
 * 每次用 AI 都会新增一条流水，全量摊开会把整个设置页越拉越长。
 *
 * 注意：不给用户看真实 AI 成本——积分是对用户的抽象单位，成本只出现在
 * 管理后台（CostPanel），摊开底价会锚死将来的商业化定价。
 *
 * 视觉沿用设置页既有模式：caption mono uppercase + description + SettingGroup
 * 卡片。未登录 / 接口未就绪时整块静默隐藏（guest 没有积分概念）。
 */

'use client';

import { useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import { usePointsSummary, type PointsTransaction } from '@/hooks/usePointsSummary';
import { openPaywallGlobal } from '@/hooks/usePaywall';
import { pointsReasonLabel, formatPointsRecordTime } from './points-format';

const SETTINGS_RECENT_LIMIT = 20;
/** 默认展示的流水条数，超出的收进展开器 */
const SETTINGS_RECENT_DEFAULT_SHOWN = 3;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-5">
      <span className="w-24 flex-shrink-0 text-[15px] text-ink">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-divider" />;
}

function TransactionRow({ record }: { record: PointsTransaction }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] text-ink">{pointsReasonLabel(record.reason)}</p>
        <p className="text-[11px] text-ink-muted">{formatPointsRecordTime(record.createdAt)}</p>
      </div>
      <span
        className={`flex-shrink-0 text-[13.5px] tabular-nums ${
          record.delta > 0 ? 'text-pine' : 'text-ink-muted'
        }`}
      >
        {COPY.points.deltaLabel(record.delta)}
      </span>
    </div>
  );
}

export function PointsSettingsSection() {
  const { summary } = usePointsSummary();
  const [showAllRecords, setShowAllRecords] = useState(false);

  // 未登录 / 接口未就绪：静默隐藏
  if (!summary) return null;

  const freeMinutes = Math.max(0, summary.asrFreeMinutesRemaining);
  const freeTotal = Math.max(1, summary.asrFreeMinutesPerMonth);
  const freeRatio = Math.min(1, freeMinutes / freeTotal);
  const allRecords = summary.recentTransactions.slice(0, SETTINGS_RECENT_LIMIT);
  const visibleRecords = showAllRecords
    ? allRecords
    : allRecords.slice(0, SETTINGS_RECENT_DEFAULT_SHOWN);
  const tier = summary.membership.tier;
  const tierLabel = COPY.membership.tierName[tier] ?? tier;
  const membershipCta =
    tier === 'free'
      ? COPY.membership.freeTierCta
      : tier === 'pro'
        ? COPY.membership.upgradeCta
        : COPY.membership.renewCta;

  return (
    <section data-testid="points-settings-section">
      <div className="px-2 pb-3">
        <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {COPY.points.settingsCaption}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted/85">
          {COPY.points.settingsDescription}
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-divider bg-card shadow-soft">
        <Row label={COPY.membership.settingsCaption}>
          <span className="inline-flex items-center gap-2.5">
            <span className="text-[15px] font-semibold text-ink">{tierLabel}</span>
            {summary.membership.expiresAt ? (
              <span className="text-[11.5px] text-ink-muted">
                {COPY.membership.expiresOn(summary.membership.expiresAt.slice(0, 10))}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => openPaywallGlobal({ reason: 'upgrade', tab: 'membership' })}
              className="rounded-full border border-divider px-3 py-1 text-[12px] text-pine transition-colors hover:border-pine/40 hover:bg-pine/5"
            >
              {membershipCta}
            </button>
          </span>
        </Row>

        <Divider />

        <Row label={COPY.points.balanceCaption}>
          <span className="inline-flex items-center gap-2.5">
            <span className="text-[15px] font-semibold tabular-nums text-ink">
              {summary.balance}
              <span className="ml-1 text-[12px] font-normal text-ink-muted">{COPY.points.unit}</span>
            </span>
            <button
              type="button"
              onClick={() => openPaywallGlobal({ reason: 'topup', tab: 'points' })}
              className="rounded-full border border-divider px-3 py-1 text-[12px] text-pine transition-colors hover:border-pine/40 hover:bg-pine/5"
            >
              {COPY.membership.paywallTabPoints}
            </button>
          </span>
        </Row>

        <Divider />

        <div className="px-5 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[15px] text-ink">{COPY.points.freeMinutesLabel}</span>
            <span className="text-[13px] tabular-nums text-ink-secondary">
              {freeMinutes > 0
                ? COPY.points.minutesValue(freeMinutes)
                : COPY.points.freeMinutesUsedUp}
            </span>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-divider/60">
            <div
              className="h-full rounded-full bg-pine transition-all"
              style={{ width: `${Math.round(freeRatio * 100)}%` }}
            />
          </div>
        </div>

        <Divider />

        <div className="py-2">
          <p className="px-5 pb-1 pt-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            {COPY.points.recentRecords}
          </p>
          {allRecords.length > 0 ? (
            <>
              <div className="divide-y divide-divider/60">
                {visibleRecords.map((record, index) => (
                  <TransactionRow key={`${record.createdAt}-${index}`} record={record} />
                ))}
              </div>
              {allRecords.length > SETTINGS_RECENT_DEFAULT_SHOWN ? (
                <button
                  type="button"
                  onClick={() => setShowAllRecords((prev) => !prev)}
                  className="flex w-full items-center gap-2 px-5 py-2.5 text-[13px] text-ink-secondary transition-colors hover:text-pine"
                >
                  <svg
                    className={`h-3 w-3 transition-transform ${showAllRecords ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
                  </svg>
                  {showAllRecords
                    ? COPY.points.recordsCollapse
                    : COPY.points.recordsShowAll(allRecords.length)}
                </button>
              ) : null}
            </>
          ) : (
            <p className="px-5 py-2.5 text-[12.5px] text-ink-muted">{COPY.points.recordsEmpty}</p>
          )}
        </div>
      </section>
    </section>
  );
}

export default PointsSettingsSection;
