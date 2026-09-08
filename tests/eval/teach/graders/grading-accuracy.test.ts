// grading-accuracy grader 单测：判定词提取的优先级 / 去重 / 补齐语义，
// 以及 grader 逐题比对（负例验证区分度——dataset 正例由 dry-run runner 兜底）。
import { describe, expect, it } from 'vitest';
import {
  gradeGradingAccuracy,
  parseVerdicts,
  scanVerdicts,
} from './grading-accuracy';
import type { TurnCapture } from '../runner';

describe('parseVerdicts', () => {
  it('「不对」不误判 correct', () => {
    expect(parseVerdicts('这题不对，再想想。', 1)).toEqual(['wrong']);
  });

  it('「不正确」不被「正确」抢判（wrong 先匹配，重叠区间去重）', () => {
    expect(parseVerdicts('你的回答不正确。', 1)).toEqual(['wrong']);
  });

  it('「部分正确」判 partial', () => {
    expect(parseVerdicts('这道题部分正确，思路对了一半。', 1)).toEqual(['partial']);
  });

  it('「只对了一半」判 partial', () => {
    expect(parseVerdicts('答案对但过程缺失，只说对了一半。', 1)).toEqual(['partial']);
  });

  it('两题顺序提取：先对后错', () => {
    expect(
      parseVerdicts('第一题答对了，过程也写得很规范；第二题不对，错在通分。', 2),
    ).toEqual(['correct', 'wrong']);
  });

  it('两题顺序提取：先错后对', () => {
    expect(
      parseVerdicts('第一题答错了，错因是漏了负号；第二题答对了，✓。', 2),
    ).toEqual(['wrong', 'correct']);
  });

  it('缺判定按 wrong 补齐（没判 = 门禁不认）', () => {
    expect(parseVerdicts('嗯，我们再看看。', 2)).toEqual(['wrong', 'wrong']);
  });

  it('只判了一题时第二题补 wrong', () => {
    expect(parseVerdicts('第一题答对了。', 2)).toEqual(['correct', 'wrong']);
  });

  it('变体：「答错了」/「✗」判 wrong，「√」判 correct', () => {
    expect(parseVerdicts('很遗憾答错了。', 1)).toEqual(['wrong']);
    expect(parseVerdicts('quiz_q1 ✗ 91 是合数。', 1)).toEqual(['wrong']);
    expect(parseVerdicts('quiz_q1 √ 7 是质数。', 1)).toEqual(['correct']);
  });

  it('同题判定词近距离重复去重（答对了 ✓ 只算一题）', () => {
    expect(scanVerdicts('答对了 ✓，很漂亮。')).toEqual(['correct']);
  });

  it('符号与文字混排按出现顺序', () => {
    expect(scanVerdicts('✓ 第一题过；第二题错误，位数数错。')).toEqual(['correct', 'wrong']);
  });
});

function mkGradingTurn(speech: string, board: string[]): TurnCapture {
  return {
    events: board.map((content) => ({
      kind: 'tool-call' as const,
      name: 'wb_draw_text',
      args: { content, x: 0, y: 0 },
    })),
    speechText: speech,
    summary: { closed: true, unknownActions: [], executedActions: board.length, speechSegments: 1 },
  };
}

describe('gradeGradingAccuracy', () => {
  it('全对：pass 且 score=1', () => {
    const turns = [mkGradingTurn('答对了！', ['quiz_q1 ✓ 答对'])];
    const r = gradeGradingAccuracy(turns, {
      quizElementIds: ['quiz_q1'],
      verdicts: ['correct'],
    });
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it('没判分（期望答对但只嗯嗯）：fail，缺判定按 wrong 计', () => {
    const turns = [mkGradingTurn('嗯嗯说得不错。', [])];
    const r = gradeGradingAccuracy(turns, {
      quizElementIds: ['quiz_q1'],
      verdicts: ['correct'],
    });
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reason).toContain('缺失按 wrong 计');
  });

  it('判错说成答对：fail（负例区分度）', () => {
    const turns = [mkGradingTurn('答对了，很好。', ['quiz_q1 ✓ 答对'])];
    const r = gradeGradingAccuracy(turns, {
      quizElementIds: ['quiz_q1'],
      verdicts: ['wrong'],
    });
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });

  it('两题一对一错：逐题比对，顺序错位算 fail', () => {
    const ok = gradeGradingAccuracy(
      [mkGradingTurn('第一题答对了，第二题这一步不对，错在进位。', [])],
      { quizElementIds: ['quiz_q1', 'quiz_q2'], verdicts: ['correct', 'wrong'] },
    );
    expect(ok.pass).toBe(true);

    const swapped = gradeGradingAccuracy(
      [mkGradingTurn('第一题答对了，第二题这一步不对，错在进位。', [])],
      { quizElementIds: ['quiz_q1', 'quiz_q2'], verdicts: ['wrong', 'correct'] },
    );
    expect(swapped.pass).toBe(false);
    expect(swapped.score).toBe(0);
  });

  it('部分对三态：partial 不被 correct/wrong 吸收', () => {
    const r = gradeGradingAccuracy(
      [mkGradingTurn('答案算得对，依据没说清，判部分对。', ['quiz_q1 ◐ 部分对'])],
      { quizElementIds: ['quiz_q1'], verdicts: ['partial'] },
    );
    expect(r.pass).toBe(true);
  });
});
