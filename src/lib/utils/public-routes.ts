const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/help',
  '/feedback',
  '/app',
  '/api/auth/login',
  '/api/auth/login-with-code',
  '/api/auth/send-code',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/wechat',
  '/api/auth/wechat/callback',
  '/api/wechat/mp',
  '/api/wechat/bind',
  '/api/wechat/bind/callback',
  '/api/wechat/capture/*',
  '/wechat/open/*',
  '/api/tutor',
  '/api/tutor/agent',
  '/api/chat',
  '/api/asr-config',
  '/api/asr-stream',
  '/api/tutor-call',
  '/api/transcribe',
  '/api/transcribe-fast',
  '/api/transcribe-turbo',
  '/api/video/import',
  '/api/video/proxy',
  '/api/sources/ingest',
  '/api/sources/ingest-image',
  '/api/generate-topics',
  '/api/generate-summary',
  '/api/apps/plugins',
  '/api/apps/catalog',
  '/api/apps/execute',
  '/api/class-check/plan',
  '/api/class-check/question',
  '/api/apps/infographic/generate-image',
  '/api/extract-terms',
  '/api/transcript-enhance',
  '/api/translate/en-zh',
  '/api/translate/zh-en',
  '/api/classroom/*',
  '/api/analytics',
  '/api/analytics/stats',
  '/api/feedback',
  '/api/health',
  '/api/workspace/search',
] as const;

function matchPath(pathname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

export function isPublicRoute(pathname: string): boolean {
  return matchPath(pathname, PUBLIC_ROUTES);
}
