/**
 * 蒸馏编排 —— 用 nuwa skill 原文（女娲·Skill造人术）把一个人蒸馏成分身 skill。
 *
 * 流程：建 workspace（nuwa 原文落位 work/skills/huashu-nuwa/；私有轨另备
 * sources/transcripts/）→ 写蒸馏线程 CODEX_HOME 的 config.toml（provider 指
 * 本地 shim + Firecrawl 官方 MCP）→ 拉起 codex app-server → thread/start
 * （sandbox=workspace-write，cwd=分身 work/）→ turn/start 发启动消息
 * （Phase 0A 答案全集，不阻塞）。
 *
 * 运行中：codex 内置 exec/MCP 通知映射为 {type:'distill-progress',note}
 * 账本式事件；完成检测 = work/skills/<name>-perspective/SKILL.md 存在 →
 * status=ready + skillPath 回填 + 镜像到 work/skill/（对话线程固定挂载点）
 * + 发 {type:'ego-ready'}。unlike 反馈走 requestDistillRevision 重蒸馏 turn。
 *
 * 注意：所有可变状态必须挂 globalThis——Next dev 下每个路由是独立编译
 * entry，模块级 Map 会被复制多份（teach 线冒烟实测踩过）。
 */

import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import { resolveTeachProvider, teachProviderApiKey } from '@/lib/config/teach.config';
import { publishFenshenEvent, type FenshenStreamEvent } from './event-bus';
import { egoPaths, isPrivateSource, FenshenConfig, resolveDistillProvider } from './fenshen-config';
import { ensureShimServer } from '../teach-codex/shim-server';
import {
  CodexAppServer,
  getCodexSession,
  registerCodexSession,
  type CodexNotification,
} from '../teach-codex/codex-app-server';
import * as store from './thread-store';

const log = createLogger('fenshen-distill');

/** 蒸馏进程注册表 key（与对话线程 key 区分；复用 teach 的进程注册表/回收） */
const distillKey = (egoId: string) => `${egoId}:distill`;

interface DistillState {
  /** ensureDistillSession 串行化（防并发拉两个进程） */
  sessionInflight: Map<string, Promise<{ session: CodexAppServer; codexThreadId: string }>>;
}

const globalForDistill = globalThis as unknown as { __fenshenDistillState?: DistillState };
const state: DistillState = globalForDistill.__fenshenDistillState ?? { sessionInflight: new Map() };
globalForDistill.__fenshenDistillState = state;

