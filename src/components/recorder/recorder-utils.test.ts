import { describe, it, expect } from 'vitest';
import {
  normalizeRecorderErrorDetail,
  normalizeRecorderErrorMessage,
} from './recorder-utils';

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
