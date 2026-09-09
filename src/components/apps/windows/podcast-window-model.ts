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

export interface PodcastSectionWithId extends PodcastSectionLike {
  id?: string;
}

const ROUND_SECTION_ID = /^studio-podcast-round-\d+$/;
const ROUND_SECTION_TITLE = /^第\s*\d+\s*轮(?:\s*[·•]\s*.+)?$/;

/**
 * 插件把每一轮对话也塞进 sections（title「第 N 轮 · Host A」，正文与 lines 重复）。
 * 窗口里逐字稿已经逐句展示，这些"章节"只是同一段话再列一遍——不进目录。
 */
export function isPodcastRoundSection(section: PodcastSectionWithId): boolean {
  if (section.id && ROUND_SECTION_ID.test(section.id)) return true;
  return ROUND_SECTION_TITLE.test((section.title || '').trim());
}

/** 把 sections 拆成：开场简介（studio-overview，一段话放在播放条下）+ 真正的章节目录 */
export function splitPodcastSections<T extends PodcastSectionWithId>(sections: T[]): { overview: T | null; chapters: T[] } {
  let overview: T | null = null;
  const chapters: T[] = [];
  for (const section of sections) {
    if (isInternalPodcastFailureSection(section) || isPodcastRoundSection(section)) continue;
    if (!overview && section.id === 'studio-overview') {
      overview = section;
      continue;
    }
    chapters.push(section);
  }
  return { overview, chapters };
}
