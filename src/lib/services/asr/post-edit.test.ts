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

  it('respects batch size — only sends first N low-confidence segments', async () => {
    const segs = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      text: `低置信 ${i}`,
      confidence: 0.4,
    }));
    let capturedBody: unknown;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = init?.body;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '[]' } }] }),
      } as unknown as Response;
    });
    await postEditSegments(segs, { apiKey: 'x', batchSize: 5 });
    const body = typeof capturedBody === 'string' ? JSON.parse(capturedBody) : null;
    const userMsg = body?.messages?.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('"s0"');
    expect(userMsg.content).toContain('"s4"');
    expect(userMsg.content).not.toContain('"s5"');
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
