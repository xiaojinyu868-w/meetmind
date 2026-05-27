import { describe, expect, it } from 'vitest';
import { buildDemoMindMapTree } from './demo-mindmap';

describe('buildDemoMindMapTree', () => {
  it('starts empty before the first audible line', () => {
    expect(buildDemoMindMapTree(0).tree.nodes).toHaveLength(0);
  });

  it('grows the first branch once the demo audio starts', () => {
    const result = buildDemoMindMapTree(7);
    expect(result.tree.nodes.map((node) => node.id)).toContain('demo-root');
    expect(result.tree.nodes.map((node) => node.id)).toContain('demo-branch-opening');
  });

  it('has multiple branches by the end of the listening demo', () => {
    const result = buildDemoMindMapTree(93);
    const branches = result.tree.nodes.filter((node) => node.parentId === 'demo-root');
    expect(branches.length).toBeGreaterThanOrEqual(4);
  });
});
