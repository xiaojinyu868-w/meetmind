import { describe, expect, it } from 'vitest';
import { extractTextFromSyncResponse, readPcm16Wav } from './qwen-caller';

describe('extractTextFromSyncResponse', () => {
  it('extracts the current multimodal response shape', () => {
    expect(extractTextFromSyncResponse({
      output: {
        choices: [{ message: { content: [{ text: '课堂转录结果' }] } }],
      },
    })).toBe('课堂转录结果');
  });

  it('accepts direct output text and rejects empty payloads', () => {
    expect(extractTextFromSyncResponse({ output: { text: '直接文本' } })).toBe('直接文本');
    expect(extractTextFromSyncResponse({ output: {} })).toBe('');
  });
});

describe('readPcm16Wav', () => {
  it('loads the frozen realtime fixture as 16kHz mono PCM16', () => {
    const result = readPcm16Wav('tests/eval/asr/fixtures/demo-en-clean-25s.wav');
    expect(result).toMatchObject({ sampleRate: 16000, channelCount: 1, bitsPerSample: 16 });
    expect(result.pcm.byteLength).toBe(25 * 16000 * 2);
  });
});
