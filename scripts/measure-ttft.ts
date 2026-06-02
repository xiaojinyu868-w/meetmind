#!/usr/bin/env npx tsx
/**
 * measure-ttft.ts —— First Token Latency 测量（M13）
 *
 * 测量"用户感知的 TTFT"：从 client 发出 POST 到 client 收到第一个非空 text-delta
 * 帧的时间。这才是用户看到 AI 开始打字的真实延迟。
 *
 * 测量方法：
 *   - 4 个 mode 各 N=5 次（goal / review / in-class / shared）
 *   - 用稳定 SMOKE_BYPASS_TOKEN 跳过 rate limit
 *   - 记录 ttfb（首字节响应头到达）+ ttft（第一个非空 text token 到达）
 *   - 输出 p50 / p95 / mean / min / max + 每次明细
 *
 * Usage:
 *   make ttft           # 默认本地 3002 + N=5
 *   PORT=3002 N=10 npx tsx scripts/measure-ttft.ts
 *
 * 不测：
 *   - 总 token 速度（这个由模型决定，不是产品层能优化的）
 *   - thinking time（DeepSeek reasoning）—— 本项目 step/deepseek 都关 native tools
 *
 * 优化基线（M13 之前 vs 之后），见 CHANGELOG。
 */

import * as fs from 'node:fs';

