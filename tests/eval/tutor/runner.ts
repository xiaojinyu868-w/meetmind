// Tutor Runner
// 跑 datasets/*.jsonl 下的 case，调 Tutor agent loop（Vercel AI SDK），
// 用三个 grader 评估：tool-selection / timestamp-citation / learning-rubric。
//
// Usage:
//   npx tsx tests/eval/tutor/runner.ts --dry-run   # 用 fixture，不调真 LLM
//   npx tsx tests/eval/tutor/runner.ts --id foo    # 单条
//   npx tsx tests/eval/tutor/runner.ts             # 全量（要求 OPENAI_API_KEY）
//
// M1 只提供 dry-run 骨架，M3 接入真实 streamText。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeToolSelection, type ToolCall } from './graders/tool-selection';
import { gradeTimestampCitation } from './graders/timestamp-citation';
import { gradeLearningRubric } from './graders/learning-rubric';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TutorCase {
  id: string;
  question: string;
  transcriptFixture?: string;

  expectedTool?: string;
  toolMode?: 'exact' | 'contains' | 'none';
  expectedWindow?: { start: number; end: number };
  requireCitation?: boolean;
  rubric?: string;
  referenceAnswer?: string;

  // --dry-run 用
  stubOutput?: string;
  stubToolCalls?: ToolCall[];
}

export interface TutorRunResult {
  id: string;
  output: string;
  toolCalls: ToolCall[];
  scores: {
    toolSelection?: { pass: boolean; score: number; reason: string };
    timestampCitation?: { pass: boolean; score: number; reason: string };
    learningRubric?: { pass: boolean; score: number; reason: string };
  };
  pass: boolean;
  durationMs: number;
  error?: string;
}

export interface TutorCaller {
  (c: TutorCase): Promise<{ output: string; toolCalls: ToolCall[] }>;
}

export async function dryRunTutorCaller(c: TutorCase): Promise<{
  output: string;
  toolCalls: ToolCall[];
}> {
  if (c.stubOutput === undefined) {
    throw new Error(`[tutor-eval] dry-run requires stubOutput (case=${c.id})`);
  }
  return {
    output: c.stubOutput,
    toolCalls: c.stubToolCalls ?? [],
  };
}

function loadCases(datasetDir: string, filterId?: string): TutorCase[] {
  if (!existsSync(datasetDir)) return [];
  const files = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
  const cases: TutorCase[] = [];
  for (const f of files) {
    const raw = readFileSync(join(datasetDir, f), 'utf-8');
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const c = JSON.parse(l) as TutorCase;
        if (filterId && c.id !== filterId) continue;
        cases.push(c);
      } catch (err) {
        console.warn(`[tutor-eval] bad line in ${f}: ${(err as Error).message}`);
      }
    }
  }
  return cases;
}

export async function runTutorEval(opts: {
  datasetDir: string;
  runsDir: string;
  filterId?: string;
  caller?: TutorCaller;
}): Promise<TutorRunResult[]> {
  const cases = loadCases(opts.datasetDir, opts.filterId);
  if (cases.length === 0) {
    console.log('[tutor-eval] no cases found');
    return [];
  }

  const caller = opts.caller ?? dryRunTutorCaller;
  const results: TutorRunResult[] = [];

  for (const c of cases) {
    const started = Date.now();
    try {
      const { output, toolCalls } = await caller(c);

      const scores: TutorRunResult['scores'] = {};
      const passes: boolean[] = [];

      if (c.expectedTool !== undefined || c.toolMode) {
        const r = gradeToolSelection(toolCalls, { id: c.id, question: c.question, expectedTool: c.expectedTool, mode: c.toolMode });
        scores.toolSelection = { pass: r.pass, score: r.score, reason: r.reason };
        passes.push(r.pass);
      }

      if (c.expectedWindow) {
        const r = gradeTimestampCitation(output, {
          id: c.id,
          question: c.question,
          expectedWindow: c.expectedWindow,
          requireAtLeastOne: c.requireCitation ?? true,
        });
        scores.timestampCitation = { pass: r.pass, score: r.score, reason: r.reason };
        passes.push(r.pass);
      }

      if (c.rubric) {
        const r = await gradeLearningRubric(output, {
          id: c.id,
          question: c.question,
          rubric: c.rubric,
          referenceAnswer: c.referenceAnswer,
        });
        scores.learningRubric = { pass: r.pass, score: r.score, reason: r.reason };
        passes.push(r.pass);
      }

      results.push({
        id: c.id,
        output,
        toolCalls,
        scores,
        pass: passes.length === 0 ? true : passes.every(Boolean),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      results.push({
        id: c.id,
        output: '',
        toolCalls: [],
        scores: {},
        pass: false,
        durationMs: Date.now() - started,
        error: (err as Error).message,
      });
    }
  }

  if (!existsSync(opts.runsDir)) mkdirSync(opts.runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(opts.runsDir, `${ts}.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  return results;
}

export function summarizeTutor(results: TutorRunResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const byMetric = {
    toolSelection: results.filter((r) => r.scores.toolSelection).map((r) => r.scores.toolSelection!.pass),
    timestampCitation: results.filter((r) => r.scores.timestampCitation).map((r) => r.scores.timestampCitation!.pass),
    learningRubric: results.filter((r) => r.scores.learningRubric).map((r) => r.scores.learningRubric!.pass),
  };
  return {
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    toolSelectionPassRate: byMetric.toolSelection.length === 0 ? null : byMetric.toolSelection.filter(Boolean).length / byMetric.toolSelection.length,
    citationPassRate: byMetric.timestampCitation.length === 0 ? null : byMetric.timestampCitation.filter(Boolean).length / byMetric.timestampCitation.length,
    rubricPassRate: byMetric.learningRubric.length === 0 ? null : byMetric.learningRubric.filter(Boolean).length / byMetric.learningRubric.length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const realRun = argv.includes('--real');
  const idIdx = argv.indexOf('--id');
  const filterId = idIdx >= 0 ? argv[idIdx + 1] : undefined;

  const opts = {
    datasetDir: resolve(__dirname, 'datasets'),
    runsDir: resolve(__dirname, 'runs'),
    filterId,
    caller: dryRunTutorCaller as TutorCaller,
  };

  if (realRun) {
    if (!process.env.OPENAI_API_KEY && !process.env.DASHSCOPE_API_KEY) {
      console.error('[tutor-eval] --real requires OPENAI_API_KEY or DASHSCOPE_API_KEY');
      process.exit(2);
    }
    const { realTutorCaller } = await import('./real-caller');
    opts.caller = realTutorCaller;
  } else if (!dryRun) {
    console.warn('[tutor-eval] no mode specified; defaulting to --dry-run. Use --real to call LLM.');
  }

  const started = Date.now();
  const results = await runTutorEval(opts);
  const summary = summarizeTutor(results);
  const durationMs = Date.now() - started;

  const fmt = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  console.log(
    `[tutor-eval] ${summary.passed}/${summary.total} passed | ` +
      `tool=${fmt(summary.toolSelectionPassRate)} ` +
      `cite=${fmt(summary.citationPassRate)} ` +
      `rubric=${fmt(summary.rubricPassRate)} | ${durationMs}ms`,
  );
  if (realRun && summary.passRate < 1) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[tutor-eval] fatal:', err);
    process.exit(1);
  });
}
