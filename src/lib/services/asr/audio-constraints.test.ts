import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildAudioConstraints,
  computeRms,
  HeuristicVad,
} from './audio-constraints';

describe('buildAudioConstraints', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL;
    delete process.env.NEXT_PUBLIC_ASR_ECHO_CANCELLATION;
    delete process.env.NEXT_PUBLIC_ASR_NOISE_SUPPRESSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sensible defaults', () => {
    const c = buildAudioConstraints();
    const audio = c.audio as MediaTrackConstraints;
    expect(audio.echoCancellation).toBe(true);
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.autoGainControl).toBe(true);
    expect(audio.channelCount).toBe(1);
  });

  it('respects env override to disable AGC', () => {
    process.env.NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL = 'false';
    const c = buildAudioConstraints();
    const audio = c.audio as MediaTrackConstraints;
    expect(audio.autoGainControl).toBe(false);
  });

  it('explicit opts beat env vars', () => {
    process.env.NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL = 'false';
    const c = buildAudioConstraints({ autoGainControl: true });
    const audio = c.audio as MediaTrackConstraints;
    expect(audio.autoGainControl).toBe(true);
  });

  it('includes deviceId when provided', () => {
    const c = buildAudioConstraints({ deviceId: 'mic-0' });
    const audio = c.audio as MediaTrackConstraints;
    expect(audio.deviceId).toEqual({ exact: 'mic-0' });
  });
});

describe('computeRms', () => {
  it('returns 0 for empty buffer', () => {
    expect(computeRms([])).toBe(0);
  });
  it('returns 0 for all-zero buffer', () => {
    expect(computeRms([0, 0, 0, 0])).toBe(0);
  });
  it('matches known values', () => {
    // [1, -1, 1, -1] → rms = sqrt(4/4) = 1
    expect(computeRms([1, -1, 1, -1])).toBeCloseTo(1, 5);
    // [0.5, 0.5] → rms = 0.5
    expect(computeRms([0.5, 0.5])).toBeCloseTo(0.5, 5);
  });
});

describe('HeuristicVad', () => {
  function loudFrame(amp = 0.3, len = 160): Float32Array {
    const f = new Float32Array(len);
    for (let i = 0; i < len; i++) f[i] = amp * Math.sin(i * 0.1);
    return f;
  }
  function silentFrame(len = 160): Float32Array {
    return new Float32Array(len);
  }

  it('does not fire during warmup', () => {
    const vad = new HeuristicVad({ warmupFrames: 5 });
    for (let i = 0; i < 5; i++) {
      const r = vad.process(loudFrame());
      expect(r.speaking).toBe(false);
    }
  });

  it('detects speech after warmup + attack frames', () => {
    const vad = new HeuristicVad({ warmupFrames: 2, rmsThreshold: 0.05 });
    // warmup with silence → low noise floor
    vad.process(silentFrame());
    vad.process(silentFrame());

    // first loud frame: rising, not yet speaking
    const r1 = vad.process(loudFrame());
    expect(r1.rms).toBeGreaterThan(0.05);
    // second loud frame: attack reached → speaking
    const r2 = vad.process(loudFrame());
    expect(r2.speaking).toBe(true);
  });

  it('releases speaking after sustained silence', () => {
    const vad = new HeuristicVad({ warmupFrames: 1 });
    vad.process(silentFrame());
    vad.process(loudFrame());
    vad.process(loudFrame());
    // 10 frames of silence → release
    for (let i = 0; i < 10; i++) {
      vad.process(silentFrame());
    }
    const r = vad.process(silentFrame());
    expect(r.speaking).toBe(false);
  });

  it('reset clears state', () => {
    const vad = new HeuristicVad({ warmupFrames: 1 });
    vad.process(silentFrame());
    vad.process(loudFrame());
    vad.process(loudFrame());
    vad.reset();
    // After reset we're in warmup again
    const r = vad.process(loudFrame());
    expect(r.speaking).toBe(false);
  });
});
