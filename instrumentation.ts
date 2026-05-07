/**
 * Next.js App Router instrumentation 入口
 * 见 https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Sentry 按 runtime 分别初始化：
 * - nodejs runtime: @sentry/nextjs + vercelAIIntegration + pinoIntegration
 * - edge runtime: 轻量 init
 *
 * 环境变量：
 * - SENTRY_DSN（或 NEXT_PUBLIC_SENTRY_DSN）：缺失时 Sentry 不启动，只保留本地 pino 日志
 * - SENTRY_ENV：默认读 NODE_ENV
 * - SENTRY_TRACES_SAMPLE_RATE：默认 0.2
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Next.js 15+ 的 onRequestError hook
 * 14 版本下 Next.js 不会主动调这个函数，但保留以便升级后零改造
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: { [key: string]: string | string[] | undefined };
  },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const Sentry = await import('@sentry/nextjs');
  const captureRequestError = (Sentry as unknown as {
    captureRequestError?: (e: unknown, r: unknown, c: unknown) => void;
  }).captureRequestError;
  captureRequestError?.(error, request, context);
}
