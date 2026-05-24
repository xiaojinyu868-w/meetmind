import { describe, expect, it } from 'vitest';
import {
  buildFlashcardsTrialShareFileName,
  buildFlashcardsTrialShareText,
} from './flashcards-share-actions';

const cards = [
  {
    id: 'guest-demo-card-1',
    front: '“up in the air” 在这段对话里表达什么状态？',
    back: '表示事情还没有确定、心里没底。',
  },
  {
    id: 'guest-demo-card-2',
    front: 'Jane Bond 为什么联系 Australia’s Moving Experience？',
    back: '她下个月要搬去美国。',
  },
  {
    id: 'guest-demo-card-3',
    front: '听力开始前，旁白提醒学生要注意什么？',
    back: '要边听边答题。',
  },
];

describe('flashcards share actions', () => {
  it('builds a trial share text that can travel outside the product', () => {
    const text = buildFlashcardsTrialShareText(cards, { gotCount: 2, total: 3 });

    expect(text).toContain('MeetMind');
    expect(text).toContain('3 张闪卡');
    expect(text).toContain('正确率：67%');
    expect(text).toContain('up in the air');
    expect(text).toContain('Jane Bond');
    expect(text).not.toMatch(/回声卡|酿|工坊|研判|引擎/);
  });

  it('limits shared questions so the outbound text stays compact', () => {
    const text = buildFlashcardsTrialShareText([...cards, ...cards], { gotCount: 4, total: 6 });

    expect(text).toContain('1. “up in the air”');
    expect(text).toContain('3. 听力开始前');
    expect(text).not.toContain('4.');
  });

  it('builds a safe png filename for the trial result', () => {
    expect(buildFlashcardsTrialShareFileName(new Date('2026-05-21T08:00:00.000Z'))).toBe(
      'MeetMind-试听课闪卡-2026-05-21.png',
    );
  });
});
