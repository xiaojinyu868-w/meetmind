import { describe, it, expect } from 'vitest';
import { TranscriptRenderMachine } from './render-state-machine';

describe('TranscriptRenderMachine', () => {
  it('starts empty', () => {
    const m = new TranscriptRenderMachine();
    expect(m.snapshot()).toEqual([]);
  });

  it('first interim -> status=interim', () => {
    const m = new TranscriptRenderMachine();
    const snap = m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 500, now: 1000 });
    expect(snap).toHaveLength(1);
    expect(snap[0].status).toBe('interim');
    expect(snap[0].text).toBe('你好');
  });

  it('consecutive identical interim graduates to stable when count and time both met', () => {
    const m = new TranscriptRenderMachine({ stabilizationCount: 3, stabilizationMs: 500 });
    m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 500, now: 1000 });
    let snap = m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 520, now: 1200 });
    // 2 次，时间 < 500ms, 还是 interim
    expect(snap[0].status).toBe('interim');
    snap = m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 540, now: 1600 });
    // 3 次，时间 >= 500ms → stable
    expect(snap[0].status).toBe('stable');
  });

  it('text change resets stability counter', () => {
    const m = new TranscriptRenderMachine({ stabilizationCount: 2, stabilizationMs: 0 });
    m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 100, now: 1000 });
    let snap = m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 200, now: 1100 });
    expect(snap[0].status).toBe('stable');

    // 文本变了，回到 interim
    snap = m.handleInterim({ itemId: 'a', text: '你好世界', beginMs: 0, endMs: 300, now: 1200 });
    expect(snap[0].status).toBe('interim');
  });

  it('handleFinal removes active and appends to finals', () => {
    const m = new TranscriptRenderMachine();
    m.handleInterim({ itemId: 'a', text: '你好', beginMs: 0, endMs: 500, now: 1000 });
    const snap = m.handleFinal({
      itemId: 'a',
      segments: [{ id: 'seg-1', text: '你好', beginMs: 0, endMs: 500 }],
    });
    expect(snap).toHaveLength(1);
    expect(snap[0].status).toBe('final');
    expect(snap[0].text).toBe('你好');
  });

  it('sorts by beginMs', () => {
    const m = new TranscriptRenderMachine();
    m.handleFinal({
      segments: [{ id: 's1', text: 'A', beginMs: 1000, endMs: 2000 }],
    });
    m.handleInterim({ itemId: 'a', text: 'B', beginMs: 500, endMs: 800, now: 3000 });
    const snap = m.snapshot();
    expect(snap.map((s) => s.text)).toEqual(['B', 'A']);
  });

  it('dropActive removes interim cleanly', () => {
    const m = new TranscriptRenderMachine();
    m.handleInterim({ itemId: 'a', text: 'hi', beginMs: 0, endMs: 100, now: 1000 });
    m.dropActive('a');
    expect(m.snapshot()).toEqual([]);
  });

  it('reset clears everything', () => {
    const m = new TranscriptRenderMachine();
    m.handleInterim({ itemId: 'a', text: 'hi', beginMs: 0, endMs: 100, now: 1000 });
    m.handleFinal({ segments: [{ id: 's1', text: 'ok', beginMs: 200, endMs: 300 }] });
    m.reset();
    expect(m.snapshot()).toEqual([]);
  });

  it('multiple concurrent active items', () => {
    const m = new TranscriptRenderMachine();
    m.handleInterim({ itemId: 'a', text: 'first', beginMs: 0, endMs: 100, now: 1000 });
    m.handleInterim({ itemId: 'b', text: 'second', beginMs: 200, endMs: 300, now: 1100 });
    const snap = m.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].text).toBe('first');
    expect(snap[1].text).toBe('second');
  });

  it('finals preserved after handling more interims', () => {
    const m = new TranscriptRenderMachine();
    m.handleFinal({ segments: [{ id: 's1', text: 'committed', beginMs: 0, endMs: 500 }] });
    m.handleInterim({ itemId: 'new', text: 'live', beginMs: 600, endMs: 700, now: 1000 });
    const snap = m.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].status).toBe('final');
    expect(snap[1].status).toBe('interim');
  });
});
