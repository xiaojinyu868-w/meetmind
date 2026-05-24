import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '@/types';
import {
  chooseBatchTranscribeEndpoints,
  mergeRealtimeTranscriptSegment,
  normalizeRecorderErrorDetail,
  normalizeRecorderErrorMessage,
} from './recorder-utils';

function segment(params: Pick<TranscriptSegment, 'id' | 'text' | 'startMs' | 'endMs'>): TranscriptSegment {
  return { confidence: 0.95, isFinal: true, ...params };
}

describe('chooseBatchTranscribeEndpoints', () => {
  it('uses the split async endpoint first for long recordings', () => {
    expect(chooseBatchTranscribeEndpoints({ durationMs: 55 * 60 * 1000, sizeBytes: 40 * 1024 * 1024 })).toEqual([
      '/api/transcribe-fast',
      '/api/transcribe',
      '/api/transcribe-turbo',
    ]);
  });

  it('keeps turbo first for short recordings', () => {
    expect(chooseBatchTranscribeEndpoints({ durationMs: 90_000, sizeBytes: 2 * 1024 * 1024 })).toEqual([
      '/api/transcribe-turbo',
      '/api/transcribe-fast',
      '/api/transcribe',
    ]);
  });
});

describe('mergeRealtimeTranscriptSegment', () => {
  it('ignores a repeated rewind window that has already been committed', () => {
    const existing = [
      segment({ id: 's1', text: '做了一个 Kimi Cloud 啊，然后 Manus 做了一个这个 Agent 啊', startMs: 21_000, endMs: 25_000 }),
      segment({ id: 's2', text: '一个 Cloud，然后过去一个月里面各种产品蜂拥出现', startMs: 25_000, endMs: 29_000 }),
      segment({ id: 's3', text: '出现了很多的。', startMs: 29_000, endMs: 30_000 }),
    ];

    const result = mergeRealtimeTranscriptSegment(existing, segment({
      id: 's1-again',
      text: '做了一个 Kimi Cloud 啊，然后 Manus 做了一个这个 Agent 啊',
      startMs: 21_000,
      endMs: 25_000,
    }));

    expect(result.action).toBe('ignore');
    expect(result.segments.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('repairs repeated service timestamps for sequential long-answer chunks', () => {
    const existing = [
      segment({ id: 's1', text: '模型的能力持续提升的话，那么很多事情将不再需要人类的注意力去做了。', startMs: 1_743_000, endMs: 1_743_000 }),
    ];

    const result = mergeRealtimeTranscriptSegment(existing, segment({
      id: 's2',
      text: '也就是说，原来任何的工作都需要人类来 attention，但是有了 agent 之后，就不一定需要人类 attention。',
      startMs: 1_743_000,
      endMs: 1_743_000,
    }));

    expect(result.action).toBe('append');
    expect(result.segments[1].startMs).toBeGreaterThan(result.segments[0].endMs);
    expect(result.segments[1].endMs).toBeGreaterThan(result.segments[1].startMs);
  });
});

describe('normalizeRecorderErrorDetail', () => {
  it('returns generic fallback for empty input', () => {
    expect(normalizeRecorderErrorDetail('')).toEqual({
      message: '录音出了点问题，请再试一次。',
    });
  });

  it('maps NotAllowedError → permission guidance', () => {
    const hint = normalizeRecorderErrorDetail('DOMException: NotAllowedError');
    expect(hint.message).toContain('麦克风');
    expect(hint.action).toContain('允许');
  });

  it('maps NotFoundError → suggest device check', () => {
    const hint = normalizeRecorderErrorDetail('NotFoundError: Requested device not found');
    expect(hint.action).toContain('输入设备');
  });

  it('maps NotReadableError → device-in-use', () => {
    const hint = normalizeRecorderErrorDetail('NotReadableError: device in use');
    expect(hint.action).toContain('其他');
  });

  it('maps rate limit → wait advice', () => {
    expect(normalizeRecorderErrorDetail('HTTP 429 Too Many Requests').action).toContain('30 秒');
  });

  it('maps file too large', () => {
    expect(normalizeRecorderErrorDetail('ASR_AUDIO_TOO_LARGE').action).toContain('分段');
  });

  it('maps API key missing', () => {
    expect(normalizeRecorderErrorDetail('ASR_API_KEY_MISSING').action).toContain('管理员');
  });

  it('maps network errors', () => {
    expect(normalizeRecorderErrorDetail('NetworkError: Failed to fetch').action).toContain('连接');
  });

  it('passes through unknown messages unchanged', () => {
    const hint = normalizeRecorderErrorDetail('something weird happened');
    expect(hint.message).toBe('something weird happened');
    expect(hint.action).toBeUndefined();
  });
});

describe('normalizeRecorderErrorMessage (legacy single-string)', () => {
  it('concatenates message + action when action exists', () => {
    const out = normalizeRecorderErrorMessage('NotAllowedError: Permission denied');
    expect(out).toMatch(/麦克风.*允许/);
  });

  it('returns just message when no action', () => {
    const out = normalizeRecorderErrorMessage('session already started or finished or failed');
    expect(out).toContain('重连');
    expect(out).not.toContain('undefined');
  });
});
