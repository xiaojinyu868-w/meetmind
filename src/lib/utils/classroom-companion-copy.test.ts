import { describe, expect, it } from 'vitest';
import { IN_CLASS_PENDING_REPLY_LABEL } from './classroom-companion-copy';

describe('IN_CLASS_PENDING_REPLY_LABEL', () => {
  it('uses a state label instead of pretending to be answer content before the first model token', () => {
    expect(IN_CLASS_PENDING_REPLY_LABEL).toBe('正在回答');
    expect(IN_CLASS_PENDING_REPLY_LABEL).not.toContain('我先');
    expect(IN_CLASS_PENDING_REPLY_LABEL).not.toContain('刚才这段');
  });
});
