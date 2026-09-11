/**
 * Harness regression guard (M5 T5.7)
 *
 * 读取 tests/eval/baselines/{asr,tutor,teach}.json 作为"应达到的下限"，
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
 *   - Teach: pass rate 与判分准确率（gradingAccuracy，逐题 score 平均）
 *     均不能低于 baseline - 0.05（5pp 容忍）
 *   - Apps（测验 / 闪卡产物质量，2026-09-11）: pass rate 与 avgScore（软硬项通过比例平均）
 *     均不能低于 baseline - 0.05（5pp 容忍）；dry-run 用冻结的模型输出，测的是生产后处理 + 产物契约
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

interface TeachBaseline {
  passRate: number;
  loopPassRate: number | null;
  /** 判分准确率：各 case gradingAccuracy score 平均（保留粒度，不是 pass 率） */
  gradingAccuracy: number | null;
  updatedAt: string;
}

interface AppsBaseline {
  passRate: number;
  quizPassRate: number | null;
  flashcardsPassRate: number | null;
  /** 各 case 软硬项通过比例的平均（有梯度的数，软项退化也看得见） */
  avgScore: number | null;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────
// 配置：baseline 文件与容忍度
// ──────────────────────────────────────────────────────────────

const BASELINES_DIR = resolve(__dirname, 'baselines');
const ASR_BASELINE_FILE = resolve(BASELINES_DIR, 'asr.json');
const TUTOR_BASELINE_FILE = resolve(BASELINES_DIR, 'tutor.json');
const TEACH_BASELINE_FILE = resolve(BASELINES_DIR, 'teach.json');
const APPS_BASELINE_FILE = resolve(BASELINES_DIR, 'apps.json');

const ASR_RUNS_DIR = resolve(__dirname, 'asr', 'runs');
const TUTOR_RUNS_DIR = resolve(__dirname, 'tutor', 'runs');
const TEACH_RUNS_DIR = resolve(__dirname, 'teach', 'runs');
const APPS_RUNS_DIR = resolve(__dirname, 'apps', 'runs');

const ASR_CER_TOLERANCE = 1.1; // current <= baseline * 1.1
const TUTOR_PASS_TOLERANCE = 0.05; // current >= baseline - 0.05
const TEACH_PASS_TOLERANCE = 0.05; // current >= baseline - 0.05（passRate 与 gradingAccuracy 同容忍）
const APPS_PASS_TOLERANCE = 0.05; // current >= baseline - 0.05（passRate 与 avgScore 同容忍）

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

interface TeachRecord {
  id: string;
  pass: boolean;
  scores: {
    quizLoop?: { pass: boolean };
    gradingAccuracy?: { pass: boolean; score: number };
  };
}

interface AppsRecord {
  id: string;
  app: 'quiz' | 'flashcards';
  pass: boolean;
  score: number;
}

function summarizeApps(records: AppsRecord[]): AppsBaseline | null {
  if (records.length === 0) return null;
  const rate = (items: AppsRecord[]) => (items.length === 0 ? null : items.filter((r) => r.pass).length / items.length);
  return {
    passRate: records.filter((r) => r.pass).length / records.length,
    quizPassRate: rate(records.filter((r) => r.app === 'quiz')),
    flashcardsPassRate: rate(records.filter((r) => r.app === 'flashcards')),
    avgScore: records.reduce((sum, r) => sum + (Number.isFinite(r.score) ? r.score : 0), 0) / records.length,
    updatedAt: new Date().toISOString(),
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

function summarizeTeach(records: TeachRecord[]): TeachBaseline | null {
  if (records.length === 0) return null;
  const total = records.length;
  const passed = records.filter((r) => r.pass).length;
  const loopFlags = records
    .filter((r) => r.scores.quizLoop)
    .map((r) => r.scores.quizLoop!.pass);
  const gradingScores = records
    .filter((r) => r.scores.gradingAccuracy)
    .map((r) => r.scores.gradingAccuracy!.score);
  return {
    passRate: passed / total,
    loopPassRate:
      loopFlags.length === 0 ? null : loopFlags.filter(Boolean).length / loopFlags.length,
    gradingAccuracy:
      gradingScores.length === 0
        ? null
        : gradingScores.reduce((a, b) => a + b, 0) / gradingScores.length,
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

  // ─ Teach
  const teachRuns = await readLatestRun(TEACH_RUNS_DIR);
  if (!teachRuns) {
    report.push('[teach] no runs found; skipping (run `make eval-teach` first)');
  } else {
    const current = summarizeTeach(teachRuns as TeachRecord[]);
    const baseline = await readBaseline<TeachBaseline>(TEACH_BASELINE_FILE);
    const fmt = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

    if (!current) {
      report.push('[teach] empty run file');
    } else if (update || !baseline) {
      writeBaseline(TEACH_BASELINE_FILE, current);
      report.push(
        `[teach] ${baseline ? 'updated' : 'created'} baseline → pass=${fmt(current.passRate)} | grading-accuracy ${fmt(current.gradingAccuracy)}`,
      );
    } else {
      const passOk = current.passRate >= baseline.passRate - TEACH_PASS_TOLERANCE;
      const gradingOk =
        current.gradingAccuracy === null ||
        baseline.gradingAccuracy === null ||
        current.gradingAccuracy >= baseline.gradingAccuracy - TEACH_PASS_TOLERANCE;
      const mark = passOk && gradingOk ? '✓' : '✗';
      report.push(
        `[teach] ${mark} pass ${fmt(current.passRate)} (baseline ${fmt(baseline.passRate)} - ${TEACH_PASS_TOLERANCE * 100}pp) | grading-accuracy ${fmt(current.gradingAccuracy)} (baseline ${fmt(baseline.gradingAccuracy)} - ${TEACH_PASS_TOLERANCE * 100}pp)`,
      );
      if (!passOk || !gradingOk) exitCode = 1;
    }
  }

  // ─ Apps（测验 / 闪卡产物质量）
  const appsRuns = await readLatestRun(APPS_RUNS_DIR);
  if (!appsRuns) {
    report.push('[apps] no runs found; skipping (run `make eval-apps` first)');
  } else {
    const current = summarizeApps(appsRuns as AppsRecord[]);
    const baseline = await readBaseline<AppsBaseline>(APPS_BASELINE_FILE);
    const fmt = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

    if (!current) {
      report.push('[apps] empty run file');
    } else if (update || !baseline) {
      writeBaseline(APPS_BASELINE_FILE, current);
      report.push(
        `[apps] ${baseline ? 'updated' : 'created'} baseline → pass=${fmt(current.passRate)} | avg-score ${fmt(current.avgScore)}`,
      );
    } else {
      const passOk = current.passRate >= baseline.passRate - APPS_PASS_TOLERANCE;
      const scoreOk =
        current.avgScore === null ||
        baseline.avgScore === null ||
        current.avgScore >= baseline.avgScore - APPS_PASS_TOLERANCE;
      const mark = passOk && scoreOk ? '✓' : '✗';
      report.push(
        `[apps] ${mark} pass ${fmt(current.passRate)} (baseline ${fmt(baseline.passRate)} - ${APPS_PASS_TOLERANCE * 100}pp) | avg-score ${fmt(current.avgScore)} (baseline ${fmt(baseline.avgScore)} - ${APPS_PASS_TOLERANCE * 100}pp)`,
      );
      if (!passOk || !scoreOk) exitCode = 1;
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
