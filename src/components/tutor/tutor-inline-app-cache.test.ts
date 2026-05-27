import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { readCachedAppResult, readCachedTaskState } from '@/lib/utils/app-execution-cache';
import {
  readCachedReviewInlineAppState,
  writeReviewInlineAppError,
  writeReviewInlineAppRunning,
  writeReviewInlineAppSuccess,
} from './tutor-inline-app-cache';

const result: AppExecutionResult = {
  pluginId: 'mindmap-outline',
  version: 'test',
  cards: [],
  tasks: [],
  trace: [],
  render: {
    mode: 'mindmap',
    title: '课堂知识结构',
    payload: { markdown: '# 课堂知识结构' },
  },
};

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });
}

describe('tutor inline app cache', () => {
  beforeEach(() => installLocalStorageMock());

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('hydrates a ready inline app from the shared app result cache', () => {
    writeReviewInlineAppSuccess('session-1', 'mindmap', result);

    const state = readCachedReviewInlineAppState('session-1', 'mindmap');

    expect(state).toMatchObject({
      appKey: 'mindmap',
      status: 'ready',
      payload: { markdown: '# 课堂知识结构' },
    });
    expect(state?.result).toEqual(result);
  });

  it('persists inline app success into the shared app cache used by the application matrix', () => {
    const state = writeReviewInlineAppSuccess('session-1', 'mindmap', result);

    expect(state.status).toBe('ready');
    expect(readCachedAppResult('session-1', 'mindmap')).toEqual(result);
    expect(readCachedTaskState('session-1', 'mindmap')).toMatchObject({ status: 'success' });
  });

  it('persists running and error states so restored chats do not start duplicate work blindly', () => {
    writeReviewInlineAppRunning('session-1', 'mindmap');
    expect(readCachedTaskState('session-1', 'mindmap')).toMatchObject({ status: 'running' });

    writeReviewInlineAppError('session-1', 'mindmap', '生成失败');
    expect(readCachedTaskState('session-1', 'mindmap')).toMatchObject({
      status: 'error',
      error: '生成失败',
    });
  });
});
