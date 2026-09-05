import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit, getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { meterUserIdFromRequest, runWithMeterContext } from '@/lib/services/point-meter';
import { getAppExecPrice } from '@/lib/config/pricing';
import { checkCanSpend, checkGuestDailyCost, spendPoints } from '@/lib/services/point-account-service';
import { getActiveMembership } from '@/lib/services/membership-service';
import { createLogger, track } from '@/lib/logger';
import {
  appPluginRegistry,
  buildExecutionContext,
  buildExecutionContextFromPack,
  getWorkshopAppByKey,
  isAppSupportedAtTier,
  validatePack,
  type AppExecuteRequest,
  type ContextPack,
  type ContextTier,
} from '@/lib/ai-native';
import { assessWorkshopReadiness } from '@/lib/services/workshop-readiness-service';
import { buildControlledAppPrompt } from '@/lib/services/ai-control-service';

const log = createLogger('apps/execute');

const GOVERNED_APP_KEYS = ['flashcards', 'quiz', 'mindmap', 'cheatsheet', 'infographic', 'audio-overview', 'teach-back'] as const;
type GovernedAppKey = typeof GOVERNED_APP_KEYS[number];

function isGovernedAppKey(value: string): value is GovernedAppKey {
  return GOVERNED_APP_KEYS.some((key) => key === value);
}

