import { describe, expect, it } from 'vitest';
import { createRealtimeTranscriptDedupe, buildRealtimeConversationTitle } from './realtime-conversation-bridge';

describe('realtime conversation bridge', () => {
  it('accepts the first final transcript and rejects the same role/text flush duplicate', () => {
    const dedupe = createRealtimeTranscriptDedupe();

    expect(dedupe.shouldAccept('assistant', '这个地方可以这样理解')).toBe(true);
    expect(dedupe.shouldAccept('assistant', '  这个地方可以这样理解  ')).toBe(false);
  });

  it('keeps same text when role changes so user and assistant are not collapsed together', () => {
    const dedupe = createRealtimeTranscriptDedupe();

    expect(dedupe.shouldAccept('user', '极限是什么意思')).toBe(true);
    expect(dedupe.shouldAccept('assistant', '极限是什么意思')).toBe(true);
  });

  it('builds a useful voice conversation title from the first user utterance', () => {
    expect(buildRealtimeConversationTitle('老师刚才说的链式法则我没懂')).toBe('语音同桌：老师刚才说的链式法则我没懂');
  });
});
