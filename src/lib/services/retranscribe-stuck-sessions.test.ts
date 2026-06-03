import { describe, it, expect } from 'vitest';
import { isStuckNeedingRetranscribe } from './retranscribe-stuck-sessions';
import type { AudioSession } from '@/lib/db/schema';

const NOW = 1_700_000_000_000;

function makeSession(partial: Partial<AudioSession>): AudioSession {
  return {
    sessionId: 's1',
    userId: 'u1',
    mimeType: 'audio/webm',
    duration: 60000,
    status: 'completed',
    createdAt: new Date(NOW - 60 * 60 * 1000),
    // 默认给一个够大的 blob
    blob: new Blob([new Uint8Array(20 * 1024)], { type: 'audio/webm' }),
    ...partial,
  } as AudioSession;
}

describe('isStuckNeedingRetranscribe', () => {
  it('completed + 有 blob + 0 段 + 无 transcriptionStatus → 需要重新转写', () => {
    const s = makeSession({ transcriptionStatus: undefined });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(true);
  });

  it('已有转录段 → 不需要', () => {
    const s = makeSession({ transcriptionStatus: undefined });
    expect(isStuckNeedingRetranscribe(s, true, NOW)).toBe(false);
  });

  it('transcriptionStatus=completed → 不需要', () => {
    const s = makeSession({ transcriptionStatus: 'completed' });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('transcriptionStatus=failed → 不需要（已如实标失败，不反复重试）', () => {
    const s = makeSession({ transcriptionStatus: 'failed' });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('status=recording → 不需要（还在录）', () => {
    const s = makeSession({ status: 'recording', transcriptionStatus: undefined });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('没有 blob → 不需要（无法重新转写）', () => {
    const s = makeSession({ blob: undefined, transcriptionStatus: undefined });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('blob 过小（静音/噪声）→ 不需要', () => {
    const s = makeSession({
      blob: new Blob([new Uint8Array(1024)], { type: 'audio/webm' }),
      transcriptionStatus: undefined,
    });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('pending 但刚更新（< 3 分钟）→ 不重试（可能正在转）', () => {
    const s = makeSession({
      transcriptionStatus: 'pending',
      transcriptionUpdatedAt: new Date(NOW - 60 * 1000),
    });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(false);
  });

  it('pending 但很久没动（> 3 分钟）→ 视为卡死，重试', () => {
    const s = makeSession({
      transcriptionStatus: 'pending',
      transcriptionUpdatedAt: new Date(NOW - 5 * 60 * 1000),
    });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(true);
  });

  it('用户真实 case：1.5h 会议 completed + 大 blob + 0 段 + 无状态 → 需要救', () => {
    const s = makeSession({
      duration: 90 * 60 * 1000,
      blob: new Blob([new Uint8Array(30 * 1024 * 1024)], { type: 'audio/webm' }),
      transcriptionStatus: undefined,
      createdAt: new Date(NOW - 90 * 60 * 1000),
    });
    expect(isStuckNeedingRetranscribe(s, false, NOW)).toBe(true);
  });
});
