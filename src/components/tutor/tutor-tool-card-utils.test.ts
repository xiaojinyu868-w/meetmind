// M5 T5.5 — TutorToolCard 纯逻辑层单测（不渲染 DOM）
import { describe, it, expect } from 'vitest';
import {
  extractToolParts,
  readableToolName,
  statusText,
  type TutorToolPartLike,
} from './tutor-tool-card-utils';

describe('extractToolParts', () => {
  it('filters only tool-* parts', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      { type: 'tool-makeQuiz', state: 'output-available' },
      { type: 'reasoning', text: 'think' },
      { type: 'tool-lookupTranscript', state: 'output-available' },
    ];
    const r = extractToolParts(parts);
    expect(r).toHaveLength(2);
    expect(r.map((p: TutorToolPartLike) => p.type)).toEqual([
      'tool-makeQuiz',
      'tool-lookupTranscript',
    ]);
  });

  it('handles empty parts', () => {
    expect(extractToolParts([])).toEqual([]);
  });

  it('ignores null / non-object entries', () => {
    const parts = [null, undefined, { type: 'tool-makeFlashcards' }, 42];
    const r = extractToolParts(parts);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('tool-makeFlashcards');
  });
});

describe('readableToolName', () => {
  it('maps known tool names to Chinese', () => {
    expect(readableToolName('tool-makeFlashcards')).toBe('闪卡');
    expect(readableToolName('tool-makeQuiz')).toBe('测验');
    expect(readableToolName('tool-makeMindmap')).toBe('思维导图');
    expect(readableToolName('tool-lookupTranscript')).toBe('课堂片段');
  });

  it('accepts bare tool names (without tool- prefix)', () => {
    expect(readableToolName('makeQuiz')).toBe('测验');
  });

  it('falls back to input string for unknown tools', () => {
    expect(readableToolName('tool-unknownThing')).toBe('unknownThing');
  });
});

describe('statusText', () => {
  it('pending states → "我在给你做X"', () => {
    expect(statusText('input-streaming', '闪卡')).toContain('我在给你做');
    expect(statusText('input-available', '测验')).toContain('我在给你做');
  });

  it('output-available → "X 准备好了"', () => {
    expect(statusText('output-available', '思维导图')).toContain('准备好了');
  });

  it('output-error without specific error → generic phrase', () => {
    expect(statusText('output-error', '闪卡')).toContain('暂时没做成');
    expect(statusText('output-error', '闪卡')).toContain('用对话讲');
  });

  it('output-error with specific error → surfaces it', () => {
    expect(statusText('output-error', '测验', 'LLM 超时')).toContain('LLM 超时');
  });
});
