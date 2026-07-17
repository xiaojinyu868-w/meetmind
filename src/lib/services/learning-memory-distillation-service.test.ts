import { describe, expect, it } from 'vitest';
import {
  buildLearningMemoryDistillationPrompt,
  sanitizeDistilledLearningMemories,
} from './learning-memory-distillation-service';

describe('learning memory distillation', () => {
  it('keeps only supported learning understanding and valid replacements', () => {
    const memories = sanitizeDistilledLearningMemories({
      memories: [
        { kind: 'progress', title: ' 已经能区分相关与因果 ', detail: ' 能指出共同原因 ', replaceId: 'memory-1' },
        { kind: 'personality', title: '是一个很认真的人' },
        { kind: 'challenge', title: '仍会混淆中介变量和混杂变量', replaceId: 'missing' },
      ],
    }, [{ id: 'memory-1', kind: 'challenge', title: '还在区分相关与因果' }]);

    expect(memories).toEqual([
      {
        kind: 'progress',
        title: '已经能区分相关与因果',
        detail: '能指出共同原因',
        replaceId: 'memory-1',
      },
      {
        kind: 'challenge',
        title: '仍会混淆中介变量和混杂变量',
      },
    ]);
  });

  it('rejects malformed, duplicate, and unsupported memories', () => {
    expect(sanitizeDistilledLearningMemories({ memories: [
      { kind: 'progress', title: '掌握了一个概念' },
      { kind: 'progress', title: '掌握了一个概念' },
      { kind: 'strength', title: '短' },
      null,
    ] })).toEqual([{ kind: 'progress', title: '掌握了一个概念' }]);
  });

  it('protects objective activity and sensitive boundaries in the prompt', () => {
    const prompt = buildLearningMemoryDistillationPrompt();
    expect(prompt).toContain('证据必须来自用户自己的表达或作答');
    expect(prompt).toContain('不记录愿望、计划、下一步建议、人格判断、身份、情绪、健康');
    expect(prompt).toContain('证据不足就返回空数组');
  });
});