const PORT = process.env.PORT || '3002';
const BASE = `http://localhost:${PORT}`;
const N = Number(process.env.N || '5');
const BYPASS = (() => {
  try {
    const env = fs.readFileSync('.env', 'utf-8');
    const m = env.match(/^SMOKE_BYPASS_TOKEN=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
})();

interface Sample {
  mode: string;
  ttfbMs: number; // 响应头到达
  ttftMs: number; // 第一个非空 text-delta 到达
  totalMs: number;
  status: number;
  bytes: number;
  ok: boolean;
  errorMsg?: string;
}

interface Stats {
  mode: string;
  n: number;
  p50: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
  ttfbP50: number;
  ttfbP95: number;
}

/** 计算分位数 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function fmtMs(ms: number): string {
  return ms.toFixed(0).padStart(5, ' ');
}

/** 单次调用并测量 */
async function measureOne(
  mode: 'goal' | 'review' | 'in-class' | 'shared',
  body: Record<string, unknown>,
): Promise<Sample> {
  const t0 = Date.now();
  let ttfbMs = 0;
  let ttftMs = 0;
  try {
    const response = await fetch(`${BASE}/api/tutor/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(BYPASS ? { 'X-Smoke-Bypass': BYPASS } : {}),
      },
      body: JSON.stringify(body),
    });
    ttfbMs = Date.now() - t0;
    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => '');
      return {
        mode,
        ttfbMs,
        ttftMs: -1,
        totalMs: Date.now() - t0,
        status: response.status,
        bytes: 0,
        ok: false,
        errorMsg: `HTTP ${response.status}: ${errBody.slice(0, 100)}`,
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    let firstTokenSeen = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.length ?? 0;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            textDelta?: string;
            text?: string;
          };
          // 第一个非空 text token 到达：那才是用户能"看到字"的瞬间
          const piece = parsed.delta ?? parsed.textDelta ?? parsed.text ?? '';
          if (!firstTokenSeen && typeof piece === 'string' && piece.length > 0) {
            ttftMs = Date.now() - t0;
            firstTokenSeen = true;
            // 不需要继续读，但读完才能正确关闭连接
          }
        } catch {
          /* 非 JSON 帧，忽略 */
        }
      }
      if (firstTokenSeen) {
        // 已经拿到首 token，主动 cancel 释放连接（不浪费上游 token 配额）
        try {
          await reader.cancel();
        } catch {
          /* noop */
        }
        break;
      }
    }
    return {
      mode,
      ttfbMs,
      ttftMs: firstTokenSeen ? ttftMs : -1,
      totalMs: Date.now() - t0,
      status: response.status,
      bytes,
      ok: firstTokenSeen,
      errorMsg: firstTokenSeen ? undefined : '未收到首 token',
    };
  } catch (err) {
    return {
      mode,
      ttfbMs,
      ttftMs: -1,
      totalMs: Date.now() - t0,
      status: 0,
      bytes: 0,
      ok: false,
      errorMsg: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 4 个 mode 的请求 body 模板 */
function buildBody(
  mode: 'goal' | 'review' | 'in-class' | 'shared',
  iter: number,
): Record<string, unknown> {
  const sessionId = `ttft-${mode}-${Date.now()}-${iter}`;
  const userMsg = {
    id: Math.random().toString(36).slice(2, 10),
    role: 'user',
    parts: [{ type: 'text', text: '你好' }],
  };
  const baseBody = {
    sessionId,
    transcript: [],
    context: {},
    options: {},
    messages: [userMsg],
  };
  if (mode === 'goal') {
    return { ...baseBody, mode: 'goal' };
  }
  if (mode === 'review') {
    return {
      ...baseBody,
      mode: 'review',
      transcript: [
        { id: 's1', text: '今天我们学习快速排序算法。', startMs: 0, endMs: 5000 },
        { id: 's2', text: '快排的核心是分治和 partition。', startMs: 5000, endMs: 12000 },
      ],
      context: {
        learnerProfile: '【这个学生】大三计算机学生，正在准备考研。',
      },
    };
  }
  if (mode === 'in-class') {
    return {
      ...baseBody,
      mode: 'in-class',
      context: {
        recentFocus: '老师在讲 partition 双指针的实现细节。',
      },
    };
  }
  // shared
  return {
    ...baseBody,
    mode: 'shared',
    shareToken: 'smoke-shared-test', // smoke-shared 已经 seed 过的 fake share
    options: {
      allowInlineApp: false,
      returnTimestamps: false,
    },
  };
}

async function runMode(mode: 'goal' | 'review' | 'in-class' | 'shared'): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < N; i++) {
    process.stdout.write(`  ${mode.padEnd(9)} #${i + 1}/${N} ... `);
    const body = buildBody(mode, i);
    const s = await measureOne(mode, body);
    samples.push(s);
    if (s.ok) {
      console.log(`✓ ttfb=${fmtMs(s.ttfbMs)}ms ttft=${fmtMs(s.ttftMs)}ms`);
    } else {
      console.log(`✗ ${s.errorMsg ?? 'unknown'}`);
    }
    // 单 mode case 之间留 800ms（防 LLM provider 连续请求 outputTokens=0）
    await new Promise((r) => setTimeout(r, 800));
  }
  return samples;
}

function aggregate(samples: Sample[]): Stats | null {
  const ok = samples.filter((s) => s.ok && s.ttftMs > 0);
  if (ok.length === 0) return null;
  const ttfts = ok.map((s) => s.ttftMs);
  const ttfbs = ok.map((s) => s.ttfbMs);
  return {
    mode: ok[0].mode,
    n: ok.length,
    p50: percentile(ttfts, 0.5),
    p95: percentile(ttfts, 0.95),
    mean: ttfts.reduce((a, b) => a + b, 0) / ok.length,
    min: Math.min(...ttfts),
    max: Math.max(...ttfts),
    ttfbP50: percentile(ttfbs, 0.5),
    ttfbP95: percentile(ttfbs, 0.95),
  };
}

(async () => {
  console.log(`[ttft] base=${BASE} · N=${N} · bypass=${BYPASS ? '✓' : '✗'}`);
  console.log('');
  const allSamples: Sample[] = [];
  const allStats: Stats[] = [];

  for (const mode of ['goal', 'review', 'in-class', 'shared'] as const) {
    console.log(`▶ ${mode}`);
    const samples = await runMode(mode);
    allSamples.push(...samples);
    const stats = aggregate(samples);
    if (stats) allStats.push(stats);
    console.log('');
  }

  // 汇总表
  console.log('━'.repeat(78));
  console.log('TTFT 汇总（首 token 延迟，毫秒）');
  console.log('━'.repeat(78));
  console.log(
    `${'mode'.padEnd(11)}${'n'.padStart(4)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'mean'.padStart(8)}${'min'.padStart(8)}${'max'.padStart(8)}${'ttfb-p50'.padStart(11)}${'ttfb-p95'.padStart(11)}`,
  );
  for (const s of allStats) {
    console.log(
      `${s.mode.padEnd(11)}${String(s.n).padStart(4)}${fmtMs(s.p50).padStart(8)}${fmtMs(s.p95).padStart(8)}${fmtMs(s.mean).padStart(8)}${fmtMs(s.min).padStart(8)}${fmtMs(s.max).padStart(8)}${fmtMs(s.ttfbP50).padStart(11)}${fmtMs(s.ttfbP95).padStart(11)}`,
    );
  }
  console.log('━'.repeat(78));

  // overall
  const okAll = allSamples.filter((s) => s.ok);
  if (okAll.length > 0) {
    const allTtfts = okAll.map((s) => s.ttftMs);
    console.log(
      `OVERALL    ${String(okAll.length).padStart(3)}${fmtMs(percentile(allTtfts, 0.5)).padStart(8)}${fmtMs(percentile(allTtfts, 0.95)).padStart(8)}${fmtMs(allTtfts.reduce((a, b) => a + b, 0) / okAll.length).padStart(8)}${fmtMs(Math.min(...allTtfts)).padStart(8)}${fmtMs(Math.max(...allTtfts)).padStart(8)}`,
    );
  }
  const failed = allSamples.length - okAll.length;
  if (failed > 0) {
    console.log(`\n  ⚠ ${failed} 次失败`);
    allSamples
      .filter((s) => !s.ok)
      .forEach((s) => console.log(`    · ${s.mode}: ${s.errorMsg ?? 'unknown'}`));
  }

  // 保存到 .codebuddy/ttft-history.jsonl 供历史对比
  try {
    const ts = new Date().toISOString();
    const historyDir = '.codebuddy';
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    const line = JSON.stringify({
      ts,
      port: PORT,
      n: N,
      stats: allStats.map((s) => ({
        mode: s.mode,
        p50: Math.round(s.p50),
        p95: Math.round(s.p95),
        mean: Math.round(s.mean),
      })),
    });
    fs.appendFileSync(`${historyDir}/ttft-history.jsonl`, line + '\n');
    console.log(`\n  📝 已记录到 .codebuddy/ttft-history.jsonl`);
  } catch {
    /* 历史文件不重要，失败忽略 */
  }

  process.exit(0);
})();
