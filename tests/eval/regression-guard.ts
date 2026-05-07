/**
 * Harness regression guard (M5 T5.7)
 *
 * 读取 tests/eval/{asr,tutor}/baselines/*.json 作为"应达到的下限"，
 * 跑完 harness 后对比当前数字，退化则非零退出码（CI 卡 PR）。
 *
 * 用法：
 *   1. 跑完 make eval-asr / make eval-tutor 后：
 *      npx tsx tests/eval/regression-guard.ts
 *   2. 认为当前数字 OK、要更新 baseline：
 *      npx tsx tests/eval/regression-guard.ts --update
 *
 * 判断规则：
 *   - ASR: 当前 avg_cer / p95_cer 不能超过 baseline * 1.1（10% 容忍）
 *   - Tutor: pass rate 不能低于 baseline - 0.05（5pp 容忍）
 */

import { writeFileSync, existsSync, readdirSync, mkdirSync, createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface AsrBaseline {
  avgCer: number;
  p95Cer: number;
  caseCount: number;
  updatedAt: string;
}

interface TutorBaseline {
  passRate: number;
  toolSelectionPassRate: number | null;
  citationPassRate: number | null;
  rubricPassRate: number | null;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────
// 配置：baseline 文件与容忍度
// ──────────────────────────────────────────────────────────────

const BASELINES_DIR = resolve(__dirname, 'baselines');
const ASR_BASELINE_FILE = resolve(BASELINES_DIR, 'asr.json');
const TUTOR_BASELINE_FILE = resolve(BASELINES_DIR, 'tutor.json');

const ASR_RUNS_DIR = resolve(__dirname, 'asr', 'runs');
const TUTOR_RUNS_DIR = resolve(__dirname, 'tutor', 'runs');

const ASR_CER_TOLERANCE = 1.1; // current <= baseline * 1.1
const TUTOR_PASS_TOLERANCE = 0.05; // current >= baseline - 0.05

// ──────────────────────────────────────────────────────────────
// 读 run 文件
// ──────────────────────────────────────────────────────────────

async function readLatestRun(dir: string): Promise<unknown[] | null> {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (files.length === 0) return null;

  // 流式读取 jsonl，避免大文件一次性 load 爆内存
  const records: unknown[] = [];
  const rl = createInterface({
    input: createReadStream(resolve(dir, files[0]), { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed));
  }
  return records;
}

// ──────────────────────────────────────────────────────────────
// 汇总当前数字
// ──────────────────────────────────────────────────────────────

interface AsrRecord {
  id: string;
  cer: { cer: number };
  error?: string;
}

interface TutorRecord {
  id: string;
  pass: boolean;
  scores: {
    toolSelection?: { pass: boolean };
    timestampCitation?: { pass: boolean };
    learningRubric?: { pass: boolean };
  };
}

function summarizeAsr(records: AsrRecord[]): AsrBaseline | null {
  if (records.length === 0) return null;
  const cers = records.map((r) => r.cer.cer).sort((a, b) => a - b);
  const avg = cers.reduce((a, b) => a + b, 0) / cers.length;
  const p95Idx = Math.min(cers.length - 1, Math.floor(cers.length * 0.95));
  return {
    avgCer: avg,
    p95Cer: cers[p95Idx],
    caseCount: records.length,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeTutor(records: TutorRecord[]): TutorBaseline | null {
  if (records.length === 0) return null;
  const total = records.length;
  const passed = records.filter((r) => r.pass).length;
  const pct = (arr: boolean[]) =>
    arr.length === 0 ? null : arr.filter(Boolean).length / arr.length;
  return {
    passRate: passed / total,
    toolSelectionPassRate: pct(
      records.filter((r) => r.scores.toolSelection).map((r) => r.scores.toolSelection!.pass),
    ),
    citationPassRate: pct(
      records
        .filter((r) => r.scores.timestampCitation)
        .map((r) => r.scores.timestampCitation!.pass),
    ),
    rubricPassRate: pct(
      records.filter((r) => r.scores.learningRubric).map((r) => r.scores.learningRubric!.pass),
    ),
    updatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// Baseline 读写
// ──────────────────────────────────────────────────────────────

async function readBaseline<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

function writeBaseline(path: string, data: unknown): void {
  if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  const update = process.argv.includes('--update');
  let exitCode = 0;
  const report: string[] = [];

  // ─ ASR
  const asrRuns = await readLatestRun(ASR_RUNS_DIR);
  if (!asrRuns) {
    report.push('[asr] no runs found; skipping (run `make eval-asr` first)');
  } else {
    const current = summarizeAsr(asrRuns as AsrRecord[]);
    const baseline = await readBaseline<AsrBaseline>(ASR_BASELINE_FILE);

    if (!current) {
      report.push('[asr] empty run file');
    } else if (update || !baseline) {
      writeBaseline(ASR_BASELINE_FILE, current);
      report.push(
        `[asr] ${baseline ? 'updated' : 'created'} baseline → avg=${(current.avgCer * 100).toFixed(2)}% p95=${(current.p95Cer * 100).toFixed(2)}% (${current.caseCount} cases)`,
      );
    } else {
      const avgOk = current.avgCer <= baseline.avgCer * ASR_CER_TOLERANCE;
      const p95Ok = current.p95Cer <= baseline.p95Cer * ASR_CER_TOLERANCE;
      const mark = avgOk && p95Ok ? '✓' : '✗';
      report.push(
        `[asr] ${mark} avg ${(current.avgCer * 100).toFixed(2)}% (baseline ${(baseline.avgCer * 100).toFixed(2)}% × ${ASR_CER_TOLERANCE}) | p95 ${(current.p95Cer * 100).toFixed(2)}% (baseline ${(baseline.p95Cer * 100).toFixed(2)}% × ${ASR_CER_TOLERANCE})`,
      );
      if (!avgOk || !p95Ok) exitCode = 1;
    }
  }

  // ─ Tutor
  const tutorRuns = await readLatestRun(TUTOR_RUNS_DIR);
  if (!tutorRuns) {
    report.push('[tutor] no runs found; skipping (run `make eval-tutor` first)');
  } else {
    const current = summarizeTutor(tutorRuns as TutorRecord[]);
    const baseline = await readBaseline<TutorBaseline>(TUTOR_BASELINE_FILE);

    if (!current) {
      report.push('[tutor] empty run file');
    } else if (update || !baseline) {
      writeBaseline(TUTOR_BASELINE_FILE, current);
      report.push(
        `[tutor] ${baseline ? 'updated' : 'created'} baseline → pass=${(current.passRate * 100).toFixed(1)}%`,
      );
    } else {
      const ok = current.passRate >= baseline.passRate - TUTOR_PASS_TOLERANCE;
      const mark = ok ? '✓' : '✗';
      report.push(
        `[tutor] ${mark} pass ${(current.passRate * 100).toFixed(1)}% (baseline ${(baseline.passRate * 100).toFixed(1)}% - ${TUTOR_PASS_TOLERANCE * 100}pp)`,
      );
      if (!ok) exitCode = 1;
    }
  }

  console.log(report.join('\n'));
  if (exitCode !== 0) {
    console.error('\n[regression-guard] ✗ baselines violated — run `npx tsx tests/eval/regression-guard.ts --update` after investigating');
  }
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[regression-guard] fatal:', err);
    process.exit(1);
  });
}
