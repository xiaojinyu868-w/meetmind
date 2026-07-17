# Tutor Agent Domain

## 当前实现（2026-07）

Tutor 的唯一新主链路是 `POST /api/tutor/agent`，由 `buildTutorSystemPrompt` 按六种 mode 组装：`in-class / review / shared / goal / word / global`。所有 mode 都是纯文字对话，`tools = {}`；闪卡、测验、导图等结构化产物由前端 SkillChip 直接调用 `/api/apps/execute`，不再依赖 LLM tool call 或 `<open_app:KEY/>` marker。

全局 Ask MeetMind 使用 `mode='global'`：

- quick：直接回答，不做意图确认，也不在正文里生成记忆标记；回答持久化后仍由独立流程判断用户是否真实表现出值得长期保留的学习理解。
- deep：先调用 `/api/tutor/intent` 得到 `LearningIntentPlan`。模型应先利用已有课堂和个人上下文；没有真实歧义时前端立即开始，不展示内部置信度或额外确认卡。只有答案会明显改变路径时才暂停，并通常只返回 1 个动态选择问题（两个问题彼此独立且都足以改变路径时最多 2 个）。前端回传包含问题与选项语义的 `answers[{questionId, question, optionIds, optionLabels}]` 后取得最终计划并自动开始。主回答保持自然纯文本。
- 上下文整理不依赖 quick / deep 开关：任一全局学习问答持久化后，`/api/tutor/memory` 都依据本轮用户真实表达/作答静默判断是否形成最多 2 条新增或更新的学习理解。证据不足返回空数组，愿望、建议、人格与敏感推断不能进入长期理解；访客态与 Tutor 主链路一致可用，route 内限流。
- `LearnerProfile.memories` 是模型整理、用户可纠正/暂停/忘记的学习理解；`recentLearningActivities` 是课堂、提问、材料和应用等客观学习现场，始终保持独立，不被自动升级或改写成对用户的判断。
- `GlobalAskPanel` 基于 ChatBase，`useGlobalAskHistory` 只恢复 `metadata.scope='global-ask'` 的 IndexedDB 对话，避免误接某节课的复习聊天。

当前 prompt telemetry 版本：`2026-07-tutor-v9-consumer-context`。goal 首次会面改为“先帮助、后理解”：不做画像访谈，模型静默维护稳定上下文，仅在真实需要用户决定时追问。

---

## 历史：M3 Agent loop 方案（已被 M14.6 纯对话链路替代）

> M3 交付：从"LLM 文本框"升级为"会用工具的同桌"。
> 技术选择：Vercel AI SDK v6 `streamText + tools + stopWhen + onStepFinish`（零额外框架）。

---

### 形态

旧 Tutor：
```
用户提问 → system prompt + transcript → LLM → SSE → UI
```

M3 Tutor（历史）：
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

#### 场景时序：时间引用仅属于课后复习

- `review`：默认注入 `[MM:SS]` / `[MM:SS-MM:SS]` 合约，前端可以跳回已经保存的原声或转录。
- `in-class`：老师仍在讲，回答只帮助学生跟上当前内容，不提供时间回跳。
- `shared / goal / word`：没有可供当前用户回跳的原声上下文，同样禁用时间引用。
- 这是服务端硬边界：除 `review` 外，即使请求传入 `returnTimestamps: true` 也会被忽略；课堂 adapter 还会防御性清理模型意外返回的时间戳。

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

当前 dry-run 基线：`26/28 passed / tool=100% cite=71.4% rubric=100%`（保留故意失败样本，用来验证 harness 能检出 citation 出窗）。

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
| `STEPFUN_API_KEY` | — | StepFun 凭证；未显式指定 Tutor 模型且可用时默认 `step-3.7-flash` |
| `STEPFUN_BASE_URL` | `https://api.stepfun.com/v1` | 阶跃星辰 OpenAI-compatible baseURL（仅保留兼容） |
| `DEEPSEEK_API_KEY` | — | DeepSeek 凭证；`DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` 走这里 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek-family 官方 OpenAI-compatible baseURL |
| `OPENAI_API_KEY` 或 `DASHSCOPE_API_KEY` | — | 兼容凭证；Qwen-family 优先使用 `DASHSCOPE_API_KEY` 并指向百炼 OpenAI-compatible endpoint；首个 provider 繁忙/限流/超时且尚未输出内容时可自动切换备用通道 |
| `TUTOR_MODEL` | env 驱动 | 深度学习、课堂同桌与复习默认模型；未声明时依可用凭证回落到 `step-3.7-flash` / `DeepSeek-V4-Flash` / `qwen3.7-plus` |
| `TUTOR_QUICK_MODEL` | `TUTOR_MODEL` 同 provider 的 Flash | Ask MeetMind「直接问」专用低延迟模型；DashScope 默认 `qwen3.6-flash`，显式请求模型仍优先 |
| `TUTOR_FIRST_TOKEN_TIMEOUT_MS` | `15000` | 单个 provider 的无首字熔断（范围 5000–45000ms）；超时切备用通道，已经开始输出的回答不截断 |
| `TUTOR_BASE_URL` | DashScope compatible endpoint | 非 DeepSeek/StepFun 模型的 Tutor OpenAI-compatible baseURL；StepFun 模型使用 `STEPFUN_BASE_URL`，DeepSeek 模型使用 `DEEPSEEK_BASE_URL` |

---

## 下一步

- [ ] M4.5: 扩 Tutor dataset 到 50 条真实/合成课堂问答
- [ ] M5: UI 层把 tool-call/result 帧渲染成 Workshop 产物卡片
- [ ] M5: `make eval-tutor-real` 作为 CI gate，综合 pass rate ≥90%
- [ ] M6: Tutor 支持多轮记忆（跨 session `LearnerProfile`）
- [ ] M6+: 主动性 Tutor（发现学生卡住了，主动 quiz）
