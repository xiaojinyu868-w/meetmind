// Apps Runner —— 应用矩阵练习类产物（测验 / 闪卡）的质量评测。
//
// 跑 datasets/*.jsonl 下的 case：每 case 一份真课转录 fixture + 可选的「这个人」（掌握轨迹）+ 期望，
// 模型输出经生产真件（parseQuizDraft / buildQuizCards、parseFlashcardsDraft / buildFlashcardCards：
// 去重、题型收口、正面泄答剔除、证据落地）变成产物，再用两个 grader 断言质量。
//
// dry-run（默认）：case 带 stubOutput（冻结的模型原文），只有模型输出是冻结的，其余全是生产代码——
//   prompt 改了不会让 dry-run 变红（它测的是产物层契约与生产后处理），要看 prompt 效果用 --real。
// --real：走 generateQuizDraft / generateFlashcardsDraft 调真模型（同一份 prompt / 上下文组装），需要 DASHSCOPE_API_KEY 等。
// --record：--real 跑完把模型原文写回 dataset 的 stubOutput（把这一版模型输出冻结成新的 dry-run 材料）。
//
// Usage:
//   npx tsx tests/eval/apps/runner.ts --dry-run
//   npx tsx tests/eval/apps/runner.ts --id quiz-yingshe-unstable
//   npx tsx tests/eval/apps/runner.ts --real [--record]
import './load-env';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionContext } from '@/lib/ai-native/types';
import { buildExecutionContext } from '@/lib/ai-native/context-builder';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { buildQuizCards, parseQuizDraft, type QuizLLMOutput } from '@/lib/ai-native/plugins/quiz.plugin';
import { buildFlashcardCards, parseFlashcardsDraft, type FlashcardLLMOutput } from '@/lib/ai-native/plugins/flashcards.plugin';
import { emptyLearnerContext, type LearnerConceptState, type LearnerContext } from '@/types/learner-context';
import { DEMO_SEGMENTS, DEMO_SESSION_ID } from '@/fixtures/demo-data';
import { gradeQuizQuality, type GradedQuizQuestion, type QuizExpect } from './graders/quiz-quality';
import { gradeFlashcardsQuality, type FlashcardsExpect, type GradedFlashcard } from './graders/flashcards-quality';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type AppsEvalApp = 'quiz' | 'flashcards';

export interface AppsCase {
  id: string;
  app: AppsEvalApp;
  /** fixtures/<name>.json（{ title, segments }）或 'demo-english'（src/fixtures/demo-data 的试听课） */
  fixture: string;
  /** 这个人（事实半）：掌握轨迹；不传 = 访客第一次 */
  learner?: { mastery: LearnerConceptState[] };
  /** 听课时的困惑点 / 上一步暴露的问题 */
  anchors?: Array<{ timestamp: number; note?: string }>;
  expect: QuizExpect & FlashcardsExpect;
  /** dry-run 用：冻结的模型原文 */
  stubOutput?: string;
}

export interface AppsRunResult {
  id: string;
  app: AppsEvalApp;
  pass: boolean;
  score: number;
  reason: string;
  checks: Record<string, boolean>;
  /** 产物摘要（题面 / 卡面），便于人读 run 文件 */
  items: string[];
  durationMs: number;
  error?: string;
}

export interface AppsCaller {
  (c: AppsCase, context: AppExecutionContext): Promise<{ raw: string }>;
}

/* ── fixture → 执行上下文 ── */

interface FixtureFile {
  title?: string;
  segments: Array<{ id?: string; startMs: number; endMs: number; text: string }>;
}

export function loadFixture(name: string): { title: string; sessionId: string; transcript: TranscriptSegment[] } {
  if (name === 'demo-english') {
    return { title: "Australia's Moving Experience · IELTS 听力练习", sessionId: DEMO_SESSION_ID, transcript: DEMO_SEGMENTS };
  }
  const file = resolve(__dirname, 'fixtures', `${name}.json`);
  if (!existsSync(file)) throw new Error(`[apps-eval] fixture not found: ${file}`);
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as FixtureFile;
  const transcript: TranscriptSegment[] = parsed.segments.map((segment, index) => ({
    id: segment.id ?? `s${index + 1}`,
    text: segment.text,
    startMs: segment.startMs,
    endMs: segment.endMs,
    confidence: 1,
    isFinal: true,
  }));
  return { title: parsed.title ?? name, sessionId: `eval-${name}`, transcript };
}

