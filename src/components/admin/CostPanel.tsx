'use client';

/**
 * CostPanel — 管理员成本视图（积分影子计量 Phase 1）
 *
 * 数据源：GET /api/admin/costs?days=7|30（PointTransaction 影子流水聚合）。
 * 挂在 AiControlWorkbench 顶部，只读展示，不做任何写操作。
 */

import * as React from 'react';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';

interface CostBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costMilliYuan: number;
}

interface FeatureCostRow extends CostBucket {
  feature: string;
  modelId: string;
}

interface DailyCostRow extends CostBucket {
  date: string;
}

interface CostsResponse {
  days: number;
  since: string;
  total: CostBucket;
  byFeature: FeatureCostRow[];
  daily: DailyCostRow[];
}

export function CostPanel({ accessToken }: { accessToken: string | null }) {
  const [days, setDays] = React.useState<7 | 30>(7);
  const [data, setData] = React.useState<CostsResponse | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/costs?days=${days}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as { success?: boolean; data?: CostsResponse };
        if (!response.ok || payload.success !== true || !payload.data) throw new Error(String(response.status));
        if (!cancelled) setData(payload.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, days]);

  const maxDailyCost = React.useMemo(
    () => Math.max(1, ...(data?.daily.map((row) => row.costMilliYuan) ?? [1])),
    [data],
  );

  return (
    <section className="border-b border-divider bg-paper-warm/30 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Coins size={15} className="text-pine" />
          <h2 className="text-[14px] font-semibold">{COPY.adminCosts.title}</h2>
        </div>
        <p className="text-[11px] text-ink-muted">{COPY.adminCosts.body}</p>
        <div className="ml-auto flex gap-1 rounded-full border border-divider bg-white p-0.5">
          {([7, 30] as const).map((value) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                days === value ? 'bg-pine text-white' : 'text-ink-secondary hover:text-pine',
              )}
            >
              {value === 7 ? COPY.adminCosts.range7 : COPY.adminCosts.range30}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className="mt-4 text-[12px] text-vermilion">{COPY.adminCosts.loadFailed}</p>
      ) : !data || data.byFeature.length === 0 ? (
        <p className="mt-4 text-[12px] text-ink-muted">{COPY.adminCosts.empty}</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
          <div className="overflow-x-auto rounded-xl border border-divider bg-white">
            <table className="w-full min-w-[560px] text-left text-[11.5px]">
              <thead>
                <tr className="border-b border-divider text-[10px] uppercase tracking-caps text-ink-muted">
                  <th className="px-3.5 py-2.5 font-medium">{COPY.adminCosts.colFeature}</th>
                  <th className="px-3.5 py-2.5 font-medium">{COPY.adminCosts.colModel}</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">{COPY.adminCosts.colRequests}</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">{COPY.adminCosts.colTokens}</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">{COPY.adminCosts.colCost}</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.map((row) => (
                  <tr key={`${row.feature}:${row.modelId}`} className="border-b border-divider/60 last:border-0">
                    <td className="px-3.5 py-2.5 font-medium text-ink">{row.feature}</td>
                    <td className="px-3.5 py-2.5 font-mono text-[10.5px] text-ink-secondary">{row.modelId}</td>
                    <td className="px-3.5 py-2.5 text-right tabular-nums text-ink-secondary">{row.requests}</td>
                    <td className="px-3.5 py-2.5 text-right tabular-nums text-ink-secondary">
                      {COPY.adminCosts.tokens(row.promptTokens + row.completionTokens)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right tabular-nums text-pine">{COPY.adminCosts.cost(row.costMilliYuan)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-divider bg-paper-warm/50 text-[11.5px] font-semibold">
                  <td className="px-3.5 py-2.5" colSpan={2}>{COPY.adminCosts.total}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{data.total.requests}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {COPY.adminCosts.tokens(data.total.promptTokens + data.total.completionTokens)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-pine">
                    {COPY.adminCosts.cost(data.total.costMilliYuan)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-xl border border-divider bg-white px-3.5 py-3">
            <p className="text-[10px] font-medium uppercase tracking-caps text-ink-muted">{COPY.adminCosts.dailyTitle}</p>
            <div className="mt-2.5 space-y-1.5">
              {data.daily.map((row) => (
                <div key={row.date} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-mono text-[9.5px] text-ink-muted">{row.date.slice(5)}</span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-warm">
                    <div
                      className="h-full rounded-full bg-pine/70"
                      style={{ width: `${Math.max(2, (row.costMilliYuan / maxDailyCost) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 tabular-nums text-[10px] text-ink-secondary">
                    {COPY.adminCosts.cost(row.costMilliYuan)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
