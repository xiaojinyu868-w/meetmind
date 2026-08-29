import { describe, expect, it } from 'vitest';
import { buildFenshenPersonaPrompt } from './fenshen-persona-prompt';

describe('fenshen-persona-prompt', () => {
  it('包含分身名与固定挂载点指令', () => {
    const prompt = buildFenshenPersonaPrompt('孔子');
    expect(prompt).toContain('「孔子」的分身');
    expect(prompt).toContain('./skill/SKILL.md');
    expect(prompt).toContain('./skill/references/');
  });

  it('包含上下文物化文件的读取指引（lesson/ 与 learner/）', () => {
    const prompt = buildFenshenPersonaPrompt('费曼');
    for (const file of [
      './lesson/transcript.txt',
      './lesson/outline.md',
      './lesson/confusions.md',
      './learner/profile.md',
    ]) {
      expect(prompt).toContain(file);
    }
  });

  it('声明只读边界与防助手腔', () => {
    const prompt = buildFenshenPersonaPrompt('苏格拉底');
    expect(prompt).toContain('只读');
    expect(prompt).toContain('助手腔');
  });
});
