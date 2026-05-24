import { describe, expect, it } from 'vitest';
import { buildInClassTutorAgentBody } from './classroom-agent-request';

describe('buildInClassTutorAgentBody', () => {
  it('sends only recent focus to the tutor agent and does not upload full transcript on every in-class question', () => {
    const segments = Array.from({ length: 80 }, (_, index) => ({
      id: `s-${index}`,
      text: index === 0 ? '很早之前讲的内容，不应该随每次提问上传' : `课堂片段 ${index}`,
      startMs: index * 5_000,
      endMs: index * 5_000 + 4_000,
    }));

    const body = buildInClassTutorAgentBody({
      messages: [{ id: 'u-1', role: 'user', parts: [{ type: 'text', text: '刚才这个是什么意思？' }] }],
      sessionId: 'session-1',
      segments,
    });

    expect(body.mode).toBe('in-class');
    expect(body.transcript).toEqual([]);
    expect(body.context.recentFocus).toContain('课堂片段 79');
    expect(body.context.recentFocus).not.toContain('很早之前讲的内容');
    expect(body.options).toEqual({
      allowInlineApp: true,
      returnTimestamps: false,
      thinkingGuide: false,
    });
  });

  it('includes the selected model when the user picked one in settings', () => {
    const body = buildInClassTutorAgentBody({
      messages: [{ id: 'u-1', role: 'user', parts: [{ type: 'text', text: '帮我整理一下' }] }],
      sessionId: 'session-1',
      segments: [],
      model: 'deepseek-v4-pro',
    });

    expect(body.model).toBe('deepseek-v4-pro');
  });
});
