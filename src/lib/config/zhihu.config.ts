/**
 * 知乎开放平台接入配置（server-only，凭证不得序列化给浏览器）。
 *
 * 三个凭证是三样东西，别串位（zip 里 zhihu-hackathon skill 的 doctor 就在防这个）：
 * - Access Secret：调用 developer.zhihu.com 全部接口的 Bearer；不带 X-OAuth-Token 时用户接口返回它所属账号本人
 * - OAuth App ID：短数字，进授权页 URL，公开无妨
 * - OAuth App Key：只在后端换 token（POST openapi.zhihu.com/access_token），不进日志、不进前端
 *
 * 契约事实源：知乎官方 zhihu skill v0.2.1 的 references/{http-api,user-api,oauth}.md（2026-07 核验）。
 */
export interface ZhihuConfig {
  /** 产品面开关：知乎登录 / 收藏夹导入等入口是否出现。凭证齐了也要显式打开，便于灰度与回滚 */
  enabled: boolean;
  /** 开放平台 Access Secret（邀测额度：站内/全网搜索各 5,000 次/天，热榜与直答各 100 次/天） */
  accessSecret: string;
  oauth: {
    appId: string;
    appKey: string;
    /** 必须是公网 HTTPS，且与开放平台登记值逐字一致；localhost 只能预览页面 */
    redirectUri: string;
  };
  /** 内容 + 用户数据接口 */
  apiBaseUrl: string;
  /** 授权页 + 换 token + /user */
  oauthBaseUrl: string;
  /** 搜索 / 热榜 / 用户数据请求超时 */
  timeoutMs: number;
  /** 直答（检索增强生成，慢）超时 */
  zhidaTimeoutMs: number;
  /**
   * 「本人模式」白名单：这些 MeetMind 用户在没绑定知乎时，用户数据接口不带 X-OAuth-Token，
   * 读到的是 Access Secret 所属知乎账号本人——给演示 / smoke 用的兜底，OAuth 凭证晚到也能走通全流程。
   * 其他用户没绑定就是没绑定，不会静默读到别人的收藏。
   */
  selfModeUserIds: string[];
}

export function getZhihuConfig(env: NodeJS.ProcessEnv = process.env): ZhihuConfig {
  const redirectUri = env.ZHIHU_OAUTH_REDIRECT_URI?.trim() || '';
  if (redirectUri && !/^https:\/\//i.test(redirectUri)) {
    // http / localhost 回调在知乎侧调不通，宁可启动时就报错，别让人比赛当天才发现
    throw new Error('invalid_zhihu_oauth_redirect_uri: must be a public https URL');
  }
  return {
    enabled: env.ZHIHU_ENABLED === 'true',
    accessSecret: env.ZHIHU_ACCESS_SECRET?.trim() || '',
    oauth: {
      appId: env.ZHIHU_OAUTH_APP_ID?.trim() || '',
      appKey: env.ZHIHU_OAUTH_APP_KEY?.trim() || '',
      redirectUri,
    },
    apiBaseUrl: 'https://developer.zhihu.com',
    oauthBaseUrl: 'https://openapi.zhihu.com',
    timeoutMs: 15_000,
    zhidaTimeoutMs: 120_000,
    selfModeUserIds: (env.ZHIHU_SELF_MODE_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  };
}

/** 三件套是否配齐到能做真实 OAuth 登录 */
export function isZhihuOAuthReady(config: ZhihuConfig = getZhihuConfig()): boolean {
  return Boolean(config.accessSecret && config.oauth.appId && config.oauth.appKey && config.oauth.redirectUri);
}
