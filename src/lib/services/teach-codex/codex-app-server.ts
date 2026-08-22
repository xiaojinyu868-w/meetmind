/**
 * codex app-server 进程封装：stdio JSON-RPC 客户端 + 生命周期。
 *
 * 每个教学线程一个进程（CODEX_HOME 隔离到 data/teach-codex/<threadId>/，
 * 不污染 ~/.codex；线程持久化在各自 CODEX_HOME 里，崩溃/回收后
 * thread/resume 续讲）。进程按需拉起、空闲回收（TeachConfig.idleMs）、
 * 崩溃后下一次用线程时自动重启。
 *
 * 协议事实（out/codex-spike/REPORT.md §5 已验证）：
 *   initialize → initialized(通知) → thread/start|thread/resume →
 *   turn/start → item/agentMessage/delta… → turn/completed；
 *   turn/interrupt 立即返回 {}，随后 turn/completed status="interrupted"。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import { TeachConfig } from '@/lib/config/teach.config';

const log = createLogger('teach-codex');

export type CodexNotification = { method: string; params?: Record<string, unknown> };
export type NotificationHandler = (notification: CodexNotification) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export function resolveCodexBin(): string {
  return TeachConfig.codexBin || path.join(process.cwd(), 'node_modules', '.bin', 'codex');
}

export class CodexAppServer {
  private child: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private onNotification: NotificationHandler = () => {};
  /** 最后一次业务活动时间（空闲回收依据） */
  lastActivity = Date.now();
  /** 进程是否已退出 */
  dead = false;

  constructor(
    readonly threadId: string,
    readonly codexHome: string,
  ) {}

  setNotificationHandler(handler: NotificationHandler) {
    this.onNotification = handler;
  }

  /** 拉起进程并完成 initialize 握手（幂等：活着就直接返回） */
  async start(): Promise<void> {
    if (this.child && !this.dead) return;
    this.dead = false;
    const bin = resolveCodexBin();
    this.child = spawn(bin, ['app-server'], {
      env: {
        ...process.env,
        CODEX_HOME: this.codexHome,
        // config.toml 里 model_provider.env_key 引用它；shim 不校验入站 auth
        TEACH_SHIM_KEY: 'shim',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout!.on('data', (d: Buffer) => this.onData(d));
    this.child.stderr!.on('data', (d: Buffer) => {
      log.debug('codex stderr', { threadId: this.threadId, line: d.toString().trim().slice(0, 300) });
    });
    this.child.on('exit', (code, signal) => {
      this.dead = true;
      const err = new Error(`codex app-server exited (code=${code} signal=${signal})`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      log.warn('codex app-server exited', { threadId: this.threadId, code, signal });
      this.onExit?.();
    });

    await this.request('initialize', {
      clientInfo: { name: 'meetmind-teach', version: '1.0.0' },
    });
    this.notify('initialized', {});
    log.info('codex app-server started', { threadId: this.threadId, pid: this.child.pid });
  }

  /** 进程退出回调（会话服务用来清理注册表） */
  onExit: (() => void) | null = null;

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child || this.dead) return Promise.reject(new Error('codex app-server not running'));
    this.lastActivity = Date.now();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method: string, params: Record<string, unknown>) {
    if (!this.child || this.dead) return;
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  kill() {
    if (this.child && !this.dead) {
      this.child.kill('SIGTERM');
    }
    this.dead = true;
  }

  private onData(data: Buffer) {
    this.buf += data.toString();
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.lastActivity = Date.now();
        try {
          this.onNotification({ method: msg.method, params: msg.params });
        } catch (cause) {
          log.error('notification handler failed', {
            threadId: this.threadId,
            method: msg.method,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    }
  }
}

// ---------- 进程注册表 + 空闲回收（Next 进程内单例） ----------

interface RegistryState {
  sessions: Map<string, CodexAppServer>;
  reaper: NodeJS.Timeout | null;
}

const globalForRegistry = globalThis as unknown as { __teachCodexRegistry?: RegistryState };
const registry: RegistryState =
  globalForRegistry.__teachCodexRegistry ?? { sessions: new Map(), reaper: null };
globalForRegistry.__teachCodexRegistry = registry;

export function getCodexSession(threadId: string): CodexAppServer | undefined {
  const session = registry.sessions.get(threadId);
  return session && !session.dead ? session : undefined;
}

export function registerCodexSession(session: CodexAppServer): void {
  registry.sessions.set(session.threadId, session);
  session.onExit = () => {
    if (registry.sessions.get(session.threadId) === session) {
      registry.sessions.delete(session.threadId);
    }
  };
  ensureReaper();
}

export function removeCodexSession(threadId: string): void {
  const session = registry.sessions.get(threadId);
  if (session) session.kill();
  registry.sessions.delete(threadId);
}

function ensureReaper() {
  if (registry.reaper) return;
  registry.reaper = setInterval(() => {
    const now = Date.now();
    for (const session of registry.sessions.values()) {
      if (now - session.lastActivity > TeachConfig.idleMs) {
        log.info('reaping idle codex app-server', { threadId: session.threadId });
        session.kill();
        registry.sessions.delete(session.threadId);
      }
    }
  }, 60_000);
  registry.reaper.unref?.(); // 不阻碍进程退出
}
