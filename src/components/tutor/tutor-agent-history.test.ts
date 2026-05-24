import { describe, expect, it } from 'vitest';
import { conversationMessageToUIMessage, resolveTutorAgentHistoryLabel } from './tutor-agent-history';

describe('tutor agent history helpers', () => {
  it('converts stored conversation messages back to AI SDK UI messages', () => {
    expect(conversationMessageToUIMessage({
      messageId: 'm1',
      role: 'assistant',
      content: '可以，先看 [02:10] 这段。',
    })).toMatchObject({
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: '可以，先看 [02:10] 这段。' }],
    });
  });

  it('makes selected history feel explicitly resumed instead of silently replacing the chat', () => {
    expect(resolveTutorAgentHistoryLabel({ hydrated: false })).toBe('正在接回上一轮对话…');
    expect(resolveTutorAgentHistoryLabel({ hydrated: true, title: '极限与连续' })).toBe('已接回：极限与连续');
    expect(resolveTutorAgentHistoryLabel({ hydrated: true, title: '极限与连续', selected: true })).toBe('正在查看：极限与连续');
    expect(resolveTutorAgentHistoryLabel({ hydrated: true })).toBe('新对话');
  });
});
