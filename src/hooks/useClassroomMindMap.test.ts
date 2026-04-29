import { describe, expect, it } from 'vitest';
import { reconcileMindMapTree } from './useClassroomMindMap';
import type { MindMapTree } from './useClassroomMindMap';

function tree(title: string, rootLabel: string, branches: string[]): MindMapTree {
  return {
    title,
    nodes: [
      { id: 'root', parentId: null, label: rootLabel, anchorMs: 0 },
      ...branches.map((label, index) => ({
        id: `b${index + 1}`,
        parentId: 'root',
        label,
        anchorMs: (index + 1) * 10_000,
      })),
    ],
  };
}

describe('reconcileMindMapTree', () => {
  it('uses a sharper incoming title to update an early wrong root label while preserving node ids', () => {
    const previous = tree('面试中 AI 能力的考察标准', '面试中 AI 能力的考察标准', ['岗位核心能力优先']);
    const incoming = tree('AI 产品经理的协作方法', '面试中 AI 能力的考察标准', ['why 的意义', '认知地图']);

    const result = reconcileMindMapTree(previous, incoming, 120_000);
    const root = result.nodes.find((node) => node.parentId === null);

    expect(root?.id).toBe('root');
    expect(root?.label).toBe('AI 产品经理的协作方法');
    expect(result.title).toBe('AI 产品经理的协作方法');
  });

  it('keeps a mature title stable when incoming title is empty or still identifying', () => {
    const previous = tree('AI 产品经理的协作方法', 'AI 产品经理的协作方法', ['why 的意义']);
    const incoming = tree('正在识别本段主题…', '正在识别本段主题…', []);

    const result = reconcileMindMapTree(previous, incoming, 420_000);
    const root = result.nodes.find((node) => node.parentId === null);

    expect(root?.label).toBe('AI 产品经理的协作方法');
    expect(result.title).toBe('AI 产品经理的协作方法');
  });
});
