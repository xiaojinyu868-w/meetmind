export interface PodcastSectionLike {
  title?: string;
  body?: string;
}

const INTERNAL_AUDIO_FAILURE = /(?:播客)?音频(?:未|没)生成|建连失败|鉴权失败|\b(?:401|403|429|500|502|503|504)\b|\b(?:forbidden|unauthorized|econnreset|enotfound)\b/i;

/**
 * 生成 provider 的原始失败只用于诊断，不是播客章节。
 * 用户已经能从顶部重试条看到“音频没做好”，不需要再暴露 HTTP/provider 细节。
 */
export function isInternalPodcastFailureSection(section: PodcastSectionLike): boolean {
  return INTERNAL_AUDIO_FAILURE.test(`${section.title || ''} ${section.body || ''}`);
}
