import { describe, expect, it } from 'vitest';
import { evaluateConsultExperienceTrace, type ExperienceTrace } from './ux-replay';

const USER_GOAL = '我现在没有明确目标。我本科统计，硕士做过大模型文本检测和数据治理，也有一个国家级统计建模比赛奖项，但不知道应该申硕、申博、找导师还是先补论文。';

describe('evaluateConsultExperienceTrace', () => {
  it('catches the exact UX failures found by the simulated background-only replay', () => {
    const trace: ExperienceTrace = {
      id: 'background-only-bad',
      title: '背景-only 首轮等待和点击闭环',
      userGoal: USER_GOAL,
      events: [
        { tMs: 0, type: 'user-input', label: 'student sends background', text: USER_GOAL },
        { tMs: 15000, type: 'wait', label: 'still waiting' },
        { tMs: 90000, type: 'click', label: 'student clicks positioning' },
      ],
      frames: [
        {
          tMs: 15000,
          label: 'waiting',
          text: [
            '推进中',
            '理解中',
            '正在接住你的问题',
            '画像 · 已读取',
            '判断已接上',
            '工作摘要',
            '已处理',
            '读取你的画像',
            '详情',
          ].join('\n'),
          cardCount: 3,
          actionCount: 1,
        },
        {
          tMs: 95000,
          label: 'after click',
          text: [
            '顾问判断',
            '你不是缺经历，是缺一条申请主线',
            '已选择：先做申请定位',
            '顾问判断',
            '你不是缺经历，是缺一条申请主线',
            '我在判断',
            '正在判断你的真实意图',
            '先定申硕还是申博',
            '评估背景竞争力',
            '规划时间线和补强',
          ].join('\n'),
          cardCount: 2,
          actionCount: 3,
        },
      ],
    };

    const score = evaluateConsultExperienceTrace(trace);

    expect(score.status).toBe('failed');
    expect(score.criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.id)).toEqual(
      expect.arrayContaining([
        'waiting-state-quality',
        'no-stale-streaming-ui',
        'no-internal-noise',
        'no-duplicate-judgment-card',
      ]),
    );
  });

  it('passes a cleaned trace with one current focus and low internal noise', () => {
    const trace: ExperienceTrace = {
      id: 'background-only-clean',
      title: '背景-only 首轮顾问接待',
      userGoal: USER_GOAL,
      events: [
        { tMs: 0, type: 'user-input', label: 'student sends background', text: USER_GOAL },
        { tMs: 70000, type: 'agent-output', label: 'consultant move shown' },
      ],
      frames: [
        {
          tMs: 70000,
          label: 'final',
          text: [
            '顾问判断',
            '你不是缺经历，是缺一条申请主线',
            '你有统计本科 + 大模型项目 + 国家级奖项，硬件不差；但你现在卡在该往哪个方向用力。',
            '下一步动作',
            '先把你的背景和目标档次对齐，再决定是走 Master 路线还是 PhD 路线。',
            '先做申请定位',
            '先评估 CV 竞争力',
            '看看几条可能路径',
            '我不确定，你建议',
          ].join('\n'),
          cardCount: 1,
          actionCount: 4,
        },
      ],
    };

    const score = evaluateConsultExperienceTrace(trace);

    expect(score.status).toBe('passed');
    expect(score.score).toBe(score.maxScore);
  });
});
