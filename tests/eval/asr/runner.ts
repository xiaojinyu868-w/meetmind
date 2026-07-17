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
//   ASR_MODEL         — 默认 qwen3-asr-flash-filetrans-2025-11-17
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { computeCer, type CerResult } from './graders/cer';
import {
  computeDiarizationErrorRate,
  type DiarizationResult,
  type SpeakerSegment,
} from './graders/diarization';

// ES-module 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AsrCase {
  id: string;
  /** 公网 URL 或相对仓库根目录的本地音频路径。--dry-run 下可省略 */
  audio?: string;
  /** 原始音频时长；真实评测据此计算 real-time factor。 */
  audioDurationMs?: number;
  /** 标注 ground truth */
  reference: string;
  /** 仅用于 --dry-run / regression pinning：直接喂假 hyp，跳过 ASR 调用 */
  hypothesis?: string;
  /** 可选人工说话人时间轴；声纹编号只表示同一人，不要求与 hypothesis 编号相同。 */
  referenceSpeakers?: SpeakerSegment[];
  /** 仅用于 dry-run 的冻结说话人结果。 */
  hypothesisSpeakers?: SpeakerSegment[];
  /** 标签用于聚合（noise-level / language / speaker-count 等） */
  tags?: string[];
  /** 可选 context；仅供支持上下文增强的 caller 使用，filetrans 不消费。 */
  context?: string;
  /** 语言：zh / en / auto */
  language?: 'zh' | 'en' | 'auto';
  /** 该 case 参与的指标；省略时默认为 CER。 */
  metrics?: Array<'cer' | 'diarization'>;
}

export interface RunnerOptions {
  datasetDir: string;
  runsDir: string;
  dryRun?: boolean;
  realRun?: boolean;
  filterId?: string;
  model?: string;
}

export interface AsrEvalResult {
  id: string;
  reference: string;
  hypothesis: string;
  cer: CerResult;
  durationMs: number;
  audioDurationMs?: number;
  realTimeFactor?: number;
  /** realtime 模式：首个非空 interim/final 相对首帧音频的时间。 */
  firstPartialMs?: number;
  /** realtime 模式：音频最后一帧发完后，最后一条 final 到达的时间。 */
  finalLagMs?: number;
  diarization?: DiarizationResult;
  error?: string;
  tags?: string[];
  metrics?: Array<'cer' | 'diarization'>;
}

export function loadCases(
  datasetDir: string,
  filterId?: string,
  mode: 'dry' | 'real' = 'dry',
): AsrCase[] {
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
        // dry-run 只评估冻结 hypothesis；真实模式只评估真的有音频的 case。
        // 这样 seed 文本回归与昂贵的真实音频回归可以共存于同一目录，
        // 不会再出现 make eval-asr-real 把所有无音频 seed 记成 100% CER。
        if (mode === 'dry' && c.hypothesis === undefined) continue;
        if (mode === 'real' && !c.audio) continue;
        cases.push(c);
      } catch (err) {
        console.warn(`[asr-eval] bad line in ${f}: ${l.slice(0, 60)}… — ${(err as Error).message}`);
      }
    }
  }
  return cases;
}

// ASR caller 抽象 —— M1 先提供 dryRun stub；M2 里会注入真实的 Qwen ASR 客户端
export interface AsrCallerResponse {
  hypothesis: string;
  durationMs: number;
  firstPartialMs?: number;
  finalLagMs?: number;
  speakerSegments?: SpeakerSegment[];
}

export interface AsrCaller {
  (c: AsrCase): Promise<AsrCallerResponse>;
}

export async function dryRunCaller(c: AsrCase): Promise<AsrCallerResponse> {
  if (c.hypothesis === undefined) {
    throw new Error(`[asr-eval] dry-run requires case.hypothesis field (case=${c.id})`);
  }
  return { hypothesis: c.hypothesis, durationMs: 0, speakerSegments: c.hypothesisSpeakers };
}

