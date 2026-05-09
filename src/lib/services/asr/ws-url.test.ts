import { describe, expect, it } from 'vitest';
import { buildAsrWebSocketCandidates } from './ws-url';

describe('buildAsrWebSocketCandidates', () => {
  it('uses ws for http pages', () => {
    expect(buildAsrWebSocketCandidates('http://localhost:3003/app')).toEqual([
      'ws://localhost:3003/api/asr-stream',
    ]);
  });

  it('uses wss for https pages and keeps the current host first', () => {
    expect(buildAsrWebSocketCandidates('https://capture.meetmind.online/app')).toEqual([
      'wss://capture.meetmind.online/api/asr-stream',
      'wss://capture.meetmind.online:8443/api/asr-stream',
    ]);
  });

  it('does not duplicate 8443 fallback when already on 8443', () => {
    expect(buildAsrWebSocketCandidates('https://capture.meetmind.online:8443/app')).toEqual([
      'wss://capture.meetmind.online:8443/api/asr-stream',
    ]);
  });
});