function emit(egoId: string, event: FenshenStreamEvent) {
  publishFenshenEvent(egoId, event);
  store.appendEgoEvent(egoId, event).catch((cause) => {
    log.warn('event append failed', {
      egoId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

/**
 * 发消息前的同步预检（provider key 缺失时路由直接 500，不开工）。
 * 名人轨（hall）语料靠 Firecrawl 官方 MCP 联网采集，还需 FIRECRAWL_API_KEY。
 */
export function preflightFenshen(sourceType?: string): { ok: true } | { ok: false; error: string } {
  const provider = resolveTeachProvider();
  if (!teachProviderApiKey(provider)) {
    return { ok: false, error: `分身底座未配置 ${provider.apiKeyEnv}（provider=${provider.id}）` };
  }
  if (sourceType === 'hall' && !process.env.FIRECRAWL_API_KEY?.trim()) {
    return { ok: false, error: '名人轨蒸馏需要 FIRECRAWL_API_KEY（联网语料采集）' };
  }
  // upload 轨必走 ASR 转写；bilibili 有官方字幕捷径，ASR 缺失由语料管线报人可读错误
  if (sourceType === 'upload' && !process.env.DASHSCOPE_API_KEY?.trim()) {
    return { ok: false, error: '上传轨需要 DASHSCOPE_API_KEY（录音转写）' };
  }
  return { ok: true };
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 蒸馏线程 CODEX_HOME 的 config.toml：provider 指本地 shim + Firecrawl 官方远端 MCP */
async function writeDistillCodexConfig(egoId: string, codexHome: string): Promise<void> {
  const provider = resolveDistillProvider();
  const shim = await ensureShimServer();
  // spike 实测（out/fenshen-spike/REPORT.md）：stdio 版 npx firecrawl-mcp 挂死不答
  // initialize，必须用托管远端 MCP（rmcp）；沙箱默认无网络，workspace-write 需显式开
  const toml = `# 自动生成 by fenshen distill-service（每分身 CODEX_HOME，勿手改）
model = "${tomlEscape(provider.model)}"
model_provider = "teach_shim"
approval_policy = "never"
project_doc_max_bytes = 0
experimental_use_rmcp_client = true

[sandbox_workspace_write]
network_access = true

[model_providers.teach_shim]
name = "teach responses->chat shim (${tomlEscape(provider.id)})"
base_url = "${tomlEscape(shim.baseUrl)}"
env_key = "TEACH_SHIM_KEY"
wire_api = "responses"

[mcp_servers.firecrawl]
url = "https://mcp.firecrawl.dev/v2/mcp"
bearer_token_env_var = "FIRECRAWL_API_KEY"
`;
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, 'config.toml'), toml, 'utf8');
}

/** 建分身 workspace：nuwa 原文落位（幂等）+ 私有轨本地语料目录 */
async function prepareDistillWorkspace(ego: store.FenshenEgoRow): Promise<void> {
  const paths = egoPaths(ego.id);
  await mkdir(paths.skillsDir, { recursive: true });
  const nuwaTarget = path.join(paths.skillsDir, 'huashu-nuwa');
  try {
    await stat(path.join(nuwaTarget, 'SKILL.md'));
  } catch {
    await cp(path.join(process.cwd(), FenshenConfig.nuwaTemplateDir), nuwaTarget, {
      recursive: true,
    });
    log.info('nuwa skill copied', { egoId: ego.id });
  }
  if (isPrivateSource(ego.sourceType)) {
    // 语料由 corpus-service 产出 transcript txt 到此目录（POST 后台管线，
    // 语料就绪后才起蒸馏线程）；此处只保底建目录，语料为空时 nuwa 会走
    // "素材不足"降级路径并在输出里说明
    await mkdir(path.join(paths.workDir, 'sources', 'transcripts'), { recursive: true });
  }
}

/** 启动消息：nuwa Phase 0A 答案全集（不阻塞检查点）；私有轨声明纯本地语料模式 */
export function buildDistillKickoff(ego: { name: string; sourceType: string }): string {
  const corpusLine = isPrivateSource(ego.sourceType)
    ? '- 纯本地语料模式（蒸馏非公众人物分支）：素材在 sources/transcripts/ 下，不要联网采集'
    : '- 无本地语料，走联网采集模式';
  return `你的工作区里有一个技能：skills/huashu-nuwa/SKILL.md（女娲·Skill造人术）。

第一步：完整读取 skills/huashu-nuwa/SKILL.md，以及它引用到的 skills/huashu-nuwa/references/ 下的文件（extraction-framework.md、skill-template.md），严格按它定义的流程执行。

任务：蒸馏「${ego.name}」。

预设答案（Phase 0A 的全部澄清，直接采用，不要再问我）：
- 聚焦方向：全面画像，侧重 TA 的教学方式与表达风格
- 用途：思维顾问 + 以 TA 的方式为人讲解知识
- 新建（当前没有 ${ego.name} 的 skill）
${corpusLine}
- 档位：标准档（6 个维度完整调研）
- 所有检查点（Phase 1.5 / 2.5 / 4 / 5）使用默认值自动继续，不要停下来等确认

工具说明：
- 你不能联网搜索的内置工具不可用时，使用 firecrawl MCP 工具（firecrawl_search / firecrawl_scrape 等）作为 WebSearch 和网页抓取的等价物
- 如果环境不支持并行 subagent，按 SKILL.md 失败模式表降级为串行执行，每完成一个维度立即落盘
- 遵守信息源黑名单（知乎/微信公众号/百度百科不用）

产出要求：
- 最终 skill 写到 skills/ 下按女娲命名规范新建的 *-perspective/ 目录，遵守自包含目录规范（SKILL.md + references/research/01-06 调研落盘文件）
- 执行 Phase 4 质量验证并在最终总结里给出验证结果

开始前先简要列出你的执行计划，然后不间断地执行到完成。`;
}

/**
 * 完成检测：work/skills/ 下出现 <name>-perspective/SKILL.md。
 * 命中后镜像到 work/skill/（对话线程 baseInstructions 的固定挂载点
 * ./skill/SKILL.md），返回相对 work/ 的目录名（如 skills/kongzi-perspective）。
 */
async function detectDistilledSkill(egoId: string): Promise<string | null> {
  const paths = egoPaths(egoId);
  let entries: string[];
  try {
    entries = await readdir(paths.skillsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('-perspective')) continue;
    const skillFile = path.join(paths.skillsDir, entry, 'SKILL.md');
    try {
      await stat(skillFile);
    } catch {
      continue;
    }
    const skillPath = `skills/${entry}`;
    await cp(path.join(paths.skillsDir, entry), paths.chatSkillDir, { recursive: true });
    return skillPath;
  }
  return null;
}

/**
 * codex 内置 exec/MCP 通知 → 账本式 distill-progress 事件。
 *
 * 铁律：skill 内部机制（命令、文件名、Phase、SKILL.md、分句指纹）不进 UI。
 * 这里只映射为固定的人话步骤短语，相邻去重；raw 字符串一律丢弃。
 */
const DISTILL_STEP_PHRASES = [
  '翻阅讲课素材',
  '提炼语言习惯',
  '整理知识脉络',
  '校准表达风格',
  '核对内容细节',
  '打磨讲解方式',
];
const distillStepCounters = new Map<string, number>();
const lastDistillNote = new Map<string, string>();

function progressNote(egoId: string, notification: CodexNotification): string | null {
  if (notification.method !== 'item/started') return null;
  const item = (notification.params ?? {}).item as Record<string, unknown> | undefined;
  if (!item) return null;
  let note: string | null = null;
  if (item.type === 'commandExecution') {
    const n = distillStepCounters.get(egoId) ?? 0;
    distillStepCounters.set(egoId, n + 1);
    note = DISTILL_STEP_PHRASES[n % DISTILL_STEP_PHRASES.length];
  } else if (item.type === 'mcpToolCall') {
    note = '检索公开资料';
  }
  if (!note) return null;
  if (lastDistillNote.get(egoId) === note) return null;
  lastDistillNote.set(egoId, note);
  return note;
}

async function onDistillTurnSettled(egoId: string): Promise<void> {
  const skillPath = await detectDistilledSkill(egoId);
  if (skillPath) {
    const ego = await store.getEgo(egoId);
    if (ego && ego.status !== 'ready') {
      await store.setEgoStatus(egoId, 'ready', { skillPath });
      emit(egoId, { type: 'ego-ready', skillPath });
      log.info('distill complete', { egoId, skillPath });
    }
  }
  store.touchEgo(egoId).catch(() => {});
}

function onDistillNotification(egoId: string, notification: CodexNotification) {
  const { method, params } = notification;
  const p = (params ?? {}) as Record<string, unknown>;

  // 蒸馏线程的 agent 叙述（Phase/SKILL.md 等内部机制）一律不进 UI——
  // 进度只由 distill-progress 账本承载（skill 永不对用户可见）。
  const note = progressNote(egoId, notification);
  if (note) {
    emit(egoId, { type: 'distill-progress', note });
    return;
  }
  if (method === 'item/completed' || method === 'turn/completed') {
    // 每个动作/turn 落地都查一次产物（readdir 很便宜），命中即 ready
    onDistillTurnSettled(egoId).catch((cause) => {
      log.warn('distill completion check failed', {
        egoId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
    if (method === 'turn/completed') {
      const turn = p.turn as { status?: string } | undefined;
      emit(egoId, turn?.status === 'interrupted' ? { type: 'interrupted' } : { type: 'turn-complete' });
    }
  }
}

/** 确保蒸馏线程的 codex 会话可用（进程 + codex 线程），返回句柄与 codexThreadId */
async function ensureDistillSession(
  ego: store.FenshenEgoRow,
): Promise<{ session: CodexAppServer; codexThreadId: string }> {
  const key = distillKey(ego.id);
  const existing = getCodexSession(key);
  if (existing && ego.distillThreadId) return { session: existing, codexThreadId: ego.distillThreadId };
  const inflight = state.sessionInflight.get(key);
  if (inflight) return inflight;

  const starting = (async (): Promise<{ session: CodexAppServer; codexThreadId: string }> => {
    const paths = egoPaths(ego.id);
    await prepareDistillWorkspace(ego);
    await writeDistillCodexConfig(ego.id, paths.distillHome);

    const session = new CodexAppServer(key, paths.distillHome);
    session.setNotificationHandler((n) => onDistillNotification(ego.id, n));
    await session.start();
    registerCodexSession(session);

    const provider = resolveTeachProvider();
    const params = {
      model: provider.model,
      modelProvider: 'teach_shim',
      cwd: paths.workDir,
      approvalPolicy: 'never',
      // nuwa 要在 skills/ 下写调研与产物文件；cwd 限定分身 workspace 防越界
      sandbox: 'workspace-write',
    };
    let codexThreadId = ego.distillThreadId;
    if (codexThreadId) {
      await session.request('thread/resume', { ...params, threadId: codexThreadId });
      log.info('distill thread resumed', { egoId: ego.id, distillThreadId: codexThreadId });
    } else {
      const result = (await session.request('thread/start', params)) as {
        thread?: { id?: string };
        id?: string;
      };
      codexThreadId = result.thread?.id || result.id || null;
      if (!codexThreadId) throw new Error('thread/start 未返回 thread id');
      await store.setDistillThreadId(ego.id, codexThreadId);
      log.info('distill thread started', { egoId: ego.id, distillThreadId: codexThreadId });
    }
    return { session, codexThreadId };
  })();

  state.sessionInflight.set(key, starting);
  try {
    return await starting;
  } finally {
    state.sessionInflight.delete(key);
  }
}

/** 蒸馏线程上发起一个 turn（首次蒸馏与重蒸馏共用） */
async function startDistillTurn(ego: store.FenshenEgoRow, text: string): Promise<void> {
  const { session, codexThreadId } = await ensureDistillSession(ego);
  await session.request('turn/start', {
    threadId: codexThreadId,
    input: [{ type: 'text', text }],
  });
}

/**
 * 首次蒸馏：建 workspace → 拉起蒸馏线程 → 发启动消息 turn。
 * resolve 时机 = codex 收下 turn（进度随后经总线流出）；同步错误抛给路由。
 */
export async function startDistillation(egoId: string): Promise<void> {
  const ego = await store.getEgo(egoId);
  if (!ego) throw new store.FenshenServiceError('ego-not-found', '分身不存在', 404);
  if (ego.status === 'ready') {
    throw new store.FenshenServiceError('ego-ready', '分身已就绪，无需重复蒸馏', 409);
  }
  try {
    await store.setEgoStatus(egoId, 'learning', { failReason: '' });
    await startDistillTurn(ego, buildDistillKickoff(ego));
    log.info('distillation kicked off', { egoId, name: ego.name, sourceType: ego.sourceType });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await store.setEgoStatus(egoId, 'failed', { failReason: message.slice(0, 200) }).catch(() => {});
    emit(egoId, { type: 'error', message: `蒸馏启动失败：${message.slice(0, 120)}` });
    throw cause;
  }
}

/**
 * 试听反馈「不像」→ 重蒸馏 turn（带 note 重听）。状态回到 learning，
 * 产物 SKILL.md 被修订后完成检测再次触发 ready + ego-ready。
 */
export async function requestDistillRevision(egoId: string, note?: string): Promise<void> {
  const ego = await store.getEgo(egoId);
  if (!ego) throw new store.FenshenServiceError('ego-not-found', '分身不存在', 404);
  if (!ego.skillPath) {
    throw new store.FenshenServiceError('ego-not-ready', '分身还没有蒸馏产物，无法修订', 409);
  }
  const feedback = note?.trim() ? `学生的具体反馈：${note.trim().slice(0, 300)}` : '学生没有留下具体说明。';
  const text = `试听反馈：学生觉得分身「不像」${ego.name}。${feedback}

请重读 skills/huashu-nuwa/SKILL.md 的模板与防漂移规则，对照修订 ${ego.skillPath}/ 下的分身 skill（重点：语气、口头禅、讲解与举例方式），改完直接落盘覆盖原目录；如需补采语料可用 firecrawl MCP 工具。完成后简要说明改了什么。`;
  await store.setEgoStatus(egoId, 'learning');
  try {
    await startDistillTurn(ego, text);
    log.info('distill revision kicked off', { egoId, hasNote: Boolean(note?.trim()) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    emit(egoId, { type: 'error', message: `重蒸馏失败：${message.slice(0, 120)}` });
    throw cause;
  }
}