export async function runEval(opts: RunnerOptions, caller: AsrCaller = dryRunCaller): Promise<AsrEvalResult[]> {
  const cases = loadCases(opts.datasetDir, opts.filterId, opts.realRun ? 'real' : 'dry');
  if (cases.length === 0) {
    console.log('[asr-eval] no cases found');
    return [];
  }

  const results: AsrEvalResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const { hypothesis, durationMs, firstPartialMs, finalLagMs, speakerSegments } = await caller(c);
      const cer = computeCer(c.reference, hypothesis);
      const diarization = c.referenceSpeakers && speakerSegments
        ? computeDiarizationErrorRate(c.referenceSpeakers, speakerSegments)
        : undefined;
      const realTimeFactor = c.audioDurationMs && c.audioDurationMs > 0
        ? durationMs / c.audioDurationMs
        : undefined;
      results.push({
        id: c.id,
        reference: c.reference,
        hypothesis,
        cer,
        durationMs,
        audioDurationMs: c.audioDurationMs,
        realTimeFactor,
        firstPartialMs,
        finalLagMs,
        diarization,
        tags: c.tags,
        metrics: c.metrics,
      });
    } catch (err) {
      results.push({
        id: c.id,
        reference: c.reference,
        hypothesis: '',
        cer: { cer: 1, substitutions: 0, deletions: 0, insertions: 0, referenceLength: c.reference.length, hypothesisLength: 0, editDistance: c.reference.length },
        durationMs: Date.now() - started,
        audioDurationMs: c.audioDurationMs,
        error: (err as Error).message,
        tags: c.tags,
        metrics: c.metrics,
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
  cerCases: number;
  avgDurationMs: number;
  avgRealTimeFactor?: number;
  avgFirstPartialMs?: number;
  avgFinalLagMs?: number;
  avgDer?: number;
  diarizationCases: number;
  failed: number;
} {
  if (results.length === 0) {
    return { count: 0, avgCer: 0, p95Cer: 0, cerCases: 0, avgDurationMs: 0, diarizationCases: 0, failed: 0 };
  }
  const cerResults = results.filter((result) => !result.metrics || result.metrics.includes('cer'));
  const cers = cerResults.map((r) => r.cer.cer).sort((a, b) => a - b);
  const avg = cers.length > 0 ? cers.reduce((a, b) => a + b, 0) / cers.length : 0;
  const p95Idx = Math.min(cers.length - 1, Math.floor(cers.length * 0.95));
  const p95 = cers.length > 0 ? cers[p95Idx] : 0;
  const avgDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0) / results.length;
  const realTimeFactors = results
    .map((result) => result.realTimeFactor)
    .filter((value): value is number => Number.isFinite(value));
  const avgRealTimeFactor = realTimeFactors.length > 0
    ? realTimeFactors.reduce((sum, value) => sum + value, 0) / realTimeFactors.length
    : undefined;
  const firstPartials = results
    .map((result) => result.firstPartialMs)
    .filter((value): value is number => Number.isFinite(value));
  const finalLags = results
    .map((result) => result.finalLagMs)
    .filter((value): value is number => Number.isFinite(value));
  const avgFirstPartialMs = firstPartials.length > 0
    ? firstPartials.reduce((sum, value) => sum + value, 0) / firstPartials.length
    : undefined;
  const avgFinalLagMs = finalLags.length > 0
    ? finalLags.reduce((sum, value) => sum + value, 0) / finalLags.length
    : undefined;
  const diarizationResults = results
    .map((result) => result.diarization)
    .filter((value): value is DiarizationResult => Boolean(value));
  const avgDer = diarizationResults.length > 0
    ? diarizationResults.reduce((sum, value) => sum + value.der, 0) / diarizationResults.length
    : undefined;
  const failed = results.filter((result) => (
    result.error
    || ((!result.metrics || result.metrics.includes('cer')) && result.cer.cer > 0.3)
    || (result.metrics?.includes('diarization') && (result.diarization?.der ?? 0) > 0.3)
  )).length;
  return {
    count: results.length,
    avgCer: avg,
    p95Cer: p95,
    cerCases: cerResults.length,
    avgDurationMs,
    avgRealTimeFactor,
    avgFirstPartialMs,
    avgFinalLagMs,
    avgDer,
    diarizationCases: diarizationResults.length,
    failed,
  };
}

export function summarizeByTag(results: AsrEvalResult[]): Record<string, ReturnType<typeof summarize>> {
  const byTag = new Map<string, AsrEvalResult[]>();
  for (const result of results) {
    for (const tag of result.tags ?? []) {
      const tagged = byTag.get(tag) ?? [];
      tagged.push(result);
      byTag.set(tag, tagged);
    }
  }
  return Object.fromEntries(
    [...byTag.entries()].map(([tag, taggedResults]) => [tag, summarize(taggedResults)]),
  );
}

// CLI entry
async function main() {
  // 与产品 server.js 使用同一优先级：本机覆盖优先，其次项目默认环境。
  // 已存在的 shell 环境变量不会被覆盖，CI 仍可显式注入测试 Key。
  const projectRoot = resolve(__dirname, '../../..');
  loadEnv({ path: join(projectRoot, '.env.local'), quiet: true });
  loadEnv({ path: join(projectRoot, '.env'), quiet: true });
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const realRun = argv.includes('--real');
  const idIdx = argv.indexOf('--id');
  const filterId = idIdx >= 0 ? argv[idIdx + 1] : undefined;

  const opts: RunnerOptions = {
    datasetDir: resolve(__dirname, 'datasets'),
    runsDir: resolve(__dirname, 'runs'),
    dryRun,
    realRun,
    filterId,
    model: process.env.ASR_MODEL ?? process.env.DASHSCOPE_ASR_FILE_MODEL ?? 'qwen3-asr-flash-filetrans-2025-11-17',
  };

  let caller: AsrCaller = dryRunCaller;

  if (realRun) {
    if (!process.env.DASHSCOPE_API_KEY) {
      console.error('[asr-eval] --real requires DASHSCOPE_API_KEY');
      process.exit(2);
    }
    const { qwenAsyncCaller } = await import('./qwen-caller');
    caller = qwenAsyncCaller;
    opts.dryRun = false;
  } else if (!dryRun) {
    console.warn('[asr-eval] no mode specified; defaulting to --dry-run. Use --real to call Qwen ASR.');
    opts.dryRun = true;
  }

  const started = Date.now();
  const results = await runEval(opts, caller);
  const summary = summarize(results);
  const durationMs = Date.now() - started;

  console.log(
    `[asr-eval] ${summary.count} case(s) | avg_cer=${(summary.avgCer * 100).toFixed(2)}% | p95_cer=${(summary.p95Cer * 100).toFixed(2)}% | cer_cases=${summary.cerCases} | avg_der=${summary.avgDer !== undefined ? `${(summary.avgDer * 100).toFixed(2)}%` : 'n/a'} | diarization_cases=${summary.diarizationCases} | avg_api=${Math.round(summary.avgDurationMs)}ms | avg_rtf=${summary.avgRealTimeFactor?.toFixed(3) ?? 'n/a'} | first_partial=${summary.avgFirstPartialMs !== undefined ? `${Math.round(summary.avgFirstPartialMs)}ms` : 'n/a'} | final_lag=${summary.avgFinalLagMs !== undefined ? `${Math.round(summary.avgFinalLagMs)}ms` : 'n/a'} | failed=${summary.failed} | ${durationMs}ms`,
  );
  const byTag = summarizeByTag(results);
  for (const tag of Object.keys(byTag).sort()) {
    const tagged = byTag[tag];
    console.log(
      `[asr-eval:${tag}] n=${tagged.count} | avg_cer=${(tagged.avgCer * 100).toFixed(2)}% | avg_der=${tagged.avgDer !== undefined ? `${(tagged.avgDer * 100).toFixed(2)}%` : 'n/a'} | avg_rtf=${tagged.avgRealTimeFactor?.toFixed(3) ?? 'n/a'} | first_partial=${tagged.avgFirstPartialMs !== undefined ? `${Math.round(tagged.avgFirstPartialMs)}ms` : 'n/a'} | final_lag=${tagged.avgFinalLagMs !== undefined ? `${Math.round(tagged.avgFinalLagMs)}ms` : 'n/a'}`,
    );
  }
  if (results.some((r) => r.error)) process.exit(1);
}

// 仅当作为脚本直接执行时跑 main
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[asr-eval] fatal:', err);
    process.exit(1);
  });
}
