/**
 * skills 单测（P2）：
 * - 真实 assets/teach-skills 全量加载：frontmatter 合法（零诊断）、name 唯一、
 *   disable-model-invocation 的 lab-sim 不进 system prompt；
 * - 多源合并：内置 + fenshen 人物人格（discoverPersonaSkillDirs 就绪门禁）、
 *   撞名去重（内置优先）、人格段注入语义；
 * - 词表预留：widget_show 在 ACTIONS_V2_RESERVED，不进 V1/KNOWN/启用词表。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverPersonaSkillDirs, loadTeachingSkills } from '../runtime/skills';
import {
  ACTIONS_V1,
  ACTIONS_V2_RESERVED,
  KNOWN_ACTIONS,
  isActionEnabled,
} from '../runtime/action-map';

const REAL_SKILLS_DIR = 'assets/teach-skills';

const EXPECTED_BUILTIN = [
  'feynman-learning',
  'understanding-by-design',
  'social-emotional-learning',
  'learning-to-learn',
  'k12-core-literacy-planning',
  'lecture-style',
  'workshop-style',
  'fact-check',
  'quiz-maker',
  'lab-sim',
];

function writeSkill(dir: string, name: string, description: string, body = '# body'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\n---\n\n${body}\n`);
}

/** 造一个 fenshen 分身数据根：work/skill 镜像存在 = 蒸馏就绪（才会被挂载）。 */
function makePersona(root: string, egoId: string, skillName: string, opts?: { mirror?: boolean }): void {
  const work = join(root, egoId, 'work');
  writeSkill(join(work, 'skills', skillName), skillName, `${skillName} 的人格`);
  writeSkill(join(work, 'skills', 'huashu-nuwa'), 'huashu-nuwa', 'nuwa 模板（不应被挂载）');
  if (opts?.mirror !== false) {
    writeSkill(join(work, 'skill'), skillName, `${skillName} 的镜像`);
  }
}

describe('assets/teach-skills 真实内容加载', () => {
  it('10 个首发 skill 全部加载、零诊断、name 唯一', async () => {
    const loaded = await loadTeachingSkills(REAL_SKILLS_DIR);
    expect(loaded.diagnostics).toEqual([]);
    const names = loaded.skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of EXPECTED_BUILTIN) expect(names).toContain(name);
  });

  it('system prompt 含 available_skills 块；lab-sim（v2 预留）不对模型可见', async () => {
    const loaded = await loadTeachingSkills(REAL_SKILLS_DIR);
    expect(loaded.systemPromptBlock).toContain('<available_skills>');
    expect(loaded.systemPromptBlock).toContain('<name>quiz-maker</name>');
    expect(loaded.systemPromptBlock).toContain('<name>feynman-learning</name>');
    expect(loaded.systemPromptBlock).not.toContain('<name>lab-sim</name>');
  });

  it('目录缺失返回空不报错', async () => {
    const loaded = await loadTeachingSkills('assets/teach-skills-does-not-exist');
    expect(loaded.skills).toEqual([]);
    expect(loaded.systemPromptBlock).toBe('');
    expect(loaded.diagnostics).toEqual([]);
  });
});

describe('多源合并（内置 + fenshen 人物人格）', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('就绪分身（有 work/skill 镜像）被挂载；未就绪与 nuwa 模板不挂载', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'teach-skills-'));
    const builtinDir = join(tmp, 'builtin');
    writeSkill(join(builtinDir, 'quiz-maker'), 'quiz-maker', '出题判分');
    const personaRoot = join(tmp, 'fenshen');
    makePersona(personaRoot, 'ego-ready', 'kongzi-perspective');
    makePersona(personaRoot, 'ego-not-ready', 'sushi-perspective', { mirror: false });

    expect(discoverPersonaSkillDirs(personaRoot)).toEqual([
      join(personaRoot, 'ego-ready', 'work', 'skills', 'kongzi-perspective'),
    ]);

    const loaded = await loadTeachingSkills(builtinDir, { personaRoot });
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((s) => s.name).sort()).toEqual(['kongzi-perspective', 'quiz-maker']);
    expect(loaded.personaSkills.map((s) => s.name)).toEqual(['kongzi-perspective']);
    // 人格段单独成段 + 注入语义（老师人格 / 机制不对学生可见）
    expect(loaded.systemPromptBlock).toContain('教学人格');
    expect(loaded.systemPromptBlock).toContain('永不出现在口播与板书');
    expect(loaded.systemPromptBlock).toContain('<name>kongzi-perspective</name>');
  });

  it('人物 skill 与内置撞名时内置优先，撞名记诊断', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'teach-skills-'));
    const builtinDir = join(tmp, 'builtin');
    writeSkill(join(builtinDir, 'quiz-maker'), 'quiz-maker', '内置出题');
    const personaRoot = join(tmp, 'fenshen');
    // 撞名场景：nuwa 规范目录名 <name>-perspective，但 frontmatter name 与内置撞车
    // （pi 会附带 invalid_metadata 警告但仍加载，去重在我们的合并层发生）。
    const work = join(personaRoot, 'ego-x', 'work');
    writeSkill(join(work, 'skills', 'quiz-maker-perspective'), 'quiz-maker', '撞名的人格');
    writeSkill(join(work, 'skill'), 'quiz-maker', '镜像');

    const loaded = await loadTeachingSkills(builtinDir, { personaRoot });
    expect(loaded.skills.map((s) => s.name)).toEqual(['quiz-maker']);
    expect(loaded.personaSkills).toEqual([]);
    expect(loaded.diagnostics.some((d) => d.includes('duplicate_name'))).toBe(true);
  });

  it('personaRoot 缺失时退化为单源（内置照常）', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'teach-skills-'));
    const builtinDir = join(tmp, 'builtin');
    writeSkill(join(builtinDir, 'quiz-maker'), 'quiz-maker', '出题判分');
    const loaded = await loadTeachingSkills(builtinDir, {
      personaRoot: join(tmp, 'no-such-dir'),
    });
    expect(loaded.skills.map((s) => s.name)).toEqual(['quiz-maker']);
    expect(loaded.diagnostics).toEqual([]);
  });
});

describe('widget_show v2 预留', () => {
  afterEach(() => {
    delete process.env.TEACH_ACTIONS_FULL;
  });

  it('KNOWN 但不启用：不进 V1、不进 KNOWN_ACTIONS、TEACH_ACTIONS_FULL=1 也不放行', () => {
    expect(ACTIONS_V2_RESERVED).toContain('widget_show');
    expect(ACTIONS_V1).not.toContain('widget_show');
    expect(KNOWN_ACTIONS).not.toContain('widget_show');
    expect(isActionEnabled('widget_show')).toBe(false);
    process.env.TEACH_ACTIONS_FULL = '1';
    expect(isActionEnabled('widget_show')).toBe(false);
  });
});
