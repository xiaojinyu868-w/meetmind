// quiz-loop grader 单测：闭环结构断言的正例 + 各失败路径（负例验证区分度）。
import { describe, expect, it } from 'vitest';
import { gradeQuizLoop } from './quiz-loop';
import type { TurnCapture, TurnEvent } from '../runner';

function call(name: string, args: Record<string, unknown>): TurnEvent {
  return { kind: 'tool-call', name, args };
}

function mkTurn(events: TurnEvent[], closed = true, unknownActions: string[] = []): TurnCapture {
  return {
    events,
    speechText: '',
    summary: { closed, unknownActions, executedActions: 0, speechSegments: 0 },
  };
}

const GOOD_QUIZ_TURN = mkTurn([
  call('wb_open', {}),
  call('wb_draw_text', { content: '第 1 题', x: 40, y: 60, elementId: 'quiz_q1' }),
  call('discussion', { topic: '想一想' }),
]);

const GOOD_GRADING_TURN = mkTurn([
  call('wb_draw_text', { content: 'quiz_q1 ✓ 答对', x: 40, y: 120, elementId: 'quiz_q1_note' }),
  call('spotlight', { elementId: 'quiz_q1' }),
]);

const EXPECT = {
  quizElementIds: ['quiz_q1'],
  verdicts: ['correct' as const],
  requireDiscussionPause: true,
};

describe('gradeQuizLoop', () => {
  it('完整闭环：pass', () => {
    const r = gradeQuizLoop([GOOD_QUIZ_TURN, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it('缺 discussion 暂停：fail', () => {
    const noDiscussion = mkTurn([
      call('wb_draw_text', { content: '第 1 题', x: 40, y: 60, elementId: 'quiz_q1' }),
    ]);
    const r = gradeQuizLoop([noDiscussion, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('discussion');
  });

  it('discussion 在出题动作之前：fail', () => {
    const early = mkTurn([
      call('discussion', { topic: '先聊' }),
      call('wb_draw_text', { content: '第 1 题', x: 40, y: 60, elementId: 'quiz_q1' }),
    ]);
    const r = gradeQuizLoop([early, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(false);
  });

  it('出题不带 quiz_qN 锚点（系统分配 a_N）：fail', () => {
    const noAnchor = mkTurn([
      call('wb_draw_text', { content: '第 1 题', x: 40, y: 60, elementId: 'a_1' }),
      call('discussion', { topic: '想一想' }),
    ]);
    const r = gradeQuizLoop([noAnchor, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('锚点');
  });

  it('判分轮不引用 quiz_qN（讲评与题目脱钩）：fail', () => {
    const noRef = mkTurn([
      call('wb_draw_text', { content: '答对了，很好', x: 40, y: 120, elementId: 'a_2' }),
    ]);
    const r = gradeQuizLoop([GOOD_QUIZ_TURN, noRef], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('quiz_qN');
  });

  it('判分轮没有讲评落板：fail', () => {
    const noBoard = mkTurn([call('spotlight', { elementId: 'quiz_q1' })]);
    const r = gradeQuizLoop([GOOD_QUIZ_TURN, noBoard], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('讲评落板');
  });

  it('输出截断（closed=false）：fail', () => {
    const truncated = mkTurn(GOOD_QUIZ_TURN.events, false);
    const r = gradeQuizLoop([truncated, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('未闭合');
  });

  it('越表动作（unknownActions 非空）：fail', () => {
    const rogue = mkTurn(GOOD_QUIZ_TURN.events, true, ['wb_draw_chart']);
    const r = gradeQuizLoop([rogue, GOOD_GRADING_TURN], EXPECT);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('越表');
  });

  it('expect.quizElementIds 覆盖：缺 quiz_q2 时 fail', () => {
    const r = gradeQuizLoop([GOOD_QUIZ_TURN, GOOD_GRADING_TURN], {
      ...EXPECT,
      quizElementIds: ['quiz_q1', 'quiz_q2'],
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('quiz_q2');
  });

  it('laser 引用锚点也算讲评挂钩', () => {
    const laserRef = mkTurn([
      call('wb_draw_text', { content: '讲评见板上', x: 40, y: 120, elementId: 'quiz_q1_note' }),
      call('laser', { elementId: 'quiz_q1' }),
    ]);
    const r = gradeQuizLoop([GOOD_QUIZ_TURN, laserRef], EXPECT);
    expect(r.pass).toBe(true);
  });
});
