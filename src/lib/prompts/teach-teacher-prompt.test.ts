import { describe, expect, it } from 'vitest';
import { buildTeachBaseInstructions, buildTeachEngineInstructions, buildTeachLearnerSection } from './teach-teacher-prompt';

describe('teach 老师 prompt 的「关于这位学生」段（LearnerContext 读槽）', () => {
  const facts = '还没稳：一元二次方程判别式（quiz✕）\n已经稳了：因式分解';

  it('两条线都在课题之后拼同一段，只陈述不判断', () => {
    for (const prompt of [buildTeachBaseInstructions('一元二次方程', facts), buildTeachEngineInstructions('一元二次方程', '', facts)]) {
      expect(prompt.indexOf('这节课的课题是：一元二次方程')).toBeLessThan(prompt.indexOf('# 关于这位学生'));
      expect(prompt).toContain('还没稳：一元二次方程判别式（quiz✕）');
      expect(prompt).toContain('他没问起就不要主动报这份清单');
    }
  });

  it('没有切片时一字不加（旧线程 learnerJson 为 null）', () => {
    expect(buildTeachLearnerSection(undefined)).toBe('');
    expect(buildTeachBaseInstructions('一元二次方程')).not.toContain('关于这位学生');
    expect(buildTeachEngineInstructions('一元二次方程', '')).not.toContain('关于这位学生');
  });
});
