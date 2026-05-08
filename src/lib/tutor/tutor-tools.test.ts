// Tutor tools 单测
// 重点验证 tool() wrapper 的形态（LLM 看得到的 description + schema），
// 以及 lookupTranscript 的纯逻辑正确性。
// 其他工具涉及 plugin 真实调用（会用 LLM），这里 stub 掉。

import { describe, it, expect } from 'vitest';
import { createTutorTools } from './tutor-tools';
import type { TranscriptSegment } from '@/types';

const fixtureSegments: TranscriptSegment[] = [
  { id: 'seg-0', text: '今天我们讲梯度下降算法', startMs: 0, endMs: 5000, confidence: 0.95 },
  { id: 'seg-1', text: '梯度下降是反向传播的基础', startMs: 5000, endMs: 10000, confidence: 0.94 },
  { id: 'seg-2', text: '我们来看一个 Python 例子', startMs: 10000, endMs: 15000, confidence: 0.95 },
  { id: 'seg-3', text: '这里涉及链式法则', startMs: 180_000, endMs: 185_000, confidence: 0.93 },
];

describe('createTutorTools', () => {
  const tools = createTutorTools({
    sessionId: 'test-sess',
    transcript: fixtureSegments,
    subject: '机器学习',
  });

  it('exposes all named tools (incl. makeCheatsheet / makeStudyReport)', () => {
    expect(Object.keys(tools).sort()).toEqual(
      [
        'lookupTranscript',
        'makeCheatsheet',
        'makeFlashcards',
        'makeMindmap',
        'makeQuiz',
        'makeStudyReport',
      ].sort(),
    );
  });

  it('each tool has description and inputSchema', () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} description`).toBeTruthy();
      expect((t as { description: string }).description.length).toBeGreaterThan(20);
      expect((t as { inputSchema: unknown }).inputSchema, `${name} schema`).toBeTruthy();
    }
  });
});

describe('lookupTranscript tool', () => {
  const tools = createTutorTools({
    sessionId: 'test',
    transcript: fixtureSegments,
  });

  it('finds matching segments and formats citations', async () => {
    const t = tools.lookupTranscript as { execute: (args: { query: string; limit: number }) => Promise<{ ok: boolean; matches: { text: string; beginMs: number; citation: string }[] }> };
    const res = await t.execute({ query: '梯度下降', limit: 5 });
    expect(res.ok).toBe(true);
    expect(res.matches.length).toBe(2);
    expect(res.matches[0].citation).toBe('[t=00:00]');
    expect(res.matches[1].citation).toBe('[t=00:05]');
  });

  it('respects limit', async () => {
    const t = tools.lookupTranscript as { execute: (args: { query: string; limit: number }) => Promise<{ matches: unknown[] }> };
    const res = await t.execute({ query: '梯度', limit: 1 });
    expect(res.matches.length).toBe(1);
  });

  it('returns empty matches for no hit', async () => {
    const t = tools.lookupTranscript as { execute: (args: { query: string; limit: number }) => Promise<{ matches: unknown[] }> };
    const res = await t.execute({ query: 'no such content', limit: 10 });
    expect(res.matches).toEqual([]);
  });

  it('formats large timestamps correctly', async () => {
    const t = tools.lookupTranscript as { execute: (args: { query: string; limit: number }) => Promise<{ matches: { citation: string }[] }> };
    const res = await t.execute({ query: '链式', limit: 1 });
    // 180000ms = 03:00
    expect(res.matches[0].citation).toBe('[t=03:00]');
  });
});
