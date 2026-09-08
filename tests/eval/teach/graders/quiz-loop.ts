// quiz-loop grader —— 出题闭环结构断言（基于生产引擎事件流，非文本正则）。
// 断言：出题轮有 quiz_qN 锚点落板 + discussion 暂停在最后一个出题动作之后；
// 判分轮有讲评落板且引用 quiz_qN 锚点；每轮输出闭合、无越表动作。
import type { TeachCaseExpect, TurnCapture, TurnEvent } from '../runner';
import type { GradeResult } from './grading-accuracy';

const QUIZ_ID_RE = /^quiz_q\d+$/;
const QUIZ_ID_REF_RE = /quiz_q\d+/;
const DRAW_ACTIONS = new Set(['wb_draw_text', 'wb_draw_latex']);

function toolCalls(turn: TurnCapture): TurnEvent[] {
  return turn.events.filter((e) => e.kind === 'tool-call');
}

/** 出题轮里带 quiz_qN 锚点的落板动作（按事件顺序）。 */
function quizDraws(turn: TurnCapture): TurnEvent[] {
  return toolCalls(turn).filter(
    (e) =>
      DRAW_ACTIONS.has(e.name ?? '') &&
      typeof e.args?.elementId === 'string' &&
      QUIZ_ID_RE.test(e.args.elementId as string),
  );
}

export function gradeQuizLoop(turns: TurnCapture[], expect: TeachCaseExpect): GradeResult {
  const failures: string[] = [];
  let checks = 0;
  let passed = 0;
  const check = (ok: boolean, failMsg: string) => {
    checks++;
    if (ok) passed++;
    else failures.push(failMsg);
  };

  // 每轮：输出闭合 + 无越表动作
  turns.forEach((t, i) => {
    check(t.summary.closed, `第 ${i + 1} 轮输出未闭合（closed=false）`);
    check(
      t.summary.unknownActions.length === 0,
      `第 ${i + 1} 轮出现越表动作：${t.summary.unknownActions.join(', ')}`,
    );
  });

  // 出题轮（第一轮）：quiz_qN 锚点落板，覆盖 expect.quizElementIds
  const quizTurn = turns[0];
  const draws = quizDraws(quizTurn);
  check(draws.length >= 1, '出题轮没有带 quiz_qN 锚点的 wb_draw_text/wb_draw_latex');
  const covered = new Set(draws.map((d) => d.args!.elementId as string));
  for (const id of expect.quizElementIds) {
    check(covered.has(id), `出题轮缺少锚点 ${id}`);
  }

  // discussion 暂停出现在最后一个出题动作之后
  if (expect.requireDiscussionPause) {
    const events = quizTurn.events;
    let lastDrawIdx = -1;
    events.forEach((e, i) => {
      if (
        e.kind === 'tool-call' &&
        DRAW_ACTIONS.has(e.name ?? '') &&
        typeof e.args?.elementId === 'string' &&
        QUIZ_ID_RE.test(e.args.elementId as string)
      ) {
        lastDrawIdx = i;
      }
    });
    const discussionIdx = events.findIndex(
      (e, i) => i > lastDrawIdx && e.kind === 'tool-call' && e.name === 'discussion',
    );
    check(
      lastDrawIdx >= 0 && discussionIdx > lastDrawIdx,
      '出题轮缺少 discussion 暂停（或出现在最后一个出题动作之前）',
    );
  }

  // 判分轮（最后一轮）：讲评落板 + 引用 quiz_qN 锚点
  const gradeTurn = turns[turns.length - 1];
  const gCalls = toolCalls(gradeTurn);
  check(
    gCalls.some((e) => e.name === 'wb_draw_text'),
    '判分轮没有 wb_draw_text 讲评落板',
  );
  check(
    gCalls.some((e) =>
      Object.values(e.args ?? {}).some(
        (v) => typeof v === 'string' && QUIZ_ID_REF_RE.test(v),
      ),
    ),
    '判分轮没有引用 quiz_qN 锚点（讲评与题目脱钩）',
  );

  const pass = failures.length === 0;
  return {
    pass,
    score: checks === 0 ? 1 : passed / checks,
    reason: pass ? '出题—暂停—判分—讲评闭环完整' : failures.join('；'),
  };
}
