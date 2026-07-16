# API: Tutor — AI 同桌 + Agent loop 路由

> 所有 AI 对话入口的**唯一**后端（M10 起收口）。按 `mode` 区分场景，差别显式表达，不靠历史偶然分叉。

## 文件索引

| 文件 | 职责 |
|------|------|
| `agent/route.ts` | **M10 主入口** `POST /api/tutor/agent`：mode-driven 单一 endpoint，AI SDK v6 `streamText` + `createUIMessageStreamResponse`。详见下方 mode 矩阵与 provider 说明 |
| `intent/route.ts` | `POST /api/tutor/intent`：将原始问题与学习上下文整理为 `LearningIntentPlan`；当前表达优先，历史上下文不能静默收窄宽泛愿望；可返回 1-3 个动态选择题，前端回传 `answers[{questionId, question, optionIds, optionLabels}]` 后得到最终计划；高置信且无问题的计划由前端直接执行，只有真实歧义或较低置信度才停下来确认；不持久化、不替用户确认 |
| `route.ts` | Legacy SSE 路径（M10 前的主路由）。flag off 时仍可用，但**不在上面加新功能**；非语音对话应迁移到 `agent/route.ts` |
| `tutor-prompts.ts` | **Legacy** System Prompt 模板（M10 前的旧实现）。当前 5 mode 唯一 prompt 源在 `@/lib/prompts/tutor-prompts.ts` 的 `buildTutorSystemPrompt`，本文件勿再扩展 |
| `tutor-types.ts` | 共享类型定义 |
| `tutor-citations.ts` | 引用处理（从转录中定位引用，legacy 路径用） |
| `tutor-guidance.ts` | 引导问题生成（legacy 路径用） |

> 文件行数易变，查实时行数与超标清单请跑 `make stats`。

## `/api/tutor/agent` 的 mode 矩阵

六种 mode 共用场景中立的“同桌”身份基底；课堂是否正在进行、是否已经结束、是否来自分享，只能由各 mode segment 描述。当前 prompt telemetry 版本为 `2026-07-tutor-v6-global-context`。

`TutorMode = 'in-class' | 'review' | 'shared' | 'goal' | 'word' | 'global'`（定义在 `@/lib/prompts/tutor-prompts.ts`）。

| mode | 入口 | context 关键字段 | 特性 |
|---|---|---|---|
| `in-class` | `useClassroomCompanion`（课堂同桌） | `recentFocus` | 短回答；禁时间戳回跳，避免打断正在进行的课堂；M14.6 起纯对话，不挂 native tools；结构化产物由前端 SkillChip 直接打开 |
| `review` | `TutorAgentPanel` / `SafeAITutor`（录音/视频复习） | `fullTranscript` + `currentTimestampSec`（秒，非毫秒）+ `learnerProfile` | 可长答；强制时间戳 `[MM:SS]`；可选 `thinkingGuide`；M14.6 起纯对话，不挂 native tools |
| `shared` | `SharedAgentChat` 落地页 `/share/[token]` | `shared` snapshot + `shareToken` | 禁 native tools；禁时间戳；不注入 `learnerProfile`（**隐私铁律**） |
| `goal` | 「聊聊你想要的」`IntentDialog`（M11） | `goal.existingGoals` + `goal.sessionHint` + `supportMaterials` | 无 transcript；禁 native tools；禁时间戳；AI 用 `---我想要的---...---结束---` 块提炼可保存的 `GoalEntry`；首次会面 vs 回访双路径 |
| `word` | 选词解释浮窗 `WordExplainer`（M13） | `word.selectionText` + `word.nearbyContext` + `word.fullTranscriptTail` | 浮窗形态；禁 native tools；禁时间戳 |
| `global` | `GlobalAskPanel` | `global.depth` + 已确认 `intent` + `memories/recentActivities/activeThread/goals/bio` + 可选 `supportMaterials` | 普通问答直接回答；深度会话输出 `---学习进展---` 候选，前端逐条确认后才可写长期记忆 |

### M14.6 重要变更：native tools 与 inline app marker 已移除

- **`const tools = {}`**：`agent/route.ts` 对所有 mode 都不挂 native tools。结构化产物（闪卡/测验/速查表等）改由前端 SkillChip 直接打开应用矩阵，不再走 LLM 输出 `<open_app:KEY/>` marker 的链路。
- **`<open_app:KEY/>` marker 合约已从 system prompt 移除**（见 `tutor-prompts.ts` 顶部注释）。
- **`tutor-tools.ts` 已删除**：M14.6+ 起 `createTutorTools` 不再被调用，连同 4 个无入口 plugin（study-report / knowledge-cards / confusion-drill / review-plan）一并清理。
- **渲染契约（前端硬合同，仅剩 2 条）**：
  1. `[MM:SS]` / `[MM:SS-MM:SS]` — 仅 `review` 模式可点击跳回转录（解析在 `timestamp-parsing.ts`）；其余 mode 强制关闭
  2. `[资料N]` — 引用 support material 时复用编号，禁止编造

## Provider / 模型选择

解析逻辑在 `@/lib/utils/tutor-agent-provider.ts`，env 驱动：

- **默认模型**：`requestedModel`（请求体 `model`）→ `TUTOR_MODEL` / `LLM_MODEL`（env）→ 有 `STEPFUN_API_KEY` 用 `step-3.7-flash` → 有 `DEEPSEEK_API_KEY` 用 `DeepSeek-V4-Flash` → 否则 `qwen3.7-plus`（DashScope）。
- **强制 Chat Completions**：OpenAI-compatible provider 必须走 `.chat()`，`modelApi: 'chat'`（AI SDK v6 默认走 Responses API，需显式覆盖）。
- **Provider fallback**（`resolveTutorAgentProviderFallbacks`）：primary 失败且错误可重试（5xx/限流/超时）时，按 StepFun → DeepSeek → Qwen 切换到下一已配置 key；401/403/模型不存在等不重试。设了 `TUTOR_API_KEY` 则不 fallback（专用通道）。
- **Qwen thinking 抑制**：`qwen3.*-plus` 等推理模型默认输出大量 `reasoning_content` 拖慢 TTFT，通过 fetch hook 注入 `enable_thinking=false` 关闭推理。
- `stopWhen: stepCountIs(3)` 留安全余量（纯对话 1 步即完成）。
- `experimental_transform: smoothStream({ chunking, delayInMs: 12 })`：中文 1 字 1 切、英文 1 词 1 切，让前端字符逐个浮现。

## 依赖

- `@/lib/prompts/tutor-prompts` — `buildTutorSystemPrompt(mode, context, options)`，6 mode 唯一 prompt 源
- `@/lib/services/learning-intent-service` — `/api/tutor/intent` 的模型计划生成与确定性兜底
- `@/lib/utils/tutor-agent-provider` — provider 解析 + fallback
- `@/lib/services/share-agent-service` — `shared` mode 加载 `SharedAgent.snapshotJson`
- `@/lib/services/llm-service` — 通用 LLM 调用层（legacy 路径用）
- `@/lib/services/conversation-service` — 对话持久化
- `@/lib/services/auth-service` — 认证

## 语音同桌（不走本 endpoint）

- `useOmniRealtimeCall` 走独立 WebSocket（Qwen Omni realtime），**不打** `/api/tutor/agent`。
- 移动端语音同桌由 `RealtimeTutorPanel → TutorRealtimeCallScreen` 承接，语音最终转写写入 `conversationService` 的 `global-chat` 并把 conversationId 接回文字 agent。
