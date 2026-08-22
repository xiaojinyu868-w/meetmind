/**
 * token-refresh-scheduler — 访问令牌主动续期调度（纯函数 + 薄调度器，node 可单测）
 *
 * 背景：access token TTL 2h（app.config.ts），此前 useAuth 只在页面初始化时
 * 尝试 refresh，会话中途（尤其桌面壳长时间挂机）token 过期后：
 * /api/points/summary 401 静默返回 null、tutor/agent 把已付费用户当免费档 402，
 * 表现为"付了费但 Pro 功能不可用"。这里按 JWT exp 提前 5 分钟调度刷新，
 * 失败退避重试一次；再失败放弃（等用户操作触发的 401 自愈路径兜底）。
 */

/** 过期前多久刷新 */
const REFRESH_LEAD_MS = 5 * 60_000;
/** 刷新失败后的退避重试间隔 */
const RETRY_DELAY_MS = 30_000;

/** 解析 JWT payload 的 exp（秒）→ 毫秒 epoch；非法 token / 无 exp 返回 null */
export function readTokenExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * 计算距离刷新时点的毫秒数：exp - 5min - now。
 * 无 exp → null（不调度）；已越过刷新时点 → 0（立即刷新）。
 */
export function computeRefreshDelayMs(token: string, nowMs: number = Date.now()): number | null {
  const expMs = readTokenExpMs(token);
  if (expMs === null) return null;
  return Math.max(0, expMs - REFRESH_LEAD_MS - nowMs);
}

/**
 * 按 token exp 调度一次主动刷新；refresh 成功后由调用方随新 token 重建调度
 * （AuthProvider 的 effect 依赖 accessToken，刷新成功状态变更即自动重排）。
 * 返回取消函数（effect cleanup 用）。
 */
export function scheduleTokenRefresh(
  token: string,
  refresh: () => Promise<boolean>,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const arm = (delayMs: number, attempt: number) => {
    timer = setTimeoutFn(() => {
      void (async () => {
        if (cancelled) return;
        const ok = await refresh().catch(() => false);
        if (cancelled || ok) return;
        // 退避重试一次（网络抖动 / 服务端重启）；再失败放弃
        if (attempt === 0) arm(RETRY_DELAY_MS, 1);
      })();
    }, delayMs);
  };

  const delay = computeRefreshDelayMs(token);
  if (delay !== null) arm(delay, 0);

  return () => {
    cancelled = true;
    if (timer) clearTimeoutFn(timer);
  };
}
