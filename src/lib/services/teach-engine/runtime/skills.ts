/**
 * skill 体系：pi 原生 Agent Skills 路线（P2 铺内容 + 多源合并）。
 *
 * - loadSkills(NodeExecutionEnv, dirs)：pi 官方加载器（SKILL.md + frontmatter 解析、
 *   ignore 文件、诊断），直接复用，不重造。
 * - formatSkillsForSystemPrompt(skills)：把技能目录以 <available_skills> XML 块
 *   注进 system prompt（agentskills.io 标准格式）。
 * - createReadTool：pi 内置 read 工具，模型按需读 SKILL.md 正文 —— 这就是 pi 的
 *   "按需加载"：首轮只给 name/description/location，正文等模型 read 才进上下文。
 *
 * 多源合并（P2）：内置能力 skill（assets/teach-skills/）+ fenshen 人物人格 skill
 * （discoverPersonaSkillDirs 发现，就绪门禁 = work/skill/ 镜像存在）。两源按 name
 * 去重（内置优先），人物人格在 system prompt 里单独成段并带「老师人格、机制不对
 * 学生可见」的注入语义（PERSONA_BLOCK_INTRO）。
 *
 * 路径纪律：pi NodeExecutionEnv 的一切路径相对其 cwd 解析（fileInfo/listDir 都一样），
 * 所以传入 root 前一律 resolve 成绝对路径——相对 root 会被拼成 <cwd>/<root>/<root>
 * 而静默加载不到（P1 时目录恒缺失，此坑未暴露）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// pi-agent-core 是 import-only ESM 包（exports 无 require/default 条件）。
// 运行时件在函数内动态 import：否则 tsx 在 CJS 语境（本仓库 package.json 无
// "type":"module"，scripts/*.ts 按 CJS 转译）会把静态 import 降级成 require 而炸
// （ERR_PACKAGE_PATH_NOT_EXPORTED）。Next / vitest 均为 ESM 加载，动态 import 零差异。
import type { Skill, AgentTool } from '@earendil-works/pi-agent-core/node';

export interface LoadedSkills {
  /** 合并去重后的全部 skill（内置 + 人物人格） */
  skills: Skill[];
  /** 其中的人物人格 skill（fenshen 蒸馏产物） */
  personaSkills: Skill[];
  systemPromptBlock: string;
  /** 模型按需读 SKILL.md 的 read 工具（pi 内置，包成普通 AgentTool） */
  readTool: AgentTool;
  diagnostics: string[];
}

export interface LoadTeachingSkillsOptions {
  /**
   * fenshen 分身数据根（默认 data/fenshen-codex，TeachConfig.personaSkillsRoot 注入）。
   * 目录布局契约（见 fenshen/fenshen-config.ts）：<egoId>/work/skills/<name>-perspective/
   * 是蒸馏产物；<egoId>/work/skill/SKILL.md 是蒸馏完成后的镜像（就绪门禁）。
   */
  personaRoot?: string;
}

/** 人物人格段的前言：注入语义 = 老师人格而非能力，机制永不对学生可见（fenshen 铁律）。 */
const PERSONA_BLOCK_INTRO = `以下是可用的「教学人格」（真实老师的人格分身，不是能力技能）。学生点名想跟某位老师学、或本课已绑定人格时，先用 read 工具读对应 SKILL.md，此后整节课以那个人格的口吻与讲法上课。机制本身（人格文件、技能目录、read 工具）永不出现在口播与板书中。`;

/**
 * 发现已就绪的分身人物 skill 目录（按 egoId 字典序，结果稳定）。
 * 就绪门禁：work/skill/SKILL.md 镜像存在（蒸馏完成才镜像，见 fenshen distill-service
 * detectDistilledSkill）；加载原始产物目录 work/skills/<name>-perspective/（目录名与
 * frontmatter name 一致，不触发 pi 的 invalid_metadata 警告）。
 */
export function discoverPersonaSkillDirs(personaRoot: string): string[] {
  const dirs: string[] = [];
  let egos: string[];
  try {
    egos = readdirSync(personaRoot);
  } catch {
    return [];
  }
  for (const ego of egos.sort()) {
    const egoDir = join(personaRoot, ego);
    try {
      if (!statSync(egoDir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!existsSync(join(egoDir, 'work', 'skill', 'SKILL.md'))) continue;
    const skillsDir = join(egoDir, 'work', 'skills');
    let entries: string[];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith('-perspective')) continue;
      if (existsSync(join(skillsDir, entry, 'SKILL.md'))) dirs.push(join(skillsDir, entry));
    }
  }
  return dirs;
}

export async function loadTeachingSkills(
  skillsRoot: string,
  opts?: LoadTeachingSkillsOptions,
): Promise<LoadedSkills> {
  const { NodeExecutionEnv, loadSkills, formatSkillsForSystemPrompt, createReadTool } =
    await import('@earendil-works/pi-agent-core/node');
  const root = resolve(skillsRoot);
  const env = new NodeExecutionEnv({ cwd: root });
  const readToolInner = createReadTool();
  const readTool: AgentTool = {
    ...readToolInner,
    execute: (toolCallId, params, signal, onUpdate) =>
      readToolInner.execute(
        toolCallId,
        params as { path: string; offset?: number; limit?: number },
        signal,
        onUpdate,
        { env },
      ),
  };
  const diagnostics: string[] = [];
  const empty = { skills: [], personaSkills: [], systemPromptBlock: '', readTool, diagnostics };

  const builtin: Skill[] = [];
  // [ADAPT vs spike] skills 目录缺失是合法状态，返回空不报错。
  if (existsSync(root)) {
    const { skills, diagnostics: ds } = await loadSkills(env, [root]);
    builtin.push(...skills);
    diagnostics.push(...ds.map((d) => `${d.code}: ${d.message} (${d.path})`));
  }

  const persona: Skill[] = [];
  if (opts?.personaRoot) {
    const personaDirs = discoverPersonaSkillDirs(resolve(opts.personaRoot));
    if (personaDirs.length > 0) {
      const { skills, diagnostics: ds } = await loadSkills(env, personaDirs);
      persona.push(...skills);
      diagnostics.push(...ds.map((d) => `[persona] ${d.code}: ${d.message} (${d.path})`));
    }
  }

  // 按 name 去重：内置优先；人物 skill 撞名跳过并记诊断（不静默覆盖教学法 skill）。
  const seen = new Set(builtin.map((s) => s.name));
  const personaKept: Skill[] = [];
  for (const skill of persona) {
    if (seen.has(skill.name)) {
      diagnostics.push(`[persona] duplicate_name: "${skill.name}" 与内置 skill 撞名，已跳过 (${skill.filePath})`);
      continue;
    }
    seen.add(skill.name);
    personaKept.push(skill);
  }

  let systemPromptBlock = formatSkillsForSystemPrompt(builtin);
  if (personaKept.length > 0) {
    const personaBlock = `${PERSONA_BLOCK_INTRO}\n${formatSkillsForSystemPrompt(personaKept)}`;
    systemPromptBlock = systemPromptBlock
      ? `${systemPromptBlock}\n\n${personaBlock}`
      : personaBlock;
  }

  if (builtin.length === 0 && personaKept.length === 0) return empty;
  return {
    skills: [...builtin, ...personaKept],
    personaSkills: personaKept,
    systemPromptBlock,
    readTool,
    diagnostics,
  };
}

/** 日志用：技能清单一行一个。 */
export function summarizeSkills(skills: Skill[]): string {
  return skills.map((s) => `${s.name} — ${s.description} (${dirname(s.filePath)})`).join('\n');
}
