// Teach Runner —— AI 家教「上课」线（teach-engine）的出题闭环 e2e 评测。
// 跑 datasets/*.jsonl 下的 case，每 case 建内存 stage + ActionEngine + AudioPacer，
// 每轮新 EngineRunner 喂入模型原始 DSL 输出，用两个 grader 评估：
// quiz-loop（闭环结构断言）/ grading-accuracy（判分准确率，门禁核心指标）。
//
// dry-run：case 带 stubOutput（冻结的模型输出），解析器/动作引擎/事件捕获全是
// 生产真件，只有模型输出冻结 —— 这就是出题 e2e。
// --real：走 real-caller.ts 直驱等效生产链路（loadTeachingSkills +
// buildTeachEngineInstructions + streamText），需 TEACH provider 的 key。
//
// Usage:
//   npx tsx tests/eval/teach/runner.ts --dry-run   # 默认，不调真 LLM
//   npx tsx tests/eval/teach/runner.ts --id foo    # 单条
//   npx tsx tests/eval/teach/runner.ts --real      # 真实链路
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionEngine } from '@/lib/services/teach-engine/vendor/openmaic/action/engine';
import { createThreadStageStore } from '@/lib/services/teach-engine/runtime/stage-store';
import { createBoardStores } from '@/lib/services/teach-engine/runtime/board-stores';
import { AudioPacer } from '@/lib/services/teach-engine/runtime/audio-pacer';
import { EngineRunner, type TurnSummary } from '@/lib/services/teach-engine/runtime/engine-runner';
import { gradeQuizLoop } from './graders/quiz-loop';
import {
  gradeGradingAccuracy,
  type GradeResult,
  type Verdict,
} from './graders/grading-accuracy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── case 与采集契约（grader 共用） ─────────────────────────────────────────

export interface TeachTurn {
  studentMessage: string;
  /** dry-run 用：冻结的模型原始输出（DSL JSON 数组字符串） */
  stubOutput?: string;
}

export interface TeachCaseExpect {
  /** 出题轮应出现的锚点（quiz_qN 稳定编号） */
  quizElementIds: string[];
  /** 判分轮期望判定，逐题 */
  verdicts: Verdict[];
  /** 出题轮是否要求 discussion 暂停（默认 false） */
  requireDiscussionPause?: boolean;
}

export interface TeachCase {
  id: string;
  topic: string;
  turns: TeachTurn[];
  expect: TeachCaseExpect;
}

export interface TurnEvent {
  kind: 'text-delta' | 'tool-call' | 'tool-result' | 'unknown';
  text?: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface TurnCapture {
  events: TurnEvent[];
  /** 该轮口播全文（text-delta 拼接） */
  speechText: string;
  summary: TurnSummary;
}

export interface TeachRunResult {
  id: string;
  turns: TurnCapture[];
  scores: {
    quizLoop?: GradeResult;
    gradingAccuracy?: GradeResult;
  };
  pass: boolean;
  durationMs: number;
  error?: string;
}

export type TeachCaller = (c: TeachCase) => Promise<TurnCapture[]>;

// ── 内存 harness：生产真件（解析器 + 动作引擎 + 估时 pacer），每 case 一套 ──

/** dry-run 喂入切块大小（字符）：模拟流式增量，顺带压测解析器切块边界。 */
const CHUNK_SIZE = 180;

export interface TeachTurnHandle {
  feed(delta: string): void;
  done(): Promise<TurnCapture>;
}

export function createTeachHarness(caseId: string) {
  // 词表全量（默认即全量；显式删掉防外部环境置 0 收回 V1 词表）
  delete process.env.TEACH_ACTIONS_FULL;
  const stage = createThreadStageStore(`teacheval_${caseId}`, () => {});
  const pacer = new AudioPacer({ speed: 10000 }); // 估时 pacing 拉满，eval 不等口播
  const engine = new ActionEngine(stage, pacer, null, createBoardStores());

  return {
    beginTurn(): TeachTurnHandle {
      const events: TurnEvent[] = [];
      const runner = new EngineRunner({
        engine,
        pacer,
        boardDigest: () => `板书 ${stage.whiteboard.elements.length} 个元素`,
        hooks: {
          onTextDelta: (text) => events.push({ kind: 'text-delta', text }),
          onToolCall: (c) => events.push({ kind: 'tool-call', id: c.id, name: c.name, args: c.args }),
          onToolResult: (id, result) => events.push({ kind: 'tool-result', id, result }),
          onUnknownAction: (name) => events.push({ kind: 'unknown', name }),
        },
      });
      return {
        feed: (delta) => runner.feedTextDelta(delta),
        done: async () => {
          const summary = await runner.finalize();
          return {
            events,
            speechText: events
              .filter((e) => e.kind === 'text-delta')
              .map((e) => e.text)
              .join(''),
            summary,
          };
        },
      };
    },
  };
}

export async function dryRunTeachCaller(c: TeachCase): Promise<TurnCapture[]> {
  const harness = createTeachHarness(c.id);
  const captures: TurnCapture[] = [];
  for (const turn of c.turns) {
    if (turn.stubOutput === undefined) {
      throw new Error(`[teach-eval] dry-run requires stubOutput (case=${c.id})`);
    }
    const t = harness.beginTurn();
    for (let i = 0; i < turn.stubOutput.length; i += CHUNK_SIZE) {
      t.feed(turn.stubOutput.slice(i, i + CHUNK_SIZE));
    }
    captures.push(await t.done());
  }
  return captures;
}

// ── 加载 / 跑测 / 汇总（结构对齐 tutor runner） ────────────────────────────

function loadCases(datasetDir: string, filterId?: string): TeachCase[] {
  if (!existsSync(datasetDir)) return [];
  const files = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
  const cases: TeachCase[] = [];
  for (const f of files) {
    const raw = readFileSync(join(datasetDir, f), 'utf-8');
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const c = JSON.parse(l) as TeachCase;
        if (filterId && c.id !== filterId) continue;
        cases.push(c);
      } catch (err) {
        console.warn(`[teach-eval] bad line in ${f}: ${(err as Error).message}`);
      }
    }
  }
  return cases;
}