export function buildCaseContext(c: AppsCase): AppExecutionContext {
  const fixture = loadFixture(c.fixture);
  const app = getWorkshopAppByKey(c.app);
  if (!app) throw new Error(`[apps-eval] unknown app ${c.app}`);
  const now = new Date().toISOString();
  const anchors: Anchor[] = (c.anchors ?? []).map((anchor, index) => ({
    id: `eval-anchor-${index}`,
    sessionId: fixture.sessionId,
    studentId: 'eval-learner',
    timestamp: anchor.timestamp,
    type: 'confusion',
    cancelled: false,
    resolved: false,
    createdAt: now,
    note: anchor.note,
  }));
  const context = buildExecutionContext({
    appKey: c.app,
    goal: { intent: app.intent, expectedOutput: 'mixed', appKey: c.app },
    input: { sessionId: fixture.sessionId, dataSource: 'video', transcript: fixture.transcript, anchors, metadata: { title: fixture.title } },
    memory: {},
  });
  if (c.learner) {
    const learner: LearnerContext = {
      ...emptyLearnerContext('server', 'eval-learner'),
      mastery: c.learner.mastery.map((state) => ({ ...state, evidence: state.evidence ? { ...state.evidence, sessionId: state.evidence.sessionId ?? fixture.sessionId } : undefined })),
    };
    context.learner = learner;
  }
  return context;
}

/* ── 模型原文 → 生产产物 → grader 输入 ── */

export function gradeQuizRaw(raw: string, context: AppExecutionContext, expect: QuizExpect): Omit<AppsRunResult, 'id' | 'app' | 'durationMs'> {
  const draft: QuizLLMOutput | null = parseQuizDraft(raw);
  const rawStems = (draft?.questions ?? []).map((q) => (typeof q.stem === 'string' ? q.stem : ''));
  let questions: GradedQuizQuestion[] = [];
  try {
    const cards = buildQuizCards(context.input.transcript, draft);
    questions = cards
      .filter((card) => card.meta?.cardKind === 'quiz')
      .map((card) => ({
        stem: String(card.meta?.stem ?? card.body),
        type: String(card.meta?.type ?? 'single'),
        options: Array.isArray(card.meta?.options) ? (card.meta.options as string[]) : [],
        answer: String(card.meta?.answer ?? ''),
        explanation: String(card.meta?.explanation ?? ''),
        concept: typeof card.meta?.concept === 'string' ? card.meta.concept : undefined,
      }));
  } catch (error) {
    return { pass: false, score: 0, reason: `production rejected: ${(error as Error).message}`, checks: {}, items: [] };
  }
  const grade = gradeQuizQuality(questions, rawStems, expect);
  return { ...grade, items: questions.map((q) => `[${q.type}] ${q.stem}`) };
}

export function gradeFlashcardsRaw(raw: string, context: AppExecutionContext, expect: FlashcardsExpect): Omit<AppsRunResult, 'id' | 'app' | 'durationMs'> {
  const draft: FlashcardLLMOutput | null = parseFlashcardsDraft(raw);
  const rawCards: GradedFlashcard[] = (draft?.cards ?? []).map((card) => ({
    front: typeof card.question === 'string' ? card.question : '',
    back: typeof card.answer === 'string' ? card.answer : '',
    hint: typeof card.hint === 'string' ? card.hint : undefined,
    concept: typeof card.concept === 'string' ? card.concept : undefined,
  }));
  let cards: GradedFlashcard[] = [];
  try {
    cards = buildFlashcardCards(context.input.transcript, draft)
      .filter((card) => card.meta?.cardKind === 'flashcard')
      .map((card) => ({
        front: String(card.meta?.front ?? card.body),
        back: String(card.meta?.back ?? ''),
        hint: typeof card.meta?.hint === 'string' ? card.meta.hint : undefined,
        concept: typeof card.meta?.concept === 'string' ? card.meta.concept : undefined,
      }));
  } catch (error) {
    return { pass: false, score: 0, reason: `production rejected: ${(error as Error).message}`, checks: {}, items: [] };
  }
  const grade = gradeFlashcardsQuality(cards, rawCards, expect);
  return { ...grade, items: cards.map((c) => `${c.front}  →  ${c.back}`) };
}

/* ── 加载 / 跑测 / 汇总 ── */

export async function dryRunAppsCaller(c: AppsCase): Promise<{ raw: string }> {
  if (c.stubOutput === undefined) {
    throw new Error(`[apps-eval] dry-run requires stubOutput (case=${c.id}); run with --real --record to freeze one`);
  }
  return { raw: c.stubOutput };
}

