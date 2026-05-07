// Real Tutor caller for eval harness.
// Uses streamText + tutor tools end-to-end, collects output + toolCalls for graders.
//
// 前置：OPENAI_API_KEY 或 DASHSCOPE_API_KEY + TUTOR_MODEL / TUTOR_BASE_URL
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createTutorTools } from '@/lib/tutor/tutor-tools';
import { TUTOR_SYSTEM_CURRENT } from '@/lib/prompts/tutor-prompts';
import type { TutorCase } from './runner';
import type { ToolCall } from './graders/tool-selection';
import type { TranscriptSegment } from '@/types';

// 简易 fixture 库：tests/eval/tutor/fixtures/transcripts/<name>.json
// 为了让 runner 独立于文件系统调用 harness dev，允许 case.stubOutput/stubToolCalls 优先。
const DEFAULT_TRANSCRIPT: TranscriptSegment[] = [];

export async function realTutorCaller(c: TutorCase): Promise<{
  output: string;
  toolCalls: ToolCall[];
}> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('TUTOR caller requires OPENAI_API_KEY or DASHSCOPE_API_KEY');

  const baseURL =
    process.env.TUTOR_BASE_URL ??
    process.env.LLM_BASE_URL ??
    'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelId = process.env.TUTOR_MODEL ?? 'qwen-max';
  const openai = createOpenAI({ apiKey, baseURL });
  const model = openai(modelId);

  const transcript = DEFAULT_TRANSCRIPT; // TODO M3.5: 按 c.transcriptFixture 加载 JSON
  const tools = createTutorTools({ sessionId: c.id, transcript });

  const userMessage: UIMessage = {
    id: `u-${c.id}`,
    role: 'user',
    parts: [{ type: 'text', text: c.question }],
  };

  const toolCalls: ToolCall[] = [];
  const chunks: string[] = [];

  const result = streamText({
    model,
    system: TUTOR_SYSTEM_CURRENT.content,
    messages: await convertToModelMessages([userMessage]),
    tools,
    stopWhen: stepCountIs(6),
    onStepFinish(step) {
      for (const tc of step.toolCalls ?? []) {
        toolCalls.push({ toolName: tc.toolName, args: tc.input });
      }
    },
  });

  for await (const chunk of result.textStream) {
    chunks.push(chunk);
  }

  return {
    output: chunks.join(''),
    toolCalls,
  };
}
