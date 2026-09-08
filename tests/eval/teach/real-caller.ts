// Real Teach caller —— 直驱等效生产链路（不经 teach-engine-service，避免污染
// dev.db / 事件日志）：loadTeachingSkills + buildTeachEngineInstructions +
// AI SDK streamText 多轮对话，每个 text delta 喂当轮 EngineRunner。
//
// eval 捷径：pi 的按需 read（模型自己 read SKILL.md）在纯 streamText 链路
// 不存在，首轮把 quiz-maker 正文以 user 消息前缀注入，模拟模型已 read skill。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { loadTeachingSkills } from '@/lib/services/teach-engine/runtime/skills';
import { buildTeachEngineInstructions } from '@/lib/prompts/teach-teacher-prompt';
import {
  resolveTeachProvider,
  teachProviderApiKey,
  TeachConfig,
} from '@/lib/config/teach.config';
import { createTeachHarness, type TeachCase, type TurnCapture } from './runner';

export async function realTeachCaller(c: TeachCase): Promise<TurnCapture[]> {
  const provider = resolveTeachProvider();
  const apiKey = teachProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`[teach-eval] --real requires ${provider.apiKeyEnv} (provider=${provider.id})`);
  }

  const skills = await loadTeachingSkills(TeachConfig.skillsDir, {
    personaRoot: TeachConfig.personaSkillsRoot,
  });
  const system = buildTeachEngineInstructions(c.topic, skills.systemPromptBlock);
  const openai = createOpenAI({ baseURL: provider.baseUrl, apiKey });
  const model = openai.chat(provider.model);
  const reasoningEffort = provider.upstreamParams?.reasoning_effort;

  const quizSkill = readFileSync(
    resolve(TeachConfig.skillsDir, 'quiz-maker', 'SKILL.md'),
    'utf-8',
  );

  const harness = createTeachHarness(c.id);
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const captures: TurnCapture[] = [];

  for (let i = 0; i < c.turns.length; i++) {
    const student = c.turns[i].studentMessage;
    messages.push({
      role: 'user',
      content:
        i === 0
          ? `${quizSkill}\n\n---\n（以上是你已 read 的 quiz-maker 技能正文）\n学生消息：${student}`
          : student,
    });

    const turn = harness.beginTurn();
    let raw = '';
    const result = streamText({
      model,
      system,
      messages: [...messages],
      maxOutputTokens: TeachConfig.engineMaxOutputTokens,
      providerOptions:
        typeof reasoningEffort === 'string' ? { openai: { reasoningEffort } } : undefined,
    });
    for await (const delta of result.textStream) {
      raw += delta;
      turn.feed(delta);
    }
    captures.push(await turn.done());
    // assistant 回复用原始 DSL 文本累积进多轮上下文
    messages.push({ role: 'assistant', content: raw });
  }

  return captures;
}
