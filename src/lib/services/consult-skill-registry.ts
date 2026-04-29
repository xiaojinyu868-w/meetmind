/**
 * consult-skill-registry —— Scenario skill 注册表
 *
 * 职责：
 *   1. 扫描 scenarios 根目录，找出所有合法 skill（通过 OpenClaw 官方 validator）
 *   2. 解析 frontmatter（name / description）
 *   3. 按 name 加载 body（安全的路径白名单）
 *
 * 实现：
 *   - 合法性校验委托给 `scripts/skill/quick_validate.py`（vendored from openclaw@2026.4.23）
 *   - frontmatter 解析就地做（不依赖 python yaml），但跟 quick_validate 的解析规则对齐
 *   - cache：每个 skill 按路径 + mtime 缓存，开发时热更新，production 不重复 IO
 *
 * 场景目录约定（对齐 OpenClaw workspace）：
 *   - 平台默认：  platform-skills/scenarios/<name>/SKILL.md
 *   - 机构私有：  orgs/<orgId>/skills/<name>/SKILL.md   （S4 阶段落地）
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ScenarioInfo {
  name: string;
  description: string;
  source: 'platform' | 'org';
  orgId?: string;
  bodyPath: string;
}

const PLATFORM_SCENARIOS_DIR = path.resolve(process.cwd(), 'platform-skills/scenarios');
const VALIDATOR = path.resolve(process.cwd(), 'scripts/skill/quick_validate.py');

// ────────────── frontmatter parser（保守版，对齐 openclaw quick_validate） ──────────────

interface Frontmatter {
  name?: string;
  description?: string;
}

export function parseFrontmatter(md: string): { fm: Frontmatter; body: string } {
  const lines = md.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') return { fm: {}, body: md };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { fm: {}, body: md };

  const fmRaw = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');

  const fm: Frontmatter = {};
  const kvRe = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/;
  for (const line of fmRaw.split('\n')) {
    const m = line.match(kvRe);
    if (!m) continue;
    let val = m[2].trim();
    // 去掉外围引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (m[1] === 'name') fm.name = val;
    else if (m[1] === 'description') fm.description = val;
  }
  return { fm, body };
}

// ────────────── cache ──────────────

interface CacheEntry {
  info: ScenarioInfo;
  mtimeMs: number;
}
const cache = new Map<string, CacheEntry>(); // key = absolute skill dir

// ────────────── 官方 validator 包装 ──────────────

export interface ValidationResult {
  ok: boolean;
  message: string;
}

export async function validateSkillDir(skillDir: string): Promise<ValidationResult> {
  try {
    const { stdout } = await execFileP('python3', [VALIDATOR, skillDir], {
      timeout: 10_000,
    });
    return { ok: /valid/i.test(stdout), message: stdout.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stdout = (e as { stdout?: string }).stdout ?? '';
    const stderr = (e as { stderr?: string }).stderr ?? '';
    return { ok: false, message: [stdout, stderr, msg].filter(Boolean).join('\n').slice(0, 2000) };
  }
}

// ────────────── 列表 ──────────────

async function readSkillDir(skillDir: string, source: 'platform' | 'org', orgId?: string): Promise<ScenarioInfo | null> {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  let st;
  try {
    st = await stat(skillMdPath);
  } catch {
    return null;
  }
  const cached = cache.get(skillDir);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.info;

  // 跑官方 validator（缓存命中时跳过，但新/改动的必跑）
  const val = await validateSkillDir(skillDir);
  if (!val.ok) {
    console.warn(`[skill-registry] skip invalid skill at ${skillDir}: ${val.message.slice(0, 200)}`);
    return null;
  }

  const raw = await readFile(skillMdPath, 'utf8');
  const { fm } = parseFrontmatter(raw);
  if (!fm.name || !fm.description) return null;

  const info: ScenarioInfo = {
    name: fm.name,
    description: fm.description,
    source,
    orgId,
    bodyPath: skillMdPath,
  };
  cache.set(skillDir, { info, mtimeMs: st.mtimeMs });
  return info;
}

export async function listScenarios(opts: { orgId?: string } = {}): Promise<ScenarioInfo[]> {
  const out: ScenarioInfo[] = [];

  // 平台默认
  const platformDirs = await readdir(PLATFORM_SCENARIOS_DIR, { withFileTypes: true }).catch(() => []);
  for (const d of platformDirs) {
    if (!d.isDirectory()) continue;
    const info = await readSkillDir(path.join(PLATFORM_SCENARIOS_DIR, d.name), 'platform');
    if (info) out.push(info);
  }

  // 机构私有（M.4 阶段启用）
  if (opts.orgId) {
    const orgDir = path.resolve(process.cwd(), 'orgs', opts.orgId, 'skills');
    const orgDirs = await readdir(orgDir, { withFileTypes: true }).catch(() => []);
    for (const d of orgDirs) {
      if (!d.isDirectory()) continue;
      const info = await readSkillDir(path.join(orgDir, d.name), 'org', opts.orgId);
      if (info) out.push(info);
    }
  }

  return out;
}

// ────────────── body 加载（安全） ──────────────

export async function loadScenarioBody(skillName: string, opts: { orgId?: string } = {}): Promise<string | null> {
  // 安全：只认 listScenarios 返回的 name → bodyPath 映射，防路径穿越
  const list = await listScenarios(opts);
  const hit = list.find((s) => s.name === skillName);
  if (!hit) return null;
  return readFile(hit.bodyPath, 'utf8');
}
