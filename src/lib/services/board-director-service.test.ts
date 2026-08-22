import { describe, expect, it } from 'vitest';
import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import { parseDirectorResponse } from './board-director-service';

const page: BoardPage = {
  segments: [
    {
      type: 'narration',
      narration: '我们来看这个公式，注意这里。',
      narrationDisplay: '我们来看这个公式，注意这里。',
      actions: [
        { type: 'write', text: 'E=mc²', role: 'term' },
        { type: 'circle', target: 'w1' },
      ],
    },
    {
      type: 'checkpoint',
      narration: '考考你。',
      question: { text: '题', role: 'term' },
      hints: ['一', '二', '三'],
      answer: '答案。',
      demoActions: [],
    },
    {
      type: 'narration',
      narration: '好，继续。',
      narrationDisplay: '好，继续。',
      actions: [{ type: 'pause', ms: 600 }],
    },
  ],
};

describe('parseDirectorResponse', () => {
  it('标准输出：cue 与 breathMs 都映射回对应 segment', () => {
    const raw = JSON.stringify({
      segments: [
        { segment: 0, cues: [{ actionIndex: 0, charIndex: 9 }, { actionIndex: 1, charIndex: 12 }], breathMs: 800 },
        { segment: 2, cues: [{ actionIndex: 0, charIndex: 2 }], breathMs: 300 },
      ],
    });
    const result = parseDirectorResponse(raw, page);
    expect(result.get(0)?.cues).toEqual([
      { actionIndex: 0, charIndex: 9 },
      { actionIndex: 1, charIndex: 12 },
    ]);
    expect(result.get(0)?.breathMs).toBe(800);
    expect(result.get(2)?.breathMs).toBe(300);
  });

  it('越界条目丢弃：segment 下标越界 / checkpoint 段 / actionIndex 越界 / charIndex 越界', () => {
    const raw = JSON.stringify({
      segments: [
        { segment: 9, cues: [{ actionIndex: 0, charIndex: 1 }] },
        { segment: 1, cues: [{ actionIndex: 0, charIndex: 1 }] }, // checkpoint 段不收
        { segment: 0, cues: [
          { actionIndex: 5, charIndex: 1 },   // actionIndex 越界
          { actionIndex: 0, charIndex: 999 }, // charIndex 越界
          { actionIndex: 1, charIndex: 3 },   // 合法
        ] },
      ],
    });
    const result = parseDirectorResponse(raw, page);
    expect(result.size).toBe(1);
    expect(result.get(0)?.cues).toEqual([{ actionIndex: 1, charIndex: 3 }]);
  });

  it('同一 action 重复 cue 先赢；breathMs clamp 到 2500', () => {
    const raw = JSON.stringify({
      segments: [
        { segment: 0, cues: [{ actionIndex: 0, charIndex: 2 }, { actionIndex: 0, charIndex: 8 }], breathMs: 9999 },
      ],
    });
    const result = parseDirectorResponse(raw, page);
    expect(result.get(0)?.cues).toEqual([{ actionIndex: 0, charIndex: 2 }]);
    expect(result.get(0)?.breathMs).toBe(2500);
  });

  it('不可解析 → 空 Map（调用方保留原脚本）', () => {
    expect(parseDirectorResponse('这不是 JSON', page).size).toBe(0);
    expect(parseDirectorResponse('{"segments":"oops"}', page).size).toBe(0);
  });

  it('无 cue 无 breath 的 segment 不进 Map', () => {
    const raw = JSON.stringify({ segments: [{ segment: 0, cues: [] }] });
    expect(parseDirectorResponse(raw, page).size).toBe(0);
  });
});
