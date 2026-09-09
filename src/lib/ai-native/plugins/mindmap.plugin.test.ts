import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { groundMindmapNodes } from './mindmap.plugin';

const transcript: TranscriptSegment[] = [
  { id: 's1', text: '供给增加会使均衡价格下降、均衡数量上升。', startMs: 0, endMs: 9_000, isFinal: true },
  { id: 's2', text: '需求增加会使均衡价格上升、均衡数量上升。', startMs: 10_000, endMs: 20_000, isFinal: true },
];

describe('groundMindmapNodes', () => {
  it('只标注不删节点：落地到原话的叶子带时间点，落地不到的保留结构但没有跳转（2026-09-09 起）', () => {
    const result = groundMindmapNodes([
      {
        title: '市场均衡变化',
        children: [
          { title: '供给增加使均衡价格下降' },
          { title: '量子纠缠允许超光速通信' },
        ],
      },
    ], transcript);

    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children?.[0].title).toContain('供给增加');
    expect(result[0].children?.[0].startMs).toBe(0);
    expect(result[0].children?.[1].startMs).toBeUndefined();
    // 分支本身借第一个落地到的孩子的时间点
    expect(result[0].startMs).toBe(0);
  });
});