export async function runTeachEval(opts: {
  datasetDir: string;
  runsDir: string;
  filterId?: string;
  caller?: TeachCaller;
}): Promise<TeachRunResult[]> {
  const cases = loadCases(opts.datasetDir, opts.filterId);
  if (cases.length === 0) {
    console.log('[teach-eval] no cases found');
    return [];
  }

  const caller = opts.caller ?? dryRunTeachCaller;
  const results: TeachRunResult[] = [];

  for (const c of cases) {
    const started = Date.now();
    try {
      const turns = await caller(c);

      const scores: TeachRunResult['scores'] = {};
      const passes: boolean[] = [];

      const loop = gradeQuizLoop(turns, c.expect);
      scores.quizLoop = loop;
      passes.push(loop.pass);

      const grading = gradeGradingAccuracy(turns, c.expect);
      scores.gradingAccuracy = grading;
      passes.push(grading.pass);

      results.push({
        id: c.id,
        turns,
        scores,
        pass: passes.every(Boolean),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      results.push({
        id: c.id,
        turns: [],
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

export function summarizeTeach(results: TeachRunResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const loopFlags = results.filter((r) => r.scores.quizLoop).map((r) => r.scores.quizLoop!.pass);
  // 判分准确率保留粒度：各 case gradingAccuracy score 平均（不是 pass 率）
  const gradingScores = results
    .filter((r) => r.scores.gradingAccuracy)
    .map((r) => r.scores.gradingAccuracy!.score);
  return {
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    loopPassRate:
      loopFlags.length === 0 ? null : loopFlags.filter(Boolean).length / loopFlags.length,
    gradingAccuracy:
      gradingScores.length === 0
        ? null
        : gradingScores.reduce((a, b) => a + b, 0) / gradingScores.length,
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
    caller: dryRunTeachCaller as TeachCaller,
  };

  if (realRun) {
    // 与 asr runner 一致：自动读取 .env.local / .env
    const { config: loadEnv } = await import('dotenv');
    loadEnv({ path: resolve(__dirname, '../../../.env.local'), quiet: true });
    loadEnv({ path: resolve(__dirname, '../../../.env'), quiet: true });
    const { resolveTeachProvider, teachProviderApiKey } = await import(
      '@/lib/config/teach.config'
    );
    const provider = resolveTeachProvider();
    if (!teachProviderApiKey(provider)) {
      console.error(
        `[teach-eval] --real requires ${provider.apiKeyEnv} (provider=${provider.id}；可用 TEACH_PROVIDER 切换)`,
      );
      process.exit(2);
    }
    const { realTeachCaller } = await import('./real-caller');
    opts.caller = realTeachCaller;
  } else if (!dryRun) {
    console.warn('[teach-eval] no mode specified; defaulting to --dry-run. Use --real to call LLM.');
  }

  const started = Date.now();
  const results = await runTeachEval(opts);
  const summary = summarizeTeach(results);
  const durationMs = Date.now() - started;

  const fmt = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  console.log(
    `[teach-eval] ${summary.passed}/${summary.total} passed | ` +
      `loop=${fmt(summary.loopPassRate)} ` +
      `grading=${fmt(summary.gradingAccuracy)} | ${durationMs}ms`,
  );
  if (realRun && summary.passRate < 1) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[teach-eval] fatal:', err);
    process.exit(1);
  });
}
