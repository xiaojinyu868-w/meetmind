// ASR Runner
// 串行跑 datasets 下的 JSONL cases，对每条 case:
//   1. 调 ASR transcriber (DashScope Qwen3-ASR-Flash) 或跳过（dry-run 模式下用 fixture 的 hyp）
//   2. 归一化 + 计算 CER
//   3. 汇总 + 写结果 JSONL 到 runs/
//
// Usage:
//   npx tsx tests/eval/asr/runner.ts               # 全量
//   npx tsx tests/eval/asr/runner.ts --id foo-01   # 单条
//   npx tsx tests/eval/asr/runner.ts --dry-run     # 用 case.hypothesis 字段，不调真实 API
//
// 环境变量：
//   DASHSCOPE_API_KEY — 必须（除非 --dry-run）
//   ASR_MODEL         — 默认 qwen3-asr-flash
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCer, type CerResult } from './graders/cer';

// ES-module 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AsrCase {
  id: string;
  /** 相对 runner 的音频路径（fixture）。--dry-run 下可省略 */
  audio?: string;
  /** 标注 ground truth */
  reference: string;
  /** 仅用于 --dry-run / regression pinning：直接喂假 hyp，跳过 ASR 调用 */
  hypothesis?: string;
  /** 标签用于聚合（noise-level / language / speaker-count 等） */
  tags?: string[];
  /** 可选 context，注入到 Qwen3-ASR 的 parameters.context */
  context?: string;
  /** 语言：zh / en / auto */
  language?: 'zh' | 'en' | 'auto';
}

export interface RunnerOptions {
  datasetDir: string;
  runsDir: string;
  dryRun?: boolean;
  filterId?: string;
  model?: string;
}

export interface AsrEvalResult {
  id: string;
  reference: string;
  hypothesis: string;
  cer: CerResult;
  durationMs: number;
  error?: string;
  tags?: string[];
}

function loadCases(datasetDir: string, filterId?: string): AsrCase[] {
  if (!existsSync(datasetDir)) return [];
  const files = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
  const cases: AsrCase[] = [];
  for (const f of files) {
    const raw = readFileSync(join(datasetDir, f), 'utf-8');
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const c = JSON.parse(l) as AsrCase;
        if (filterId && c.id !== filterId) continue;
        cases.push(c);
      } catch (err) {
        console.warn(`[asr-eval] bad line in ${f}: ${l.slice(0, 60)}… — ${(err as Error).message}`);
      }
    }
  }
  return cases;
}

// ASR caller 抽象 —— M1 先提供 dryRun stub；M2 里会注入真实的 Qwen ASR 客户端
export interface AsrCaller {
  (c: AsrCase): Promise<{ hypothesis: string; durationMs: number }>;
}

export async function dryRunCaller(c: AsrCase): Promise<{ hypothesis: string; durationMs: number }> {
  if (c.hypothesis === undefined) {
    throw new Error(`[asr-eval] dry-run requires case.hypothesis field (case=${c.id})`);
  }
  return { hypothesis: c.hypothesis, durationMs: 0 };
}

export async function runEval(opts: RunnerOptions, caller: AsrCaller = dryRunCaller): Promise<AsrEvalResult[]> {
  const cases = loadCases(opts.datasetDir, opts.filterId);
  if (cases.length === 0) {
    console.log('[asr-eval] no cases found');
    return [];
  }

  const results: AsrEvalResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const { hypothesis, durationMs } = await caller(c);
      const cer = computeCer(c.reference, hypothesis);
      results.push({ id: c.id, reference: c.reference, hypothesis, cer, durationMs, tags: c.tags });
    } catch (err) {
      results.push({
        id: c.id,
        reference: c.reference,
        hypothesis: '',
        cer: { cer: 1, substitutions: 0, deletions: 0, insertions: 0, referenceLength: c.reference.length, hypothesisLength: 0, editDistance: c.reference.length },
        durationMs: Date.now() - started,
        error: (err as Error).message,
        tags: c.tags,
      });
    }
  }

  // 写结果
  if (!existsSync(opts.runsDir)) mkdirSync(opts.runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(opts.runsDir, `${ts}.jsonl`);
  writeFileSync(outFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  return results;
}

export function summarize(results: AsrEvalResult[]): {
  count: number;
  avgCer: number;
  p95Cer: number;
  failed: number;
} {
  if (results.length === 0) return { count: 0, avgCer: 0, p95Cer: 0, failed: 0 };
  const cers = results.map((r) => r.cer.cer).sort((a, b) => a - b);
  const avg = cers.reduce((a, b) => a + b, 0) / cers.length;
  const p95Idx = Math.min(cers.length - 1, Math.floor(cers.length * 0.95));
  const p95 = cers[p95Idx];
  const failed = results.filter((r) => r.error || r.cer.cer > 0.3).length;
  return { count: results.length, avgCer: avg, p95Cer: p95, failed };
}

// CLI entry
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const idIdx = argv.indexOf('--id');
  const filterId = idIdx >= 0 ? argv[idIdx + 1] : undefined;

  const opts: RunnerOptions = {
    datasetDir: resolve(__dirname, 'datasets'),
    runsDir: resolve(__dirname, 'runs'),
    dryRun,
    filterId,
    model: process.env.ASR_MODEL ?? 'qwen3-asr-flash',
  };

  if (!dryRun) {
    console.warn('[asr-eval] real ASR caller not wired in M1 — defaulting to --dry-run. Use M2 branch for real calls.');
    opts.dryRun = true;
  }

  const caller = dryRunCaller;
  const started = Date.now();
  const results = await runEval(opts, caller);
  const summary = summarize(results);
  const durationMs = Date.now() - started;

  console.log(
    `[asr-eval] ${summary.count} case(s) | avg_cer=${(summary.avgCer * 100).toFixed(2)}% | p95_cer=${(summary.p95Cer * 100).toFixed(2)}% | failed=${summary.failed} | ${durationMs}ms`,
  );
  // Non-zero exit code if any case errored out
  if (results.some((r) => r.error)) process.exit(1);
}

// 仅当作为脚本直接执行时跑 main
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[asr-eval] fatal:', err);
    process.exit(1);
  });
}
