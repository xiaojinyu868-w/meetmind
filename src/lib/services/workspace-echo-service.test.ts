import { describe, expect, it } from 'vitest';
import { evaluateEchoQuality, normalizeEchoOutput } from './workspace-echo-service';

describe('workspace echo output quality', () => {
  it('accepts CommonStack schema output without an explicit title when the echo body is useful', () => {
    const normalized = normalizeEchoOutput({
      echo: '你今天反复停在“为什么这里会转折”这一点上，这比直接抄结论更有价值。顺着这个卡点再补一个例子，整条线会更清楚。',
      highlights: [],
      takeaway: '真正的线索藏在卡住的那一下。',
      sources: ['capture-1'],
    });

    const quality = evaluateEchoQuality({
      candidate: normalized,
      recentEchoes: [],
    });

    expect(normalized.title.length).toBeGreaterThanOrEqual(4);
    expect(quality.valid).toBe(true);
    expect(quality.reason).toBe('');
  });
});