function parseServerTimeoutMs(
  envValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(envValue || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const APP_EXEC_DEFAULT_TIMEOUT_MS = parseServerTimeoutMs(
  process.env.APP_EXEC_TIMEOUT_MS,
  180 * 1000,
  30 * 1000,
  10 * 60 * 1000
);
const APP_EXEC_PODCAST_TIMEOUT_MS = parseServerTimeoutMs(
  process.env.APP_EXEC_PODCAST_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);
// 信息图：draft LLM + 内联生图串行（DashScope plus 降级通道最坏 ~2 分钟轮询 +
// 下载），默认 180s 会在长文渲染时整单超时，单独放宽到 5 分钟。
const APP_EXEC_INFOGRAPHIC_TIMEOUT_MS = parseServerTimeoutMs(
  process.env.APP_EXEC_INFOGRAPHIC_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);

function resolveExecuteTimeoutMs(appKey: string): number {
  if (appKey === 'audio-overview') return APP_EXEC_PODCAST_TIMEOUT_MS;
  if (appKey === 'infographic') return APP_EXEC_INFOGRAPHIC_TIMEOUT_MS;
  return APP_EXEC_DEFAULT_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`App execution timeout (${timeoutMs}ms)`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await applyRateLimit(request, 'appsExecute');
    if (rateLimitResponse) return rateLimitResponse;

    const payload = (await request.json()) as Partial<AppExecuteRequest>;
    const appKey = typeof payload.appKey === 'string' ? payload.appKey.trim() : '';
    const rawPack = payload.contextPack;
    const contextPack = rawPack
      && typeof rawPack === 'object'
      && Array.isArray(rawPack.lessons)
      && (rawPack.tier === 'class' || rawPack.tier === 'unit' || rawPack.tier === 'exam')
      ? rawPack as ContextPack
      : undefined;
    if (rawPack && !contextPack) {
      return NextResponse.json({ error: 'Invalid contextPack' }, { status: 400 });
    }
    if (contextPack) {
      const validation = validatePack(contextPack);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.reason || 'Invalid contextPack' }, { status: 400 });
      }
      if (payload.contextTier && payload.contextTier !== contextPack.tier) {
        return NextResponse.json({ error: 'contextTier does not match contextPack.tier' }, { status: 400 });
      }
    }
    const contextTier: ContextTier = contextPack?.tier
      ?? (payload.contextTier === 'unit' || payload.contextTier === 'exam' ? payload.contextTier : 'class');
    const traceHints: string[] = [];

    if (!contextPack && (!payload?.input?.transcript || !Array.isArray(payload.input.transcript))) {
      return NextResponse.json(
        { error: 'Missing input.transcript array' },
        { status: 400 }
      );
    }

    if (!payload.goal) {
      return NextResponse.json(
        { error: 'Missing goal' },
        { status: 400 }
      );
    }

    const requestedPluginId = typeof payload.pluginId === 'string' ? payload.pluginId.trim() : '';
    const catalogItem = appKey ? getWorkshopAppByKey(appKey) : undefined;
    const catalogPluginId = catalogItem?.pluginId;

    if (catalogItem && !isAppSupportedAtTier(catalogItem.supportedTiers, contextTier)) {
      return NextResponse.json({
        ok: false,
        error: 'APP_NOT_SUITABLE',
      }, { status: 422 });
    }

    if (appKey === 'cheatsheet') {
      const hasMultipleLessons = (contextPack?.lessons.length || 0) >= 2;
      const hasExamScope = contextPack?.tier === 'exam' && Boolean(
        contextPack.exam?.syllabus?.trim()
          || contextPack.exam?.pastPapers?.some((paper) => paper.content?.trim()),
      );
      if (!contextPack || (!hasMultipleLessons && !hasExamScope)) {
        return NextResponse.json({
          ok: false,
          error: 'MULTI_LESSON_CONTEXT_REQUIRED',
        }, { status: 422 });
      }
    }

    // appKey 是新链路的唯一分发依据，避免前端陈旧 pluginId 造成 500
    let pluginId: string | undefined = catalogPluginId || (requestedPluginId || undefined);
    if (catalogPluginId && requestedPluginId && requestedPluginId !== catalogPluginId) {
      traceHints.push(`plugin_override=${requestedPluginId}->${catalogPluginId}`);
    }

    // 兼容旧链路：若传入未知 pluginId，回退为自动匹配，避免直接失败
    if (!catalogPluginId && pluginId && !appPluginRegistry.get(pluginId)) {
      traceHints.push(`legacy_pluginid_unknown=${pluginId}`);
      pluginId = undefined;
    }

    const baseContext = buildExecutionContext({
      ...(payload as AppExecuteRequest),
      appKey: appKey || payload.appKey,
      contextTier,
      input: payload.input ?? { transcript: [], anchors: [], dataSource: 'unknown' },
    });
    const context = contextPack
      ? buildExecutionContextFromPack(contextPack, baseContext.goal, baseContext.model)
      : baseContext;
    if (isGovernedAppKey(appKey)) {
      context.runtimeControl = await buildControlledAppPrompt(appKey);
    }
    const readiness = await assessWorkshopReadiness({
      transcript: context.input.transcript,
      contextTitle: typeof context.input.metadata?.title === 'string' ? context.input.metadata.title : undefined,
      contextType: typeof context.input.metadata?.contextType === 'string'
        ? context.input.metadata.contextType
        : context.input.dataSource,
      activeAnchorCount: context.input.anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length,
      keyDifficulties: context.memory.keyDifficulties,
      summary: context.memory.summary,
      goalIntent: context.goal.intent,
      contextTier,
    });

    if (readiness.status === 'not_ready' || readiness.allowedAppKeys.length === 0) {
      // 材料不足是预期内的诚实空态，不是协议错误：200 + ok:false，
      // 前端按安静提示处理（422 会在用户控制台刷出红色网络错误）。
      return NextResponse.json({
        ok: false,
        error: 'CONTENT_NOT_READY',
        readiness,
      });
    }

    if (appKey && !readiness.allowedAppKeys.includes(appKey as typeof readiness.allowedAppKeys[number])) {
      return NextResponse.json({
        ok: false,
        error: 'APP_NOT_SUITABLE',
        readiness,
      });
    }

    // 积分真扣费（Phase 2）：执行前按 appKey 价目预检（Max 会员 8 折），402 拦截。
    // guest（无 Bearer）走日成本闸门（L1 堵漏）：超限 402 guest_daily_cap 引导登录。
    // execId 每次请求生成：一次执行一次扣费（重试会重新执行 LLM，理应重新计费）。
    const execUserId = getUserIdFromRequest(request);
    const execTier = execUserId ? (await getActiveMembership(execUserId)).tier : 'free';
    const execPrice = getAppExecPrice(appKey, execTier);
    const execId = crypto.randomUUID();
    if (execUserId && execPrice > 0) {
      const check = await checkCanSpend(execUserId, execPrice);
      if (!check.ok) {
        return NextResponse.json(
          { ok: false, error: check.error, balance: check.balance, required: check.required },
          { status: 402 },
        );
      }
    } else if (!execUserId && execPrice > 0) {
      const allowance = await checkGuestDailyCost(meterUserIdFromRequest(request, null));
      if (!allowance.ok) {
        return NextResponse.json({ ok: false, error: 'guest_daily_cap' }, { status: 402 });
      }
    }

    const result = await withTimeout(
      // 积分影子计量（Phase 1）：插件内部统一走 llm-service.chat()，
      // 这里包一层计量上下文即可零侵入归属到具体应用。
      runWithMeterContext(
        {
          feature: `apps:${appKey || 'legacy'}`,
          userId: meterUserIdFromRequest(request, getUserIdFromRequest(request)),
          refType: 'apps',
          refId: appKey || undefined,
        },
        () => appPluginRegistry.execute(context, pluginId),
      ),
      resolveExecuteTimeoutMs(appKey)
    );

    const tracedResult = {
      ...result,
      trace: [
        ...result.trace,
        ...traceHints,
        ...(!appKey ? ['legacy_appkey_fallback'] : []),
      ],
    };

    // 执行成功后结算（Phase 2）。预检已过；若并发下余额被扣光导致结算失败，
    // 产物已生成无法撤回——只 warn 留痕，不撤回用户已拿到的结果。
    if (execUserId && execPrice > 0) {
      const spend = await spendPoints({
        userId: execUserId,
        points: execPrice,
        reason: `apps:${appKey || 'legacy'}`,
        refType: 'apps',
        refId: appKey || null,
        // 真实成本已由影子流水（runWithMeterContext）计入熔断累计，这里记 0 防双算
        costMilliYuan: 0,
        idempotencyKey: `apps:${execUserId}:${execId}`,
      });
      if (!spend.ok) {
        // L4 对账信号：产物已交付但扣费失败，需要补偿——升到 error + track 聚合
        log.error('apps charge failed after precheck', {
          appKey,
          error: spend.error,
          balance: spend.balance,
          required: spend.required,
        });
        track({
          kind: 'points.charge_failed',
          feature: `apps:${appKey || 'legacy'}`,
          userId: execUserId,
          errorCode: spend.error,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      pluginId: tracedResult.pluginId,
      result: tracedResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'CONTENT_NOT_READY') {
      // 插件判定材料撑不出可靠成品：同为预期内空态，200 + ok:false
      return NextResponse.json({ ok: false, error: 'CONTENT_NOT_READY' });
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
