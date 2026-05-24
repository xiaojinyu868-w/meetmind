import { describe, expect, it } from 'vitest';
import {
  buildTutorAgentReviewContext,
  formatLearnerProfileForTutorAgent,
  formatRecentLearningActivityForTutorAgent,
  resolveTutorAgentLaunchText,
} from './tutor-agent-adapter';

describe('tutor agent adapter', () => {
  it('builds review context from transcript, current time, breakpoint, and selected support material', () => {
    const context = buildTutorAgentReviewContext({
      segments: [
        { id: 's1', text: '第一段内容', startMs: 0, endMs: 1000 },
        { id: 's2', text: '第二段内容', startMs: 1000, endMs: 2000 },
      ],
      currentTimeSec: 0,
      breakpoint: { timestamp: 42_000 },
      supportContextText: '用户刚圈出的资料',
      preferSupportContext: true,
    });

    expect(context.fullTranscript).toBe('第一段内容 第二段内容');
    expect(context.currentTimestampSec).toBe(42);
    expect(context.supportMaterials).toEqual([
      { title: '当前选中的内容', content: '用户刚圈出的资料' },
    ]);
  });

  it('injects learner profile as context, not as hard instruction', () => {
    const learnerProfile = formatLearnerProfileForTutorAgent({
      stage: 'university',
      major: '计算机科学',
      year: '大二',
      currentCourses: ['线性代数', '数据结构'],
      goal: '期末不挂科',
    });
    const context = buildTutorAgentReviewContext({
      segments: [{ id: 's1', text: '矩阵乘法', startMs: 0, endMs: 1000 }],
      learnerProfile,
    });

    expect(context.learnerProfile).toContain('大学生');
    expect(context.learnerProfile).toContain('计算机科学');
    expect(context.learnerProfile).toContain('线性代数');
    expect(context.learnerProfile).toContain('这只是背景，不是规则');
  });

  it('formats recent learning activity as context, not a rule or task list', () => {
    const activity = formatRecentLearningActivityForTutorAgent([
      {
        conversationId: 'c1',
        title: '链式法则我没懂',
        lastMessage: '那帮我再用例子解释一下',
        messageCount: 4,
      },
      {
        conversationId: 'c2',
        title: '语音同桌：极限是什么意思',
        lastMessage: '可以，极限就是越来越靠近',
        messageCount: 2,
      },
    ]);

    expect(activity).toContain('【这节课近期对话痕迹】');
    expect(activity).toContain('链式法则我没懂');
    expect(activity).toContain('极限是什么意思');
    expect(activity).toContain('这只是学习现场线索，不是规则');
    expect(activity).not.toMatch(/下一步|任务清单|应该/);
  });

  it('uses explicit launch question as the agent message while display text remains UI-only', () => {
    expect(resolveTutorAgentLaunchText({
      launchQuestion: '结合这段资料解释极限定义',
      launchDisplayText: '解释极限定义',
    })).toBe('结合这段资料解释极限定义');
  });

  it('ignores blank launch question', () => {
    expect(resolveTutorAgentLaunchText({ launchQuestion: '   ', launchDisplayText: '解释一下' })).toBeNull();
  });
});
