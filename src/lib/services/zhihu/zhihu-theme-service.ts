/**
 * 知乎对「同学读一组材料」能力层（services/material-lessons/material-themes）的适配：收藏 → MaterialCandidate，
 * collectionKey = zhihu-favlist:<urlToken>。类型与纯函数原名转发，路由 / 测试不动。
 */

import type { ZhihuCaptureRecord } from './zhihu-import-service';
import { candidateOf } from './zhihu-material-candidate';
import {
  buildThemePrompt as coreBuildThemePrompt,
  normalizeThemes as coreNormalizeThemes,
  readCachedThemes as coreReadCachedThemes,
  themesForCollection,
  themesHash as coreThemesHash,
  type MaterialTheme,
  type MaterialThemes,
  type ThemeChatFn,
} from '@/lib/services/material-lessons/material-themes';

export type ZhihuFavlistTheme = MaterialTheme;
export type ZhihuFavlistThemes = MaterialThemes;
export type { ThemeChatFn };

export function favlistCollectionKey(favlistUrlToken: string): string {
  return `zhihu-favlist:${favlistUrlToken}`;
}

export function themesHash(records: ZhihuCaptureRecord[]): string {
  return coreThemesHash(records.map(candidateOf));
}

export function buildThemePrompt(favlistTitle: string, records: ZhihuCaptureRecord[]) {
  return coreBuildThemePrompt(favlistTitle, records.map(candidateOf));
}

export function normalizeThemes(raw: Parameters<typeof coreNormalizeThemes>[0], alias: Map<string, string>, records: ZhihuCaptureRecord[]) {
  return coreNormalizeThemes(raw, alias, records.map(candidateOf));
}

export function readCachedThemes(userId: string, favlistUrlToken: string): Promise<MaterialThemes | null> {
  return coreReadCachedThemes(userId, favlistCollectionKey(favlistUrlToken));
}

export function themesForFavlist(
  userId: string,
  favlistUrlToken: string,
  favlistTitle: string,
  records: ZhihuCaptureRecord[],
  opts: { chatFn?: ThemeChatFn; modelId?: string; force?: boolean; now?: () => number } = {},
): Promise<MaterialThemes> {
  return themesForCollection(userId, favlistCollectionKey(favlistUrlToken), favlistTitle, records.map(candidateOf), opts);
}
