import { describe, expect, it } from 'vitest';
import sessionUtils from './qwen-session.js';

const { buildQwenAsrFinishEvent, buildQwenAsrSessionConfig } = sessionUtils;

describe('buildQwenAsrSessionConfig', () => {
  it('uses the official corpus.text field for classroom context', () => {
    const config = buildQwenAsrSessionConfig({
      sampleRate: 16000,
      languageMode: 'zh',
      contextHint: '线性代数；特征向量',
      vadThreshold: 0.3,
      vadSilenceMs: 800,
    });

    expect(config.input_audio_transcription).toEqual({
      corpus: { text: '线性代数；特征向量' },
      language: 'zh',
    });
    expect('prompt' in config.input_audio_transcription).toBe(false);
    expect('semantic_punctuation_enabled' in config.input_audio_transcription).toBe(false);
  });

  it('omits language in auto mode for mixed-language classrooms', () => {
    const config = buildQwenAsrSessionConfig({
      sampleRate: 16000,
      languageMode: 'auto',
      contextHint: '',
      vadThreshold: 0.3,
      vadSilenceMs: 800,
    });

    expect(config.input_audio_transcription).toEqual({});
  });
});

describe('buildQwenAsrFinishEvent', () => {
  it('ends server VAD sessions with session.finish instead of manual commit', () => {
    expect(buildQwenAsrFinishEvent('event-final')).toEqual({
      event_id: 'event-final',
      type: 'session.finish',
    });
  });
});
