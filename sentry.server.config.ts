/**
 * Sentry server-side config（Node.js runtime）
 *
 * 集成三件套：
 * 1. vercelAIIntegration —— 自动捕获 AI SDK v6 的 streamText/generateText span（agent loop / tool-call）
 * 2. pinoIntegration     —— 把 pino warn/error 自动映射为 Sentry breadcrumbs + logs
 * 3. 默认 HTTP/Prisma 追踪
 *
 * DSN 缺失时完全不启动，业务逻辑不受影响（pino 照样跑）。
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.npm_package_version,

    // Tracing 采样率：prod 默认 0.2，非 prod 全采
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? 0.2 : 1.0),
    ),

    // 允许 Sentry 记录结构化日志（pino integration 依赖）
    enableLogs: true,

    integrations: [
      // AI SDK v6 — 自动追踪 streamText / generateText 的每个 step / tool call
      Sentry.vercelAIIntegration({
        recordInputs: process.env.SENTRY_AI_RECORD_INPUTS === 'true',
        recordOutputs: process.env.SENTRY_AI_RECORD_OUTPUTS === 'true',
      }),

      // pino —— 结构化日志自动映射 breadcrumbs + logs
      // 只把 warn/error 上报，info/debug 仅走 pino stdout（避免爆配额）
      Sentry.pinoIntegration({}),
    ],

    // 忽略预期的客户端中断 / abort 错误
    ignoreErrors: [
      'AbortError',
      'The user aborted a request',
      'Request was aborted',
      'TypeError: fetch failed',
    ],

    // beforeSend：在 prod 可以在这里做最后一层脱敏
    beforeSend(event) {
      // 移除 authorization header（Sentry 默认会做，但保险）
      if (event.request?.headers) {
        delete (event.request.headers as Record<string, unknown>).authorization;
        delete (event.request.headers as Record<string, unknown>).Authorization;
        delete (event.request.headers as Record<string, unknown>).cookie;
      }
      return event;
    },
  });
}
