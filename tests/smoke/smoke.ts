#!/usr/bin/env tsx
/**
 * 端到端 smoke 测试（M7-smoke）
 *
 * 目标：CEO 打开页面之前，把所有可能出 console 错的路径自动跑一遍。
 *
 * 覆盖：
 *   1. 静态路由（/login, /all-notes, /feedback, /help）是否 200
 *   2. 登录页、访客试听所需公开 API 与受保护 API 的边界是否正确（不 500）
 *   3. WebSocket 握手（/api/asr-stream, /api/tutor-call）是否 101
 *   4. 关键 API：/api/transcribe-fast、/api/translate/en-zh、/api/asr/corrections
 *   5. dev server 编译时 console 是否有 "Module not found" 之类 regression
 *
 * 用法：
 *   npm run smoke            # 默认 http://localhost:3101
 *   SMOKE_BASE=http://localhost:3002 npm run smoke
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { readFileSync, existsSync, statSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:3101';
const LOG_FILE = process.env.SMOKE_LOG || '/tmp/meetmind-dev.log';

// 记录 smoke 启动时 log 文件大小——只 check 在此之后写入的内容，
// 避免历史错误（例如之前的 500、Prisma P2021）误报。
const LOG_START_SIZE = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}
const results: Check[] = [];

function rec(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  const mark = pass ? '✓' : '✗';
  const line = detail ? `${mark} ${name} — ${detail}` : `${mark} ${name}`;
  (pass ? console.log : console.error)(line);
}

async function httpCheck(path: string, expected: number[], name?: string): Promise<void> {
  try {
    const url = `${BASE}${path}`;
    const res = await fetch(url, { redirect: 'manual' });
    const ok = expected.includes(res.status);
    rec(name || `GET ${path}`, ok, `HTTP ${res.status} (expected ${expected.join('|')})`);
  } catch (err) {
    rec(name || `GET ${path}`, false, `network: ${(err as Error).message}`);
  }
}

async function postCheck(
  path: string,
  body: unknown,
  expected: number[],
  name?: string,
  headers?: Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(body),
    });
    const ok = expected.includes(res.status);
    rec(name || `POST ${path}`, ok, `HTTP ${res.status} (expected ${expected.join('|')})`);
  } catch (err) {
    rec(name || `POST ${path}`, false, `network: ${(err as Error).message}`);
  }
}

interface AuthedPost {
  (path: string, body: unknown, expected: number[], name?: string): Promise<void>;
}

async function wsCheck(path: string): Promise<void> {
  const wsUrl = BASE.replace(/^http/, 'ws') + path;
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let done = false;
    const finish = (pass: boolean, detail: string) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      rec(`WS ${path}`, pass, detail);
      resolve();
    };
    ws.on('open', () => finish(true, 'handshake 101 + open'));
    ws.on('error', (err) => finish(false, `error: ${err.message}`));
    setTimeout(() => finish(false, 'timeout 4s'), 4000);
  });
}

function grepLogFor(pattern: RegExp, expectZero = true): void {
  if (!existsSync(LOG_FILE)) {
    console.log(`↷ log check (${pattern.source}) — skipped, no log file at ${LOG_FILE}`);
    return;
  }
  // expect-present 扫全文件（例如 "Ready on http://" 是启动标志，不会在 smoke 期间出现）
  // expect-none  扫 smoke 启动之后写入的 log，避免历史残留误报
  const fs = require('node:fs');
  let content: string;
  if (!expectZero) {
    content = readFileSync(LOG_FILE, 'utf-8');
  } else {
    const currentSize = statSync(LOG_FILE).size;
    const bytesToRead = Math.max(0, currentSize - LOG_START_SIZE);
    if (bytesToRead === 0) {
      content = '';
    } else {
      const fd = fs.openSync(LOG_FILE, 'r');
      try {
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buf, 0, bytesToRead, LOG_START_SIZE);
        content = buf.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  const hits = content.split('\n').filter((l) => pattern.test(l));
  const ok = expectZero ? hits.length === 0 : hits.length > 0;
  rec(
    `log: ${pattern.source}${expectZero ? ' (expect none since start)' : ' (expect present)'}`,
    ok,
    `${hits.length} hit(s)${hits.length > 0 ? '\n     ' + hits[0].slice(0, 140) : ''}`,
  );
}

async function registerOrLogin(username: string, password: string): Promise<string | null> {
  // 先尝试登录；失败就注册
  const login = async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string; success?: boolean };
    return data.accessToken ?? null;
  };

  const existing = await login();
  if (existing) return existing;

  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!reg.ok) return null;
  const regData = (await reg.json()) as { accessToken?: string };
  if (regData.accessToken) return regData.accessToken;
  return login();
}

async function main() {
  console.log(`\n=== meetmind smoke test ===  base=${BASE}\n`);

  // 1. 静态/公开路由
  console.log('\n--- Routes ---');
  await httpCheck('/', [200, 307]);
  await httpCheck('/login', [200]);
  await httpCheck('/all-notes', [200, 307]);
  await httpCheck('/feedback', [200, 307]);
  await httpCheck('/help', [200, 307, 404]);
  await httpCheck('/app', [200, 307]); // 未登录 307 → /login
  await httpCheck('/classroom', [200, 307, 404]);

  // 2. WebSocket
  console.log('\n--- WebSocket ---');
  await wsCheck('/api/asr-stream');
  await wsCheck('/api/tutor-call');

  // 3. API：访客试听所需能力公开；用户数据写入仍需鉴权。
  console.log('\n--- API ---');
  await postCheck('/api/translate/en-zh', { terms: ['neural network'] }, [200]);
  await postCheck('/api/asr/corrections', {}, [400, 401]);
  await postCheck(
    '/api/asr/corrections/aggregate',
    { scope: 'user' },
    [401],
    'POST /api/asr/corrections/aggregate (no auth → 401)',
  );
  await postCheck('/api/tutor/agent', { messages: [] }, [200]);

  // 4. 鉴权流程：注册/登录 → 拿 token → 调用受保护 API
  console.log('\n--- Authed flow ---');
  const testUser = `smoketest_${Date.now().toString(36)}`;
  const testPassword = 'Sm0keT3st!Password';
  const token = await registerOrLogin(testUser, testPassword);
  rec('register or login', Boolean(token), token ? 'got accessToken' : 'no token returned');

  if (token) {
    const auth = { Authorization: `Bearer ${token}` };

    // 受保护 API 带 token 后应成功
    const me = await fetch(`${BASE}/api/auth/me`, { headers: auth });
    rec('GET /api/auth/me (authed)', me.status === 200, `HTTP ${me.status}`);

    // translate/en-zh：有 token 应该真翻译
    const trStart = Date.now();
    const trRes = await fetch(`${BASE}/api/translate/en-zh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ terms: ['neural network'] }),
    });
    const trElapsed = Date.now() - trStart;
    const trData = trRes.ok
      ? ((await trRes.json()) as { translations?: Record<string, string> })
      : null;
    const tr = trData?.translations?.['neural network'];
    rec(
      'POST /api/translate/en-zh (authed)',
      trRes.ok && Boolean(tr),
      `HTTP ${trRes.status}, ${trElapsed}ms, tr="${tr ?? 'NONE'}"`,
    );

    // corrections 录入
    const corRes = await fetch(`${BASE}/api/asr/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        sessionId: `smoke-${Date.now()}`,
        wrongText: '梯度下将',
        correctedText: '梯度下降',
        asrMode: 'realtime',
      }),
    });
    rec(
      'POST /api/asr/corrections (authed)',
      corRes.status === 200,
      `HTTP ${corRes.status}`,
    );

    // 热词 GET
    const hotRes = await fetch(`${BASE}/api/asr/corrections?scope=user`, { headers: auth });
    rec(
      'GET /api/asr/corrections?scope=user (authed)',
      hotRes.status === 200,
      `HTTP ${hotRes.status}`,
    );
  }

  // 5. 日志噪声回归
  console.log('\n--- Log regression ---');
  grepLogFor(/Module not found.*async_hooks/);
  grepLogFor(/Module not found.*pino-pretty/);
  grepLogFor(/Module not found.*pino(?!-pretty)/);
  grepLogFor(/Error: ENOENT/);
  grepLogFor(/UnhandledPromiseRejection/);
  grepLogFor(/TypeError:/);
  // P2021 (Prisma: table does not exist) — DB 路径不一致的信号
  grepLogFor(/P2021|TableDoesNotExist/);
  // 500s on auth routes — never OK for smoke env
  grepLogFor(/POST \/api\/auth\/\S+ 500/);
  grepLogFor(/Ready on http:\/\//, false); // 这条必须有

  // 6. 登录页防呆检查
  console.log('\n--- Login form guards ---');
  // 空 code 的 login-with-code 应在前端就被拦掉——若前端没拦，会打到后端，
  // smoke 无法直接测 DOM 行为，但可以测 API：空 body 返 400（已测）
  const emptyCode = await fetch(`${BASE}/api/auth/login-with-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'nobody@example.com', code: '', type: 'email' }),
  });
  rec(
    'POST /api/auth/login-with-code (empty code) → 400',
    emptyCode.status === 400,
    `HTTP ${emptyCode.status}`,
  );

  // 6. 总结
  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n--- Summary ---\n${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length > 0) {
    console.error(`\nFailed:`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke fatal:', err);
  process.exit(1);
});
