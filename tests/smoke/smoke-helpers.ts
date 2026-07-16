/**
 * smoke-helpers.ts — 多个 smoke 脚本共享的"打 /api/tutor/agent + 断言"框架。
 *
 * 不同 mode（goal / review / in-class / shared）有不同的 body schema 和断言关键词，
 * 各 mode 的 cases / body builder 在自己的 smoke-*.ts 里写；
 * 这里只承担：HTTP 流式请求、SSE 解析、429 重试、空回复重试、断言运行。
 */

const PORT = process.env.PORT || '3101';
export const SMOKE_BASE = `http://localhost:${PORT}`;
export const SMOKE_BYPASS_TOKEN = process.env.SMOKE_BYPASS_TOKEN || '';

export interface SmokeTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SmokeCase<TBody = unknown> {
  name: string;
  description: string;
  /** 直接构造完整 body 字段（caller 负责包好 mode/context/options） */
  body: TBody;
  mustContainAny?: string[];
  mustNotContainAny?: string[];
  mustNotMatch?: RegExp[];
  assert?: (text: string) => string | null;
}

interface SSEStreamLine {
  type?: string;
  delta?: string;
  text?: string;
  textDelta?: string;
}

async function postStream<TBody>(body: TBody, retried = false): Promise<string> {
  const response = await fetch(`${SMOKE_BASE}/api/tutor/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(SMOKE_BYPASS_TOKEN ? { 'X-Smoke-Bypass': SMOKE_BYPASS_TOKEN } : {}),
    },
    body: JSON.stringify(body),
  });
  if (response.status === 429 && !retried) {
    const text = await response.text().catch(() => '');
    let waitMs = 65_000;
    try {
      const j = JSON.parse(text) as { resetIn?: { minute?: number } };
      const m = j.resetIn?.minute;
      if (typeof m === 'number') waitMs = Math.max(5_000, m * 1000 + 2_000);
    } catch {
      /* keep default */
    }
    process.stdout.write(`\n  [429 限流] 等 ${(waitMs / 1000).toFixed(0)}s 后重试一次…`);
    await new Promise((r) => setTimeout(r, waitMs));
    return postStream(body, true);
  }
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collected = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as SSEStreamLine;
        const piece = parsed.delta ?? parsed.textDelta ?? parsed.text ?? '';
        if (typeof piece === 'string' && piece) collected += piece;
      } catch {
        /* 忽略非 JSON */
      }
    }
  }
  return collected;
}

interface CaseResult {
  ok: boolean;
  error?: string;
  reply: string;
}

function runAssertions(c: SmokeCase, reply: string): CaseResult {
  if (!reply.trim()) return { ok: false, error: '空回复', reply };
  if (c.mustContainAny && c.mustContainAny.length > 0) {
    const hit = c.mustContainAny.some((s) => {
      if (/[.*+?[\]()|^$\\]/.test(s)) {
        try {
          return new RegExp(s).test(reply);
        } catch {
          return reply.includes(s);
        }
      }
      return reply.includes(s);
    });
    if (!hit) {
      return {
        ok: false,
        error: `应包含其中之一: ${JSON.stringify(c.mustContainAny)}`,
        reply,
      };
    }
  }
  if (c.mustNotContainAny && c.mustNotContainAny.length > 0) {
    const bad = c.mustNotContainAny.filter((s) => reply.includes(s));
    if (bad.length > 0) {
      return { ok: false, error: `不应包含: ${bad.join(', ')}`, reply };
    }
  }
  if (c.mustNotMatch && c.mustNotMatch.length > 0) {
    const bad = c.mustNotMatch.filter((re) => re.test(reply));
    if (bad.length > 0) {
      return {
        ok: false,
        error: `命中禁止模式: ${bad.map((r) => r.source).join(', ')}`,
        reply,
      };
    }
  }
  if (c.assert) {
    const err = c.assert(reply);
    if (err) return { ok: false, error: err, reply };
  }
  return { ok: true, reply };
}

export async function runSmokeCase<TBody>(c: SmokeCase<TBody>): Promise<CaseResult> {
  const tryOnce = async (): Promise<CaseResult> => {
    try {
      const reply = await postStream(c.body);
      return runAssertions(c as SmokeCase, reply);
    } catch (err) {
      return {
        ok: false,
        error: `请求失败：${err instanceof Error ? err.message : String(err)}`,
        reply: '',
      };
    }
  };
  let result = await tryOnce();
  // LLM provider 偶发繁忙返回 outputTokens=0 → 等 4s 重试一次
  if (!result.ok && result.error === '空回复') {
    process.stdout.write(`\n  [空回复] 4s 后重试…`);
    await new Promise((r) => setTimeout(r, 4_000));
    result = await tryOnce();
  }
  return result;
}

export async function runSmokeSuite<TBody>(
  suiteName: string,
  cases: SmokeCase<TBody>[],
  options: { interMs?: number } = {},
): Promise<{ passed: number; failed: number }> {
  const interMs = options.interMs ?? 2_500;
  console.log(`[${suiteName}] base=${SMOKE_BASE}`);
  console.log(`[${suiteName}] 模拟 ${cases.length} 个真实用户场景`);
  console.log(
    `[${suiteName}] rate-limit bypass: ${SMOKE_BYPASS_TOKEN ? '✓ 已启用' : '✗ 未启用'}\n`,
  );
  let passed = 0;
  let failed = 0;
  const failures: Array<{ name: string; error: string; reply: string }> = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`▶ ${c.name.padEnd(38, ' ')}`);
    const start = Date.now();
    const result = await runSmokeCase(c);
    const elapsed = Date.now() - start;
    if (result.ok) {
      passed += 1;
      console.log(`✓ (${elapsed}ms)`);
      console.log(`    ${result.reply.slice(0, 110).replace(/\n/g, ' ')}…\n`);
    } else {
      failed += 1;
      console.log(`✗ (${elapsed}ms)`);
      console.log(`    描述: ${c.description}`);
      console.log(`    失败原因: ${result.error}`);
      console.log(`    AI 完整回复:`);
      console.log(`    ${'─'.repeat(60)}`);
      const lines = result.reply.split('\n').slice(0, 25);
      lines.forEach((l) => console.log(`    | ${l}`));
      console.log(`    ${'─'.repeat(60)}\n`);
      failures.push({ name: c.name, error: result.error ?? '', reply: result.reply });
    }
    if (i < cases.length - 1) {
      await new Promise((r) => setTimeout(r, interMs));
    }
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `${passed === cases.length ? '✓' : '✗'} [${suiteName}] ${passed}/${cases.length} passed${failed > 0 ? `, ${failed} failed` : ''}`,
  );
  console.log(`${'='.repeat(60)}\n`);
  if (failures.length > 0) {
    console.log('失败 case 摘要：');
    failures.forEach((f) => console.log(`  · ${f.name}: ${f.error}`));
  }
  return { passed, failed };
}

/** 把 SmokeTurn[] 转成 /api/tutor/agent 期望的 messages 格式 */
export function turnsToMessages(turns: SmokeTurn[]): Array<{ id: string; role: string; parts: Array<{ type: string; text: string }> }> {
  return turns.map((t) => ({
    id: Math.random().toString(36).slice(2, 10),
    role: t.role,
    parts: [{ type: 'text', text: t.content }],
  }));
}

export function newSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