function loadCases(datasetDir: string, filterId?: string): Array<AppsCase & { file: string }> {
  if (!existsSync(datasetDir)) return [];
  const files = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
  const cases: Array<AppsCase & { file: string }> = [];
  for (const f of files) {
    const raw = readFileSync(join(datasetDir, f), 'utf-8');
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const c = JSON.parse(l) as AppsCase;
        if (filterId && c.id !== filterId) continue;
        cases.push({ ...c, file: join(datasetDir, f) });
      } catch (err) {
        console.warn(`[apps-eval] bad line in ${f}: ${(err as Error).message}`);
      }
    }
  }
  return cases;
}

/** --record：把某 case 的 stubOutput 写回它所在的 jsonl（其余行原样） */
function recordStub(file: string, id: string, raw: string): void {
  const lines = readFileSync(file, 'utf-8').split('\n');
  const next = lines.map((line) => {
    const l = line.trim();
    if (!l) return line;
    try {
      const c = JSON.parse(l) as AppsCase;
      if (c.id !== id) return line;
      return JSON.stringify({ ...c, stubOutput: raw });
    } catch {
      return line;
    }
  });
  writeFileSync(file, next.join('\n'));
}

export async function runAppsEval(opts: {
  datasetDir: string;
  runsDir: string;
  filterId?: string;
  caller?: AppsCaller;
  record?: boolean;
}): Promise<AppsRunResult[]> {
  const cases = loadCases(opts.datasetDir, opts.filterId);
  if (cases.length === 0) {
    console.log('[apps-eval] no cases found');
    return [];
  }
  const caller = opts.caller ?? dryRunAppsCaller;
  const results: AppsRunResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const context = buildCaseContext(c);
      const { raw } = await caller(c, context);
      if (opts.record) recordStub(c.file, c.id, raw);
      // 上次没记住的题面 / 卡面 → 不该原样再出现（软项）
      const avoidRepeating = (c.learner?.mastery ?? []).filter((state) => state.status === 'unstable').map((state) => state.concept);
      const expect = { ...c.expect, avoidRepeating: c.expect.avoidRepeating ?? avoidRepeating };
      const graded = c.app === 'quiz' ? gradeQuizRaw(raw, context, expect) : gradeFlashcardsRaw(raw, context, expect);
      results.push({ id: c.id, app: c.app, ...graded, durationMs: Date.now() - started });
    } catch (err) {
      results.push({ id: c.id, app: c.app, pass: false, score: 0, reason: (err as Error).message, checks: {}, items: [], durationMs: Date.now() - started, error: (err as Error).message });
    }
  }
  if (!existsSync(opts.runsDir)) mkdirSync(opts.runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(opts.runsDir, `${ts}.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return results;
}

export function summarizeApps(results: AppsRunResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const rate = (items: AppsRunResult[]) => (items.length === 0 ? null : items.filter((r) => r.pass).length / items.length);
  const quiz = results.filter((r) => r.app === 'quiz');
  const flashcards = results.filter((r) => r.app === 'flashcards');
  return {
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    quizPassRate: rate(quiz),
    flashcardsPassRate: rate(flashcards),
    avgScore: total === 0 ? null : results.reduce((sum, r) => sum + r.score, 0) / total,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const realRun = argv.includes('--real');
  const record = argv.includes('--record');
  const idIdx = argv.indexOf('--id');
  const filterId = idIdx >= 0 ? argv[idIdx + 1] : undefined;

  const opts = {
    datasetDir: resolve(__dirname, 'datasets'),
    runsDir: resolve(__dirname, 'runs'),
    filterId,
    caller: dryRunAppsCaller as AppsCaller,
    record: false,
  };

  if (realRun) {
    // env 已由 ./load-env 在所有 import 之前装好
    if (!process.env.DASHSCOPE_API_KEY && !process.env.OPENAI_API_KEY) {
      console.error('[apps-eval] --real requires DASHSCOPE_API_KEY or OPENAI_API_KEY');
      process.exit(2);
    }
    const { realAppsCaller } = await import('./real-caller');
    opts.caller = realAppsCaller;
    opts.record = record;
  } else if (!dryRun) {
    console.warn('[apps-eval] no mode specified; defaulting to --dry-run. Use --real to call LLM.');
  }

  const started = Date.now();
  const results = await runAppsEval(opts);
  const summary = summarizeApps(results);
  const fmt = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.id} (${r.app}) score=${(r.score * 100).toFixed(0)}% — ${r.reason}`);
  }
  console.log(
    `[apps-eval] ${summary.passed}/${summary.total} passed | quiz=${fmt(summary.quizPassRate)} flashcards=${fmt(summary.flashcardsPassRate)} | avg_score=${fmt(summary.avgScore)} | ${Date.now() - started}ms`,
  );
  if (summary.passRate < 1) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[apps-eval] fatal:', err);
    process.exit(1);
  });
}
