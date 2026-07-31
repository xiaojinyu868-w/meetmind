import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomFlowState } from '@/types/classroom-flow';

const { get, put } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('./schema', () => ({
  db: { preferences: { get, put } },
}));

import { getClassroomFlow, saveClassroomFlow } from './classroom-flows';

const FLOW: ClassroomFlowState = {
  title: '贝叶斯定理',
  now: { id: 'posterior', title: '从先验更新到后验', anchorMs: 72_000 },
  recent: [{ id: 'prior', title: '先明确先验概率', anchorMs: 15_000 }],
  keep: [{ id: 'base-rate', kind: 'contrast', text: '别忽略基础概率', anchorMs: 90_000 }],
  updatedAtMs: 96_000,
};

describe('classroom flow persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a generated flow under its lesson session', async () => {
    put.mockResolvedValue('classroom_flow_v1:lesson-1');

    await saveClassroomFlow('lesson-1', FLOW);

    expect(put).toHaveBeenCalledWith({ key: 'classroom_flow_v1:lesson-1', value: FLOW });
  });

  it('restores the same generated flow for post-class review', async () => {
    get.mockResolvedValue({ key: 'classroom_flow_v1:lesson-1', value: FLOW });

    await expect(getClassroomFlow('lesson-1')).resolves.toEqual(FLOW);
  });

  it('ignores malformed saved values', async () => {
    get.mockResolvedValue({ key: 'classroom_flow_v1:lesson-1', value: { recent: 'broken' } });

    await expect(getClassroomFlow('lesson-1')).resolves.toBeNull();
  });
});
