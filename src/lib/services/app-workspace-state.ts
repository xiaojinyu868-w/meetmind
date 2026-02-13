import { getPreference, setPreference } from '@/lib/db';

export const APP_STATE_KEY = 'app_last_state';
export const APP_STATE_TTL_MS = 24 * 60 * 60 * 1000;
export const APP_STATE_VERSION = 2;

export type PersistedViewMode = 'record' | 'review';
export type PersistedDataSource = 'live' | 'demo' | 'video';
export type PersistedReviewTab = 'timeline' | 'anchor-detail' | 'highlights' | 'summary' | 'notes' | 'apps';
export type PersistedVideoWorkspaceTab = 'chat' | 'confusion' | 'highlights' | 'summary' | 'notes' | 'apps';

export interface PersistedAppState {
  version?: number;
  savedAt: number;
  viewMode: PersistedViewMode;
  sessionId: string;
  dataSource?: PersistedDataSource;
  showSessionHistory?: boolean;
  reviewTab?: PersistedReviewTab;
  videoWorkspaceTab?: PersistedVideoWorkspaceTab;
  selectedAnchorId?: string;
  currentTime?: number;
  showTranscriptBar?: boolean;
}

export async function getPersistedAppState(): Promise<PersistedAppState | null> {
  return getPreference<PersistedAppState | null>(APP_STATE_KEY, null).catch(() => null);
}

export async function setPersistedAppState(state: PersistedAppState): Promise<void> {
  await setPreference(APP_STATE_KEY, state);
}

export function isPersistedAppStateFresh(state: PersistedAppState | null, now = Date.now()): boolean {
  if (!state || typeof state.savedAt !== 'number') return false;
  return now - state.savedAt < APP_STATE_TTL_MS;
}
