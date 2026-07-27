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
  '/api/auth/wechat/qr',
  '/api/wechat/mp',
  '/api/wechat/bind',
  '/api/wechat/bind/callback',
  '/api/wechat/capture/*',
  '/wechat/open/*',
  '/api/tutor',
  '/api/tutor/agent',
  '/api/tutor/intent',
  '/api/tutor/memory',
  '/api/chat',
  '/api/llm/models',
  '/api/asr-config',
  '/api/asr-stream',
  '/api/asr/oneshot',
  '/api/tutor-call',
  '/api/transcribe',
  '/api/transcribe-fast',
  '/api/transcribe-turbo',
  '/api/video/import',
  '/api/article/import',
  '/api/video/proxy',
  '/api/video/resolve',
  '/api/video/image',
  '/api/sources/ingest',
  '/api/sources/ingest-image',
  '/api/generate-topics',
  '/api/generate-summary',
  // 游客可先记录本地内容并体验今日情报；route 内仍按 IP 执行生成限流。
  '/api/feed',
  '/api/apps/plugins',
  '/api/apps/catalog',
  '/api/apps/readiness',
  '/api/apps/execute',
  '/api/apps/teach-back/evaluate',
  '/api/apps/teach-back/cover-check',
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
  '/api/feedback/message',
  '/api/health',
  '/api/workspace/search',
  // 档位2：录音音频流式服务 —— <audio> 标签无法带 Bearer，靠不可猜路径
  // （cuid userId + sessionId 文件名）控制访问，与 wechat-media 同级别。
  '/api/workspace/audio/*',
  '/api/workspace/audio-peaks/*',
  // 全端采集层：截图/关键帧图片服务 —— <img> 标签无法带 Bearer，靠不可猜路径
  // （cuid userId + imageKey 文件名）控制访问，与 audio 同级别。
  '/api/workspace/images/*',
  // 信息图图片 —— <img> 标签无法带 Bearer，分享页匿名访问；靠不可猜文件名（requestId+时间戳）控制访问。
  '/api/infographic/image/*',
  // v3.0 SharedAgent —— 落地页和 4 个 share API 都允许匿名打开。
  // 需要鉴权的（创建、领取）由各自 route handler 内部用 authService.verifyToken 自查。
  '/share/*',
  '/api/share/*',
  // 桌面端小窗：Electron 壳内加载的紧凑面板，浏览器直接打开也可用
  '/companion',
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
