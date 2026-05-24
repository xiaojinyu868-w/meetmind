# Tutor Agent Domain

> M3 交付：从"LLM 文本框"升级为"会用工具的同桌"。
> 技术选择：Vercel AI SDK v6 `streamText + tools + stopWhen + onStepFinish`（零额外框架）。

---

## 形态

旧 Tutor：
```
用户提问 → system prompt + transcript → LLM → SSE → UI
```

M3 Tutor：
```
用户提问
  → 你是 MeetMind 同桌（TUTOR_SYSTEM_V3）
  → stepCountIs(6) 控制的 agent loop：
      step 1: 判断是直接回答 or 调工具
      step 2 (若调工具): makeFlashcards / makeQuiz / makeMindmap / lookupTranscript
      step 3: 把工具结果回灌 → 继续回答
  → toUIMessageStreamResponse 流式帧
  → 前端 useChat 原生消费 + 渲染 tool-call/result
```

---

## 核心文件

### `src/lib/prompts/tutor-prompts.ts`

- `VersionedPrompt` type（`{version, content}`）
- `TUTOR_SYSTEM_V3`（当前默认，会用工具版）
- `TUTOR_SYSTEM_V2_legacy`（AB 对照保留）
- `FLASHCARD_GEN_V1` / `QUIZ_GEN_V1` / `MINDMAP_GEN_V1`
- `PROMPT_VERSIONS` 常量导出给 Sentry metadata

每次改 prompt **新建 V(n+1)**，保留旧版，切换默认指针 `TUTOR_SYSTEM_CURRENT`。这样 eval harness 能回归、灰度能切回。

### `src/lib/tutor/tutor-tools.ts`

4 个 Vercel AI SDK `tool()` 包装：

| Tool | 对应 plugin | 触发语义 |
|---|---|---|
| `makeFlashcards` | flashcards.plugin | 学生想做卡片记忆 |
| `makeQuiz` | quiz.plugin | 学生要求"考我一下 / 出几道题" |
| `makeMindmap` | mindmap.plugin | 学生想梳理结构 |
| `lookupTranscript` | （纯函数） | 学生问"老师什么时候讲到 XX" |

工具设计原则：
- **Description 是给 LLM 的 UX**：明确写"不要用于简单一句话能回答的问题"
- **zod schema** 严格描述参数（含 `.describe()` 注释）
- **返回结构化 error**（`{ok: false, error}`），LLM 按 system prompt 规则用自然话术兜底

### `src/app/api/tutor/agent/route.ts`

新 endpoint（和旧 `/api/tutor` 并存，灰度友好）。请求体可带 `model`，设置页会把用户选择透传进来；服务端用 `resolveTutorAgentProviderFallbacks(env, { modelId })` 生成 DeepSeek / DashScope / OpenAI-compatible 候选，并始终用 `.chat()` 走 `/chat/completions`。

流式策略：

```ts
const providers = resolveTutorAgentProviderFallbacks(env, { modelId });
const stream = createUIMessageStream({
  async execute({ writer }) {
    for (const provider of providers) {
      const openai = createOpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
      const result = streamText({
        model: openai.chat(provider.modelId),
        system: buildTutorSystemPrompt(mode, context, options),
        messages: await convertToModelMessages(messages),
        tools,
        stopWhen: stepCountIs(6),
      });
      // 若尚未输出内容且遇到繁忙 / 限流 / 超时，静默切到下一个 provider；
      // 若已经输出内容或是认证 / 模型配置错误，则不切换，直接把错误交给前端。
    }
  },
});
return createUIMessageStreamResponse({ stream });
```

---

## 前端如何接入

```tsx
// Hypothetical 新 Tutor 组件
import { useChat } from '@ai-sdk/react';

function TutorAgentPanel() {
  const { messages, sendMessage, status } = useChat({
    api: '/api/tutor/agent',
  });

  return messages.map(m =>
    m.parts.map(p => {
      if (p.type === 'text') return <TextBubble>{p.text}</TextBubble>;
      if (p.type === 'tool-makeFlashcards')
        return <FlashcardCard state={p.state} input={p.input} output={p.output} />;
      if (p.type === 'tool-makeQuiz')
        return <QuizCard ... />;
      // ...
    })
  );
}
```

feature flag 示例：
```ts
const USE_AGENT = featureFlags.isEnabled('tutor.agentLoop', { userId });
const endpoint = USE_AGENT ? '/api/tutor/agent' : '/api/tutor';
```

---

## Eval Harness

```bash
make eval-tutor              # dry-run，用 case.stubOutput / stubToolCalls
make eval-tutor-real         # 真实调 streamText + tools（优先当前模型 provider；已配置双 key 时可在 DeepSeek ↔ DashScope 间 fallback）
```

三 grader：
- `tool-selection`：断言 toolCalls[0] 或 contains 或 none
- `timestamp-citation`：正则 `[t=MM:SS]` + 时间窗校验
- `learning-rubric`：LLM-as-Judge（离线自动跳过；可 env `EVAL_JUDGE_MODEL` 覆盖）

基线（seed 8 条）：`7/8 passed / tool=100% cite=66.7% rubric=100%`（1 条故意 fail，验证 harness 能检出 citation 出窗）。

---

## 为什么选这一套（业界对照）

| 维度 | 选 | 不选 | 理由 |
|---|---|---|---|
| Agent loop | Vercel AI SDK v6 | LangGraph / OpenAI Agents SDK | 零迁移，已装 ai@6 |
| 工具协议 | `tool() + zod` | MCP | Workshop 是内部工具，MCP v2 还 pre-alpha |
| Prompt 管理 | git + `PROMPT_VERSION` | LangSmith / Braintrust / Humanloop | 规模小 |
| Eval grader | TS + Promptfoo | Python (Ragas/DeepEval) | TS 单栈 |
| Observability | Sentry `vercelAIIntegration` | LangSmith / Langfuse | 一行集成 |

---

## 环境变量

| 名称 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | 默认推荐凭证；设置页默认模型 `deepseek-v4-flash` 走这里 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek OpenAI-compatible baseURL |
| `OPENAI_API_KEY` 或 `DASHSCOPE_API_KEY` | — | 兼容凭证；当模型 / baseURL 指向对应 provider 时使用；若同时配置 `DEEPSEEK_API_KEY` 和 `DASHSCOPE_API_KEY`，Tutor Agent 会在首个 provider 繁忙/限流/超时且尚未输出内容时自动切到另一路 |
| `TUTOR_MODEL` | `deepseek-v4-flash` | Tutor 默认模型；可 override 成 `deepseek-v4-pro` 或其他已配置 OpenAI-compatible 模型 |
| `TUTOR_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 非 DeepSeek 模型的 Tutor OpenAI-compatible baseURL；DeepSeek 模型使用 `DEEPSEEK_BASE_URL` |

---

## 下一步

- [ ] M4.5: 扩 Tutor dataset 到 50 条真实/合成课堂问答
- [ ] M5: UI 层把 tool-call/result 帧渲染成 Workshop 产物卡片
- [ ] M5: `make eval-tutor-real` 作为 CI gate，综合 pass rate ≥90%
- [ ] M6: Tutor 支持多轮记忆（跨 session `LearnerProfile`）
- [ ] M6+: 主动性 Tutor（发现学生卡住了，主动 quiz）
