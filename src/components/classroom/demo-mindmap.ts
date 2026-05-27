import type { MindMapTree } from '@/hooks/useClassroomMindMap';

const ROOT_ID = 'demo-root';

const DEMO_NODES = [
  {
    id: ROOT_ID,
    parentId: null,
    label: "Australia's Moving Experience",
    detail: '这段试听课围绕一次搬家咨询展开。',
    anchorMs: 0,
    revealAtSec: 6,
  },
  {
    id: 'demo-branch-opening',
    parentId: ROOT_ID,
    label: '开场接待',
    detail: '搬家公司接起电话，确认来意。',
    anchorMs: 0,
    revealAtSec: 6,
  },
  {
    id: 'demo-leaf-opening-help',
    parentId: 'demo-branch-opening',
    label: 'How can I help you? 是服务场景里的开场句',
    anchorMs: 0,
    revealAtSec: 6,
  },
  {
    id: 'demo-branch-state',
    parentId: ROOT_ID,
    label: '状态表达',
    detail: 'Jane 说自己现在很没底。',
    anchorMs: 6000,
    revealAtSec: 11,
  },
  {
    id: 'demo-leaf-up-in-air',
    parentId: 'demo-branch-state',
    label: 'up in the air = 事情还没定、心里没底',
    anchorMs: 6000,
    revealAtSec: 11,
  },
  {
    id: 'demo-branch-moving',
    parentId: ROOT_ID,
    label: '搬家背景',
    detail: '她下个月要搬去美国。',
    anchorMs: 17000,
    revealAtSec: 25,
  },
  {
    id: 'demo-leaf-relocating',
    parentId: 'demo-branch-moving',
    label: 'relocating 指搬迁、迁居，不只是 moving house',
    anchorMs: 17000,
    revealAtSec: 25,
  },
  {
    id: 'demo-branch-rule',
    parentId: ROOT_ID,
    label: '听力规则',
    detail: '题目要边听边做，不会放第二遍。',
    anchorMs: 42000,
    revealAtSec: 50,
  },
  {
    id: 'demo-leaf-second-time',
    parentId: 'demo-branch-rule',
    label: 'not hear the recording a second time 是做题策略提醒',
    anchorMs: 42000,
    revealAtSec: 50,
  },
  {
    id: 'demo-branch-form',
    parentId: ROOT_ID,
    label: '填表信息',
    detail: '开始收集姓名、地址、电话等表格信息。',
    anchorMs: 80000,
    revealAtSec: 88,
  },
  {
    id: 'demo-leaf-name',
    parentId: 'demo-branch-form',
    label: 'Jane Bond 是示例里已经填好的姓名',
    anchorMs: 85000,
    revealAtSec: 88,
  },
] as const;

export function buildDemoMindMapTree(seconds: number): { tree: MindMapTree; newNodeIds: Set<string> } {
  const visible = DEMO_NODES.filter((node) => seconds >= node.revealAtSec);
  if (visible.length === 0) return { tree: { title: '', nodes: [] }, newNodeIds: new Set() };

  const newestReveal = Math.max(...visible.map((node) => node.revealAtSec));
  return {
    tree: {
      title: "Australia's Moving Experience",
      nodes: visible.map(({ revealAtSec: _revealAtSec, ...node }) => node),
    },
    newNodeIds: new Set(visible.filter((node) => node.revealAtSec === newestReveal).map((node) => node.id)),
  };
}
