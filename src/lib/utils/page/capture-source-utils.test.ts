import { describe, expect, it } from 'vitest';
import { resolvePendingAudioFailureStatus } from './capture-source-utils';

describe('resolvePendingAudioFailureStatus', () => {
  it('hides raw fetch failures behind a useful audio-preserved fallback', () => {
    expect(resolvePendingAudioFailureStatus('转写未完成： Failed to fetch')).toBe('网络不稳，原声已保留');
    expect(resolvePendingAudioFailureStatus('NetworkError: Failed to fetch')).toBe('网络不稳，原声已保留');
  });
});
