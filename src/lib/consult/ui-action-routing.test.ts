import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { buildLatestUiActionBlock, extractLatestUiAction } from './ui-action-routing';

describe('extractLatestUiAction', () => {
  it('picks the newest completed outreach action from UI messages', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showOutreachWorkspace',
            state: 'output-available',
            output: { actionId: 'draft-from-plan', label: '按这个策略写草稿' },
          },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showOutreachWorkspace',
            state: 'output-available',
            output: {
              actionId: 'search-specific-paper',
              label: '再搜一次具体论文',
              advisorName: 'Percy Liang',
              confidence: 'medium',
              nextMove: '先补一条官方或论文来源。',
            },
          },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUiAction(messages)).toEqual({
      toolName: 'showOutreachWorkspace',
      actionId: 'search-specific-paper',
      label: '再搜一次具体论文',
      advisorName: 'Percy Liang',
      confidence: 'medium',
      nextMove: '先补一条官方或论文来源。',
    });
  });

  it('ignores pending tool calls and non-action outputs', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'tool-showOutreachWorkspace', state: 'input-available', input: {} },
          { type: 'tool-askOptions', state: 'output-available', output: { selected: ['a'] } },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUiAction(messages)).toBeNull();
  });
});

describe('buildLatestUiActionBlock', () => {
  it('turns search actions into explicit webSearch routing guidance', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showOutreachWorkspace',
      actionId: 'search-specific-paper',
      label: '再搜一次具体论文',
      advisorName: 'Percy Liang',
      nextMove: '先补一条官方或论文来源。',
    });

    expect(block).toContain('Percy Liang');
    expect(block).toContain('webSearch');
    expect(block).toContain('不要像重新进入一个 workflow');
  });

  it('routes advisor discovery actions toward search before cold-email drafting', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showDraft',
      actionId: 'find-advisors-from-cv',
      label: '用这些亮点找导师',
    });

    expect(block).toContain('webSearch');
    expect(block).toContain('不要直接切到套磁草稿');
  });

  it('routes explicit cold-email drafting actions toward the cold-email skill', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showDraft',
      actionId: 'draft-cold-email-from-cv',
      label: '拿亮点写套磁',
      intent: 'draft',
    });

    expect(block).toContain('cold-email-draft');
    expect(block).toContain('不要重新问一遍背景');
  });

  it('routes interview actions toward the mock interview skill', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showServicePlan',
      actionId: 'practice-interview',
      label: '练一次模拟面试',
      intent: 'voice',
    });

    expect(block).toContain('mock-interview');
    expect(block).toContain('startVoiceCall');
  });

  it('routes application material actions toward the materials skill', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showServicePlan',
      actionId: 'draft-research-statement',
      label: '起草研究陈述',
      intent: 'draft',
    });

    expect(block).toContain('application-materials');
    expect(block).toContain('statement-draft');
    expect(block).toContain('不要直接写泛文书');
  });

  it('routes program shortlist actions toward official program search', () => {
    const block = buildLatestUiActionBlock({
      toolName: 'showServicePlan',
      actionId: 'build-program-shortlist',
      label: '生成项目短名单',
      intent: 'route',
    });

    expect(block).toContain('school-program-shortlist');
    expect(block).toContain('searchProgramRequirements');
    expect(block).toContain('官方来源');
  });

  it('extracts artifact context from a CV diagnosis action', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showDraft',
            state: 'output-available',
            input: {
              kind: 'cv-diagnosis',
              title: '你的 CV 诊断（针对 NLP PhD）',
              body: [
                '## 匹配度评分',
                '',
                '总分：3.8 / 5.0',
                '',
                '## 3 个亮点',
                '',
                '1. **统计建模大赛国家级三等奖** — 能证明建模能力。',
                '',
                '## 3 个硬伤',
                '',
                '1. **暂无论文产出** — 对 PhD 申请影响较大。',
                '',
                '## 最短改进路径（接下来 4 周）',
                '',
                '- 第 1 周：把统计建模项目整理成技术报告。',
              ].join('\n'),
              actions: [
                { id: 'find-advisors-from-cv', label: '用这些亮点找导师', intent: 'search' },
              ],
            },
            output: { actionId: 'find-advisors-from-cv' },
          },
        ],
      },
    ] as UIMessage[];

    const action = extractLatestUiAction(messages);
    expect(action).toMatchObject({
      toolName: 'showDraft',
      actionId: 'find-advisors-from-cv',
      label: '用这些亮点找导师',
      intent: 'search',
      artifactKind: 'cv-diagnosis',
      artifactTitle: '你的 CV 诊断（针对 NLP PhD）',
    });
    expect(action?.context?.join('\n')).toContain('CV 当前匹配度：3.8/5.0');

    const block = buildLatestUiActionBlock(action);
    expect(block).toContain('当前 UI 状态');
    expect(block).toContain('不要像重新进入一个 workflow');
    expect(block).toContain('不要再次输出 `showDraft(kind:"cv-diagnosis")`');
  });

  it('extracts service plan context so actions continue from the board state', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showServicePlan',
            state: 'output-available',
            input: {
              phase: 'pre-service',
              title: '2027 秋季 NLP 申请准备方案',
              consultantRead: '学生目标跨度大，需要先收窄导师与研究主线。',
              objective: '先锁定导师探索与材料补强两个动作。',
              modules: [
                { id: 'advisor', label: '导师匹配', status: 'in-progress', value: '先扩展短名单' },
                { id: 'cv', label: 'CV 优化', status: 'ready', value: '重写科研经历' },
              ],
              actions: [{ id: 'expand-advisors', label: '扩展导师短名单', intent: 'search' }],
            },
            output: { actionId: 'expand-advisors' },
          },
        ],
      },
    ] as UIMessage[];

    const action = extractLatestUiAction(messages);
    expect(action?.context?.join('\n')).toContain('本轮目标：先锁定导师探索与材料补强两个动作。');
    expect(action?.context?.join('\n')).toContain('当前模块：导师匹配/in-progress、CV 优化/ready');
  });

  it('extracts consultant move actions with their intent', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showConsultantMove',
            state: 'output-available',
            output: {
              actionId: 'voice-cv-strategy',
              label: '语音聊定位',
              intent: 'voice',
            },
          },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUiAction(messages)).toEqual({
      toolName: 'showConsultantMove',
      actionId: 'voice-cv-strategy',
      label: '语音聊定位',
      intent: 'voice',
    });
  });

  it('extracts service plan actions and keeps intent for routing', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showServicePlan',
            state: 'output-available',
            output: {
              actionId: 'draft-first-email',
              label: '起草第一封邮件',
              intent: 'draft',
            },
          },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUiAction(messages)).toEqual({
      toolName: 'showServicePlan',
      actionId: 'draft-first-email',
      label: '起草第一封邮件',
      intent: 'draft',
    });
  });

  it('extracts advisor discovery shortlist actions', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-showAdvisorDiscovery',
            state: 'output-available',
            output: {
              actionId: 'shortlist-percy',
              label: '先保留 Percy',
              intent: 'shortlist',
            },
          },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUiAction(messages)).toEqual({
      toolName: 'showAdvisorDiscovery',
      actionId: 'shortlist-percy',
      label: '先保留 Percy',
      intent: 'shortlist',
    });
  });
});
