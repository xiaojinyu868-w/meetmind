import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildCheatsheetSections } from './cheatsheet.plugin';

const transcript: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '注意，边际成本是额外生产一个单位所增加的成本，这是本节重点。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

describe('buildCheatsheetSections evidence grounding', () => {
  it('drops unsupported items instead of citing the nearest timestamp', () => {
    const sections = buildCheatsheetSections(transcript, {
      sections: [{
        key: 'definition',
        items: [
          { term: '机会成本', body: '放弃的最佳替代方案', startMs: 12_000 },
          { term: '量子纠缠', body: '允许信息超光速传递', startMs: 12_000 },
        ],
      }],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(1);
    expect(sections[0].items[0].term).toBe('机会成本');
    expect(sections[0].items[0].citation?.startMs).toBe(0);
  });

  it('only keeps strong emphasis when the supporting evidence explicitly signals it', () => {
    const sections = buildCheatsheetSections(transcript, {
      sections: [{
        key: 'definition',
        items: [
          { term: '机会成本', body: '放弃的最佳替代方案', emphasis: 'strong' },
          { term: '边际成本', body: '额外生产一单位增加的成本', emphasis: 'strong' },
        ],
      }],
    });

    expect(sections[0].items[0].emphasis).toBe('normal');
    expect(sections[0].items[1].emphasis).toBe('strong');
  });
});
