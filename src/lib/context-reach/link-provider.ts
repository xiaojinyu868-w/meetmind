/**
 * 链接平台识别工具
 *
 * 根据 URL 域名识别来源平台，返回平台 ID 和中文标签。
 * 用于 context-reach 和 wechat-inbox-service 的上下文生成。
 *
 * 注意：YouTube / Bilibili / Douyin 已被 video-link.ts 的 parseVideoLink 拦截，
 * 走 video-link channel，不会进入这里。
 */

export interface LinkProviderInfo {
  id: string;
  label: string;
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

const PROVIDER_RULES: Array<{
  hostPatterns: string[];
  id: string;
  label: string;
}> = [
  { hostPatterns: ['xiaohongshu.com', 'xhslink.com'], id: 'xiaohongshu', label: '小红书' },
  { hostPatterns: ['zhihu.com', 'zhuanlan.zhihu.com'], id: 'zhihu', label: '知乎' },
  { hostPatterns: ['mp.weixin.qq.com'], id: 'wechat-article', label: '微信公众号' },
  { hostPatterns: ['weibo.com', 'm.weibo.cn', 'weibo.cn'], id: 'weibo', label: '微博' },
  { hostPatterns: ['douban.com'], id: 'douban', label: '豆瓣' },
  { hostPatterns: ['juejin.cn'], id: 'juejin', label: '掘金' },
  { hostPatterns: ['sspai.com'], id: 'sspai', label: '少数派' },
  { hostPatterns: ['36kr.com'], id: '36kr', label: '36氪' },
  { hostPatterns: ['toutiao.com', 'toutiaocdn.com'], id: 'toutiao', label: '今日头条' },
  { hostPatterns: ['jianshu.com'], id: 'jianshu', label: '简书' },
  { hostPatterns: ['csdn.net'], id: 'csdn', label: 'CSDN' },
  { hostPatterns: ['github.com'], id: 'github', label: 'GitHub' },
  { hostPatterns: ['twitter.com', 'x.com'], id: 'twitter', label: 'X(Twitter)' },
  { hostPatterns: ['notion.so', 'notion.site'], id: 'notion', label: 'Notion' },
];

const GENERIC_PROVIDER: LinkProviderInfo = { id: 'generic', label: '网页' };

/**
 * 根据 URL 识别来源平台。
 *
 * @param url - 完整的 HTTP/HTTPS URL
 * @returns 平台 ID 和中文标签；未匹配时返回 { id: 'generic', label: '网页' }
 */
export function detectLinkProvider(url: string): LinkProviderInfo {
  try {
    const parsed = new URL(url.trim());
    const host = normalizeHost(parsed.hostname);

    for (const rule of PROVIDER_RULES) {
      for (const pattern of rule.hostPatterns) {
        if (host === pattern || host.endsWith(`.${pattern}`)) {
          return { id: rule.id, label: rule.label };
        }
      }
    }
  } catch {
    // URL 解析失败，返回 generic
  }

  return GENERIC_PROVIDER;
}
