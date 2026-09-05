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
  // 微信支付结果回调：微信服务器无 Bearer，APIv3 平台证书验签是唯一防线
  '/api/wechat/pay-notify',
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
  // 积分 Phase 2：server.js 内部回调的 ASR 分钟结算口，靠 x-internal-secret 鉴权（无 Bearer）
  '/api/points/settle-asr',
  // 录课前服务端额度预检，同上内部接口
  '/api/points/precheck-asr',
  // 充值套餐列表：静态非敏感数据，PaywallDialog 客户端拉取（guest 也可能触发 paywall）
  '/api/pay/packs',
  '/api/asr/oneshot',
  // 板书精讲 narration TTS（音频产物非敏感；有 500 字上限 + LRU）
  '/api/board/tts',
  // 板演批改（入图 ≤4.5MB + 文本 ≤2000 字；输出仅勾叉网格坐标与一句话点评，非敏感）
  '/api/board/grade-ink',
  // 拍题开讲（入图 ≤4.5MB；输出为生成的板书脚本，非敏感。DEMO 期匿名可用，上线前补限流）
  '/api/board/photo-explain',
  // 拍题开讲·流式版（SSE 逐单元下发，同上限同理由）
  '/api/board/photo-explain-stream',
  // hanzi-writer 笔画数据自托管（静态只读数据，替代 jsDelivr CDN）
  '/api/board/hanzi/*',
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
  '/api/apps/teach-back/respond',
  '/api/class-check/plan',
  '/api/class-check/question',
  '/api/apps/infographic/generate-image',
  '/api/extract-terms',
  '/api/transcript-enhance',
  '/api/translate/en-zh',
  '/api/translate/zh-en',
  '/api/classroom/*',
  // AI 家教「上课」线（codex app-server 底座）：EventSource 无法带 Bearer，
  // 与 /api/classroom/* 同级别公开；internal 子路由靠 x-teach-internal 共享令牌自验
  '/api/teach/*',
  // 「请一个分身」线（codex app-server 底座，teach 平级复刻）：EventSource
  // 无法带 Bearer，与 /api/teach/* 同级别公开；分身线无 MCP 内部回调，不需要 internal 令牌
  '/api/fenshen/*',
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
  // 播客音频 —— <audio> 标签无法带 Bearer；靠不可猜文件名（podcast-<时间戳>）控制访问，与信息图同级别。
  '/api/podcast/audio/*',
  // v3.0 SharedAgent —— 落地页和 4 个 share API 都允许匿名打开。
  // 需要鉴权的（创建、领取）由各自 route handler 内部用 authService.verifyToken 自查。
  '/share/*',
  '/api/share/*',
  // 桌面端小窗：Electron 壳内加载的紧凑面板，浏览器直接打开也可用
  '/companion',
  // 清小搭广场接入：平台网关带的是 XIAODA_API_KEY（非 MeetMind JWT），
  // 由 compat 路由内 checkXiaodaAuth 自验 Bearer，无效返回 401。
  '/api/compat/*',
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
