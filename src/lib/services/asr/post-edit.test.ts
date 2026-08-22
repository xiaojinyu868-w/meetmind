import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postEditSegments } from './post-edit';

describe('postEditSegments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty for empty input', async () => {
    const r = await postEditSegments([], { apiKey: 'x' });
    expect(r).toEqual([]);
  });

  it('passes through high-confidence segments without calling LLM', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
    const r = await postEditSegments(
      [{ id: 'a', text: '这是高置信内容', confidence: 0.97 }],
      { apiKey: 'x', confidenceThreshold: 0.85 },
    );
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('这是高置信内容');
    expect(r[0].modified).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends low-confidence segments to LLM and applies correction', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { id: 'a', text: '梯度下降', modified: true },
              ]),
            },
          },
        ],
      }),
    } as unknown as Response);
    const r = await postEditSegments(
      [{ id: 'a', text: '梯度下将', confidence: 0.6 }],
      { apiKey: 'x' },
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(r).toHaveLength(1);
    expect(r[0].modified).toBe(true);
    expect(r[0].text).toBe('梯度下降');
    expect(r[0].originalText).toBe('梯度下将');
  });

  it('keeps original when LLM reports modified but text identical', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: 'a', text: '一样', modified: true }]) } }],
      }),
    } as unknown as Response);

    const r = await postEditSegments(
      [{ id: 'a', text: '一样', confidence: 0.5 }],
      { apiKey: 'x' },
    );
    expect(r[0].modified).toBe(false);
    expect(r[0].text).toBe('一样');
  });

  it('falls back gracefully when LLM returns non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    const r = await postEditSegments(
      [{ id: 'a', text: 'low confidence text', confidence: 0.4 }],
      { apiKey: 'x' },
    );
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('low confidence text');
    expect(r[0].modified).toBe(false);
  });

  it('falls back gracefully when JSON parse fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as unknown as Response);

    const r = await postEditSegments(
      [{ id: 'a', text: 'low', confidence: 0.3 }],
      { apiKey: 'x' },
    );
    expect(r[0].modified).toBe(false);
  });

  it('handles both objects with `segments` and direct array payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ result: [{ id: 'a', text: 'corrected', modified: true }] }),
            },
          },
        ],
      }),
    } as unknown as Response);

    const r = await postEditSegments(
      [{ id: 'a', text: 'original', confidence: 0.5 }],
      { apiKey: 'x' },
    );
    expect(r[0].modified).toBe(true);
    expect(r[0].text).toBe('corrected');
  });

  it('respects batch size — splits low-confidence segments into batches of N', async () => {
    const segs = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      text: `低置信 ${i}`,
      confidence: 0.4,
    }));
    const capturedBodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBodies.push(String(init?.body));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '[]' } }] }),
      } as unknown as Response;
    });
    await postEditSegments(segs, { apiKey: 'x', batchSize: 5 });
    // 15 条 / 每批 5 条 = 3 批，全部复核（不再截断丢弃）
    expect(capturedBodies).toHaveLength(3);
    const firstUserMsg = JSON.parse(capturedBodies[0])?.messages?.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(firstUserMsg.content).toContain('"s0"');
    expect(firstUserMsg.content).toContain('"s4"');
    expect(firstUserMsg.content).not.toContain('"s5"');
  });

  it('caps total batches via maxBatches — overflow segments pass through unmodified', async () => {
    const segs = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      text: `低置信 ${i}`,
      confidence: 0.4,
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] }),
    } as unknown as Response);
    const r = await postEditSegments(segs, { apiKey: 'x', batchSize: 5, maxBatches: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r).toHaveLength(15);
    expect(r.every((seg) => !seg.modified)).toBe(true);
  });

  it('splits batches by character limit even when under batch size', async () => {
    const segs = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      text: '长'.repeat(100),
      confidence: 0.4,
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] }),
    } as unknown as Response);
    // 单批字符上限 250：每条 100 字 → 每批最多 2 条，4 条 = 2 批
    await postEditSegments(segs, { apiKey: 'x', batchSize: 10, batchCharLimit: 250 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('flags repeated filler text as needing review even with high confidence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] }),
    } as unknown as Response);
    await postEditSegments(
      [{ id: 'a', text: '嗯嗯嗯嗯嗯', confidence: 0.99 }],
      { apiKey: 'x' },
    );
    expect(fetchSpy).toHaveBeenCalled();
  });
});
