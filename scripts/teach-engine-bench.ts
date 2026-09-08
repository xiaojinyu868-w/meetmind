/**
 * teach-engine bench —— 晋升 spike 的 bench.ts + scenario.ts，指向产品化的
 * stream-fn（runtime/stream-fn.ts）与 teach.config 的 provider 注册表。
 *
 * 场景与 spike 相同（「质数」课 3 轮：开场 → 插话+出题 → 继续收尾），
 * 口径：wall = agent.prompt() 全程；ttft = 首个口播 text_delta；actions =
 * 引擎实际执行的板书/特效动作数（EngineRunner 边生成边执行，非整轮后补）。
 *
 * 用法：
 *   npx tsx scripts/teach-engine-bench.ts                 # 默认 provider（TEACH_PROVIDER 或 gemini-commonstack）1 轮 × 3 turn
 *   npx tsx scripts/teach-engine-bench.ts glm-dashscope 2 # 指定 provider + rep 数
 *   TEACH_ENGINE_SIM_SPEED=3 npx tsx ...                  # 口播估时加速（引擎动画延迟不缩放）
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ quiet: true });

// pi-agent-core 是 import-only ESM 包（exports 无 require/default 条件）；本仓库
// package.json 无 "type":"module"，tsx 把 .ts 按 CJS 转译会让静态 import 走
// require 解析而炸（ERR_PACKAGE_PATH_NOT_EXPORTED）。故 pi 链路（Agent 与
// runtime/skills.ts）用动态 import（tsx 保留原生 import() 语义）。生产 Next /
// vitest 均为 ESM 加载，无此问题。
import type { Agent as AgentClass, AgentEvent } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  resolveTeachProviderById,
  resolveTeachProvider,
  teachProviderApiKey,
  TeachConfig,
} from '../src/lib/config/teach.config';
import { buildTeachEngineInstructions } from '../src/lib/prompts/teach-teacher-prompt';
import { createAiSdkStreamFn } from '../src/lib/services/teach-engine/runtime/stream-fn';
import { createThreadStageStore } from '../src/lib/services/teach-engine/runtime/stage-store';
import { createBoardStores } from '../src/lib/services/teach-engine/runtime/board-stores';
import { AudioPacer } from '../src/lib/services/teach-engine/runtime/audio-pacer';
import { EngineRunner } from '../src/lib/services/teach-engine/runtime/engine-runner';
import { ActionEngine } from '../src/lib/services/teach-engine/vendor/openmaic/action/engine';
import type { loadTeachingSkills as loadTeachingSkillsFn } from '../src/lib/services/teach-engine/runtime/skills';
import type { summarizeSkills as summarizeSkillsFn } from '../src/lib/services/teach-engine/runtime/skills';

let Agent: typeof AgentClass;
let loadTeachingSkills: typeof loadTeachingSkillsFn;
let summarizeSkills: typeof summarizeSkillsFn;

const TURNS = [
  '老师，什么是质数？',
  '那 1 算质数吗？……对了，你给我出道题考考我吧。',
  '继续。',
];

function bridgeModel(): Model<never> {
  return {
    id: 'ai-sdk-bridge',
    name: 'AI SDK Bridge',
    api: 'openai-completions',
    provider: 'openai-compatible',
    baseUrl: '',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 8192,
  } as unknown as Model<never>;
}

interface TurnMetric {
  turn: number;
  wallMs: number;
  ttftMs: number;
  input: number;
  output: number;
  cacheRead: number;
  toolCalls: string[];
  actions: number;
  speechSegments: number;
  closed: boolean;
  unknownActions: string[];
}

async function runOnce(providerId: string | undefined, rep: number): Promise<TurnMetric[]> {
  const provider = providerId ? resolveTeachProviderById(providerId) : resolveTeachProvider();
  const apiKey = teachProviderApiKey(provider);
  if (!apiKey) throw new Error(`provider ${provider.id} 缺 ${provider.apiKeyEnv}`);
  const simSpeed = Number(process.env.TEACH_ENGINE_SIM_SPEED ?? 1);

  const skills = await loadTeachingSkills(TeachConfig.skillsDir, {
    personaRoot: TeachConfig.personaSkillsRoot,
  });
  console.log(
    `[skills] loaded ${skills.skills.length} from ${TeachConfig.skillsDir}` +
      (skills.personaSkills.length > 0 ? ` (+${skills.personaSkills.length} persona)` : ''),
  );
  if (skills.skills.length > 0) console.log(summarizeSkills(skills.skills));

  const stage = createThreadStageStore('bench', () => {});
  const pacer = new AudioPacer({ speed: simSpeed });
  const engine = new ActionEngine(stage, pacer, null, createBoardStores());
  const agent = new Agent({
    initialState: {
      systemPrompt: buildTeachEngineInstructions('什么是质数', skills.systemPromptBlock),
      model: bridgeModel(),
      thinkingLevel: 'off',
      tools: [skills.readTool],
    },
    streamFn: createAiSdkStreamFn({
      languageModel: createOpenAI({ baseURL: provider.baseUrl, apiKey }).chat(provider.model),
      maxOutputTokens: TeachConfig.engineMaxOutputTokens,
    }),
  });

  let runner: EngineRunner | null = null;
  let turnStart = 0;
  let ttftMs = 0;
  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_update') {
      const e = event.assistantMessageEvent;
      if (e.type === 'text_delta') {
        if (ttftMs === 0) ttftMs = Date.now() - turnStart;
        runner?.feedTextDelta(e.delta);
      }
    }
  });

  const metrics: TurnMetric[] = [];
  for (const [i, studentText] of TURNS.entries()) {
    pacer.reset();
    const unknown: string[] = [];
    runner = new EngineRunner({
      engine,
      pacer,
      boardDigest: () => `板书 ${stage.whiteboard.elements.length} 个元素`,
      hooks: {
        onTextDelta: () => {},
        onToolCall: () => {},
        onToolResult: () => {},
        onUnknownAction: (name) => unknown.push(name),
      },
    });
    const acc = { input: 0, output: 0, cacheRead: 0, toolCalls: [] as string[] };
    const usageOff = agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const u = event.message.usage;
        if (u && (u.input > 0 || u.output > 0)) {
          acc.input += u.input + u.cacheRead;
          acc.output += u.output;
          acc.cacheRead += u.cacheRead;
        }
      }
      if (event.type === 'tool_execution_start') acc.toolCalls.push(event.toolName);
    });

    ttftMs = 0;
    turnStart = Date.now();
    await agent.prompt(studentText);
    const summary = await runner.finalize();
    const wallMs = Date.now() - turnStart;
    usageOff();

    metrics.push({
      turn: i + 1,
      wallMs,
      ttftMs,
      input: acc.input,
      output: acc.output,
      cacheRead: acc.cacheRead,
      toolCalls: acc.toolCalls,
      actions: summary.executedActions,
      speechSegments: summary.speechSegments,
      closed: summary.closed,
      unknownActions: summary.unknownActions.length > 0 ? summary.unknownActions : unknown,
    });
    console.log(
      `[rep${rep} turn${i + 1}] wall=${wallMs}ms ttft=${ttftMs}ms in=${acc.input} out=${acc.output} ` +
        `cacheRead=${acc.cacheRead} tools=${acc.toolCalls.join(',') || '-'} actions=${summary.executedActions} ` +
        `speech=${summary.speechSegments} closed=${summary.closed}` +
        (summary.unknownActions.length ? ` unknown=${summary.unknownActions.join(',')}` : ''),
    );
  }
  unsubscribe();
  engine.dispose();
  pacer.dispose();
  return metrics;
}

async function main() {
  const pi = await import('@earendil-works/pi-agent-core');
  Agent = pi.Agent;
  const skillsMod = await import('../src/lib/services/teach-engine/runtime/skills');
  loadTeachingSkills = skillsMod.loadTeachingSkills;
  summarizeSkills = skillsMod.summarizeSkills;

  const providerId = process.argv[2];
  const reps = Number(process.argv[3] ?? 1);
  for (let rep = 1; rep <= reps; rep++) {
    console.log(`\n=== rep ${rep}/${reps} (provider=${providerId ?? process.env.TEACH_PROVIDER ?? 'gemini-commonstack'}) ===`);
    await runOnce(providerId, rep);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
