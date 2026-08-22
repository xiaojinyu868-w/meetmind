/**
 * PaywallDialog — 高意向时刻的付费拦截页（v9 呼吸森林）
 *
 * 触发：Tutor/应用 402 insufficient_points、录课免费分钟用尽（usePaywall 全局状态）。
 * 流程：差额说明 → 选套餐（3 档）→ 微信扫码（Native code_url 转 QR，轮询订单）→ 到账庆祝。
 * 支付未配置（商户号未到位）时支付按钮置灰，显示"即将开通"，其余部分照常工作。
 *
 * 设计：v9-glass 玻璃卡 + v9-aura 光场 + 入场 v9-rise 阶梯（globals.css 基元）。
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { useAuth, readStoredAccessToken } from '@/lib/hooks/useAuth';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { notifyPointsChanged } from '@/hooks/usePointsSummary';
import { usePaywall } from '@/hooks/usePaywall';

interface RechargePack {
  key: string;
  amountFen: number;
  points: number;
}

interface MembershipPlanItem {
  tier: 'pro' | 'max';
  packKey: string;
  amountFen: number;
  days: number;
  asrFreeMinutesPerMonth: number;
  monthlyGrant: number;
  deepUnlock: boolean;
  appDiscount: number;
}

type Stage = 'select' | 'paying' | 'success';

const RECOMMENDED_PACK = 'standard';
const RECOMMENDED_PLAN = 'pro-monthly';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60_000;

export function PaywallDialog() {
  const { open, reason, balance, required, requiredTier, tab } = usePaywall();
  const closePaywall = usePaywall((s) => s.closePaywall);
  const { accessToken, refreshToken } = useAuth();

  const [packs, setPacks] = useState<RechargePack[]>([]);
  const [plans, setPlans] = useState<MembershipPlanItem[]>([]);
  const [activeTab, setActiveTab] = useState<'points' | 'membership'>('points');
  const [selectedKey, setSelectedKey] = useState(RECOMMENDED_PACK);
  const [stage, setStage] = useState<Stage>('select');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [payUnavailable, setPayUnavailable] = useState(false);
  const [orderExpired, setOrderExpired] = useState(false);
  const [grantedPoints, setGrantedPoints] = useState(0);
  const [grantedTier, setGrantedTier] = useState('');
  const [busy, setBusy] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 打开时重置状态并拉套餐；Tab 按 reason 推断（会员闸门/升级 → 会员 Tab）
  useEffect(() => {
    if (!open) return;
    const initialTab =
      tab ?? (reason === 'membership_required' || reason === 'upgrade' ? 'membership' : 'points');
    setActiveTab(initialTab);
    setSelectedKey(initialTab === 'membership' ? RECOMMENDED_PLAN : RECOMMENDED_PACK);
    setStage('select');
    setQrDataUrl('');
    setPayUnavailable(false);
    setOrderExpired(false);
    fetch('/api/pay/packs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { packs?: RechargePack[]; membershipPlans?: MembershipPlanItem[] } | null) => {
        if (data?.packs?.length) setPacks(data.packs);
        if (data?.membershipPlans?.length) setPlans(data.membershipPlans);
      })
      .catch(() => undefined);
    return stopPolling;
  }, [open, reason, tab, stopPolling]);

  const markPaid = useCallback((points: number) => {
    stopPolling();
    setGrantedPoints(points);
    setStage('success');
    notifyPointsChanged();
    window.setTimeout(() => usePaywall.getState().closePaywall(), 2200);
  }, [stopPolling]);

  const startPolling = useCallback((outTradeNo: string) => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    pollTimerRef.current = setInterval(() => {
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        setOrderExpired(true);
        return;
      }
      void (async () => {
        try {
          const url = `/api/pay/order/${encodeURIComponent(outTradeNo)}`;
          // 每轮从 localStorage 取最新 token：轮询期间 token 可能已被主动续期替换
          let res = await fetch(url, {
            headers: { Authorization: `Bearer ${readStoredAccessToken() ?? ''}` },
          });
          if (res.status === 401) {
            // token 会话中途过期：先续期再重试一次，避免"已支付却永远轮不到 paid"
            const refreshed = await refreshToken();
            if (!refreshed) return;
            res = await fetch(url, {
              headers: { Authorization: `Bearer ${readStoredAccessToken() ?? ''}` },
            });
          }
          if (!res.ok) return;
          const order = (await res.json().catch(() => null)) as
            | { status?: string; points?: number }
            | null;
          if (order?.status === 'paid') markPaid(order.points ?? 0);
          if (order?.status === 'expired' || order?.status === 'failed') {
            stopPolling();
            setOrderExpired(true);
          }
        } catch {
          // 网络抖动等下轮
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [refreshToken, markPaid, stopPolling]);

  const startPayment = useCallback(async () => {
    if (!accessToken || busy) return;
    setBusy(true);
    setOrderExpired(false);
    try {
      const res = await fetch('/api/pay/recharge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ packKey: selectedKey }),
      });
      if (res.status === 503) {
        setPayUnavailable(true);
        return;
      }
      if (!res.ok) return;
      const order = (await res.json()) as {
        outTradeNo?: string;
        codeUrl?: string;
        points?: number;
        membership?: { tier: string; days: number };
      };
      if (!order.outTradeNo || !order.codeUrl) return;
      // 会员档订单：成功页展示档位而非积分
      setGrantedTier(
        order.membership ? (COPY.membership.tierName[order.membership.tier] ?? order.membership.tier) : '',
      );
      const qr = await QRCode.toDataURL(order.codeUrl, { margin: 1, width: 220 });
      setQrDataUrl(qr);
      setStage('paying');
      startPolling(order.outTradeNo);
    } finally {
      setBusy(false);
    }
  }, [accessToken, busy, selectedKey, startPolling]);

  if (!open) return null;

  const tierLabel = COPY.membership.tierName[requiredTier ?? 'pro'] ?? 'Pro';
  const subtitle = reason === 'asr_quota'
    ? COPY.points.paywallAsrQuota
    : reason === 'membership_required'
      ? COPY.membership.blockedMembershipRequired(tierLabel)
      : reason === 'upgrade'
        ? COPY.membership.paywallMembershipPitch
        : reason === 'topup'
          ? COPY.membership.paywallPointsPitch
          : typeof balance === 'number' && typeof required === 'number'
            ? COPY.points.paywallInsufficient(balance, required)
            : COPY.points.paywallInsufficientUnknown;

  /** 会员档权益行（按 plan 字段条件渲染，空心权益不出现） */
  const planBenefits = (plan: MembershipPlanItem): string[] => {
    const lines = [
      COPY.membership.benefitFreeMinutes(plan.asrFreeMinutesPerMonth),
      COPY.membership.benefitMonthlyGrant(plan.monthlyGrant),
    ];
    if (plan.deepUnlock) lines.push(COPY.membership.benefitDeep);
    if (plan.appDiscount < 1) lines.push(COPY.membership.benefitDiscount);
    if (plan.tier === 'max') lines.push(COPY.membership.benefitModel);
    return lines;
  };

  const selectedPlan = plans.find((p) => p.packKey === selectedKey);
  const selectedPackItem = packs.find((p) => p.key === selectedKey);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm" onClick={closePaywall}>
      <div
        className="v9-glass relative w-full max-w-md overflow-hidden rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={COPY.points.paywallTitle}
      >
        <div className="v9-aura" aria-hidden>
          <div className="v9-blob v9-blob-pine" />
          <div className="v9-blob v9-blob-sky" />
          <div className="v9-blob v9-blob-sand" />
        </div>

        <button
          type="button"
          onClick={closePaywall}
          aria-label={COPY.points.paywallDismiss}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-white/60 hover:text-ink"
        >
          <X size={15} />
        </button>

        <div className="relative flex flex-col items-center px-6 py-8 text-center sm:px-8">
          {stage === 'success' ? (
            <>
              <OctoAvatar mood="love" size="lg" aura={false} />
              <h2 className="mt-4 font-serif text-[26px] italic tracking-[-0.01em] text-ink">
                {grantedTier
                  ? COPY.membership.paywallSuccessTitle(grantedTier)
                  : COPY.points.paywallSuccessTitle}
              </h2>
              <p className="mt-2 text-[13px] text-ink-secondary">
                {grantedTier
                  ? COPY.membership.paywallSuccessBody
                  : COPY.points.paywallSuccessBody(grantedPoints)}
              </p>
            </>
          ) : stage === 'paying' ? (
            <>
              <h2 className="font-serif text-[24px] italic tracking-[-0.01em] text-ink">
                {COPY.points.paywallPayingTitle}
              </h2>
              <div className="mt-5 rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
                {qrDataUrl
                  // eslint-disable-next-line @next/next/no-img-element -- QR 是运行时 dataURL，无需 next/image 优化
                  ? <img src={qrDataUrl} alt={COPY.points.paywallPayingTitle} className="h-[220px] w-[220px]" />
                  : <div className="h-[220px] w-[220px]" />}
              </div>
              {orderExpired ? (
                <button
                  type="button"
                  onClick={() => void startPayment()}
                  className="mt-4 rounded-full bg-ink px-5 py-2 text-[12.5px] font-medium text-white transition hover:bg-pine"
                >
                  {COPY.points.paywallPayExpired}
                </button>
              ) : (
                <p className="mt-4 text-[12px] leading-5 text-ink-muted">{COPY.points.paywallPayingHint}</p>
              )}
            </>
          ) : (
            <>
              <OctoAvatar mood="happy" size="lg" aura={false} />
              <h2 className="v9-rise v9-d1 mt-4 font-serif text-[26px] italic tracking-[-0.01em] text-ink">
                {activeTab === 'membership' ? COPY.membership.paywallTitle : COPY.points.paywallTitle}
              </h2>
              <p className="v9-rise v9-d2 mt-2 max-w-xs text-[13px] leading-6 text-ink-secondary">{subtitle}</p>

              {/* 会员 / 充积分 双 Tab */}
              <div className="v9-rise v9-d2 mt-5 flex w-full rounded-full border border-white/70 bg-white/45 p-1">
                {(['membership', 'points'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setActiveTab(key);
                      setSelectedKey(key === 'membership' ? RECOMMENDED_PLAN : RECOMMENDED_PACK);
                    }}
                    className={cn(
                      'flex-1 rounded-full py-1.5 text-[12.5px] font-medium transition duration-300',
                      activeTab === key ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {key === 'membership' ? COPY.membership.paywallTabMembership : COPY.membership.paywallTabPoints}
                  </button>
                ))}
              </div>

              {activeTab === 'membership' ? (
                <div className="v9-rise v9-d3 mt-4 grid w-full grid-cols-2 gap-2.5">
                  {plans.map((plan) => {
                    const selected = plan.packKey === selectedKey;
                    const label = COPY.membership.tierName[plan.tier] ?? plan.tier;
                    return (
                      <button
                        key={plan.packKey}
                        type="button"
                        onClick={() => setSelectedKey(plan.packKey)}
                        className={cn(
                          'relative flex flex-col items-start gap-1.5 rounded-2xl border px-3.5 pb-3 pt-4 text-left transition duration-300',
                          selected
                            ? 'border-pine/50 bg-white/85 shadow-[0_8px_24px_rgba(47,107,85,0.12)]'
                            : 'border-white/70 bg-white/45 hover:-translate-y-0.5 hover:bg-white/70',
                        )}
                      >
                        {plan.packKey === RECOMMENDED_PLAN ? (
                          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-vermilion px-2 py-0.5 text-[9.5px] font-medium text-white">
                            {COPY.points.paywallPackRecommend}
                          </span>
                        ) : null}
                        <span className="flex w-full items-baseline justify-between">
                          <span className="text-[14px] font-semibold text-ink">{label}</span>
                          <span className="text-[12px] tabular-nums text-ink-secondary">
                            {COPY.membership.planPriceMonth(plan.amountFen)}
                          </span>
                        </span>
                        <span className="flex flex-col gap-0.5">
                          {planBenefits(plan).map((line) => (
                            <span key={line} className="text-[11px] leading-4 text-ink-muted">{line}</span>
                          ))}
                        </span>
                        {selected ? <Check size={13} className="absolute right-2 top-2 text-pine" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="v9-rise v9-d3 mt-4 grid w-full grid-cols-3 gap-2.5">
                  {packs.map((pack) => {
                    const selected = pack.key === selectedKey;
                    return (
                      <button
                        key={pack.key}
                        type="button"
                        onClick={() => setSelectedKey(pack.key)}
                        className={cn(
                          'relative flex flex-col items-center gap-1 rounded-2xl border px-2 pb-3 pt-4 transition duration-300',
                          selected
                            ? 'border-pine/50 bg-white/85 shadow-[0_8px_24px_rgba(47,107,85,0.12)]'
                            : 'border-white/70 bg-white/45 hover:-translate-y-0.5 hover:bg-white/70',
                        )}
                      >
                        {pack.key === RECOMMENDED_PACK ? (
                          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-vermilion px-2 py-0.5 text-[9.5px] font-medium text-white">
                            {COPY.points.paywallPackRecommend}
                          </span>
                        ) : null}
                        <span className="text-[12px] font-medium text-ink-secondary">{COPY.points.paywallPackLabel[pack.key] ?? pack.key}</span>
                        <span className="text-[19px] font-semibold tabular-nums text-ink">{COPY.points.paywallPackCaption(pack.points)}</span>
                        <span className="text-[11px] tabular-nums text-ink-muted">¥{(pack.amountFen / 100).toFixed(2).replace(/\.00$/, '')}</span>
                        {selected ? <Check size={13} className="absolute right-2 top-2 text-pine" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {payUnavailable ? (
                <p className="v9-rise mt-5 max-w-xs text-[12.5px] leading-6 text-ink-muted">{COPY.points.paywallUnavailable}</p>
              ) : (
                <button
                  type="button"
                  disabled={busy || (activeTab === 'membership' ? plans.length === 0 : packs.length === 0)}
                  onClick={() => void startPayment()}
                  className="v9-rise v9-d4 mt-6 w-full rounded-full bg-ink py-3 text-[13.5px] font-medium text-white transition hover:bg-pine disabled:opacity-50"
                >
                  {activeTab === 'membership'
                    ? COPY.membership.planCta(
                        selectedPlan ? (COPY.membership.tierName[selectedPlan.tier] ?? selectedPlan.tier) : '',
                        selectedPlan?.amountFen ?? 0,
                      )
                    : COPY.points.paywallPayCta(selectedPackItem?.amountFen ?? 0)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
