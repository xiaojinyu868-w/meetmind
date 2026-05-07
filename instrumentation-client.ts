/**
 * Sentry client-side config（浏览器 runtime）
 * Next.js 15+ 的新位置是 instrumentation-client.ts
 *
 * 只上报真实错误（beforeSend 过滤网络中断、cancel 等），避免噪音。
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? 0.1 : 1.0),
    ),

    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,

    ignoreErrors: [
      'AbortError',
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'ChunkLoadError',
      'Load failed',
    ],
  });
}
