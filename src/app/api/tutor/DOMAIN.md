# API: Tutor — AI 同桌 + Agent loop 路由

> 所有 AI 对话入口的**唯一**后端（M10 起收口）。按 `mode` 区分场景，差别显式表达，不靠历史偶然分叉。

## 文件索引

| 文件 | 职责 |
|------|------|
| `agent/route.ts` | **M10 主入口** `POST /api/tutor/agent`：mode-driven 单一 endpoint，AI SDK v6 `streamText` + `createUIMessageStreamResponse`。详见下方 mode 矩阵与 provider 说明 |
| `intent/route.ts` | `POST /api/tutor/intent`：将原始问题与学习上下文整理为 `LearningIntentPlan`；当前表达优先，历史上下文不能静默收窄宽泛愿望；没有真实歧义就直接开始，不展示内部置信度或额外确认卡。只有答案会改变学习路径时才返回动态选择题（通常 1 个，最多 2 个），前端回传 `answers[{questionId, question, optionIds, optionLabels}]` 后得到最终计划；不持久化、不替用户确认。system/user input 基线来自 `learning-understanding-prompts.ts`，运行时可由管理员追加受约束指令或覆盖注册模型。 |
| `memory/route.ts` | `POST /api/tutor/memory`：全局学习问答持久化后的静默学习理解整理；输入本轮用户表达、助手回答和最多 12 条既有理解，返回最多 2 条新增或带 `replaceId` 的更新；不接收、不改写 `recentLearningActivities`，与 Tutor 主链路一致允许访客请求并在 route 内限流。system/user input 基线与控制中心共用，用户证据、敏感信息和 JSON 合同不可被管理员覆盖。 |
| `route.ts` | Legacy SSE 路径（M10 前的主路由）。flag off 时仍可用，但**不在上面加新功能**；非语音对话应迁移到 `agent/route.ts` |
| `tutor-prompts.ts` | **Legacy** System Prompt 模板（M10 前的旧实现）。当前 5 mode 唯一 prompt 源在 `@/lib/prompts/tutor-prompts.ts` 的 `buildTutorSystemPrompt`，本文件勿再扩展 |
| `tutor-types.ts` | 共享类型定义 |
| `tutor-citations.ts` | 引用处理（从转录中定位引用，legacy 路径用） |
| `tutor-guidance.ts` | 引导问题生成（legacy 路径用） |

> 文件行数易变，查实时行数与超标清单请跑 `make stats`。

## `/api/tutor/agent` 的 mode 矩阵

六种 mode 共用场景中立的“同桌”身份基底；课堂是否正在进行、是否已经结束、是否来自分享，只能由各 mode segment 描述。当前 prompt telemetry 版本见 `PROMPT_VERSIONS.tutorSystem`。

`TutorMode = 'in-class' | 'review' | 'shared' | 'goal' | 'word' | 'global'`（定义在 `@/lib/prompts/tutor-prompts.ts`）。

| mode | 入口 | context 关键字段 | 特性 |
|---|---|---|---|
| `in-class` | `useClassroomCompanion`（课堂同桌） | `recentFocus` | 短回答；禁时间戳回跳，避免打断正在进行的课堂；M14.6 起纯对话，不挂 native tools；结构化产物由前端 SkillChip 直接打开 |
| `review` | `TutorAgentPanel` / `SafeAITutor`（录音/视频复习） | `fullTranscript` + `currentTimestampSec`（秒，非毫秒）+ `learnerProfile` | 可长答；强制时间戳 `[MM:SS]`；可选 `thinkingGuide`；M14.6 起纯对话，不挂 native tools |
| `shared` | `SharedAgentChat` 落地页 `/share/[token]` | `shared` snapshot + `shareToken` | 禁 native tools；禁时间戳；不注入 `learnerProfile`（**隐私铁律**） |
| `goal` | 「聊聊你想要的」`IntentDialog`（M11） | `goal.existingGoals` + `goal.sessionHint` + `supportMaterials` | 无 transcript；禁 native tools；禁时间戳；AI 用 `---我想要的---...---结束---` 块提炼可保存的 `GoalEntry`；首次会面先帮助再理解，不做画像访谈，稳定上下文由模型静默管理 |
| `word` | 选词解释浮窗 `WordExplainer`（M13） | `word.selectionText` + `word.nearbyContext` + `word.fullTranscriptTail` | 浮窗形态；禁 native tools；禁时间戳 |
| `global` | `GlobalAskPanel` | `global.depth` + 已确认 `intent` + `memories/recentActivities/activeThread/goals/bio` + 可选 `supportMaterials` | 普通问答直接回答，深度学习仅在真实歧义时确认路径；任何全局学习问答持久化后都由 `/api/tutor/memory` 独立判断是否形成真实学习理解，证据不足返回空；用户可纠正/暂停/忘记，客观最近学习现场保持独立 |

### M14.6 重要变更：native tools 与 inline app marker 已移除

- **`const tools = {}`**：`agent/route.ts` 对所有 mode 都不挂 native tools。结构化产物（闪卡/测验/速查表等）改由前端 SkillChip 直接打开应用矩阵，不再走 LLM 输出 `<open_app:KEY/>` marker 的链路。
- **`<open_app:KEY/>` marker 合约已从 system prompt 移除**（见 `tutor-prompts.ts` 顶部注释）。
- **`tutor-tools.ts` 已删除**：M14.6+ 起 `createTutorTools` 不再被调用，连同 4 个无入口 plugin（study-report / knowledge-cards / confusion-drill / review-plan）一并清理。
- **渲染契约（前端硬合同，仅剩 2 条）**：
  1. `[MM:SS]` / `[MM:SS-MM:SS]` — 仅 `review` 模式可点击跳回转录（解析在 `timestamp-parsing.ts`）；其余 mode 强制关闭
  2. `[资料N]` — 引用 support material 时复用编号，禁止编造

## Provider / 模型选择

解析逻辑在 `@/lib/utils/tutor-agent-provider.ts`，env 驱动：

- **模型分层**：管理员 AI 控制台中启用并发布的 mode 级模型路由最高优先，其次是请求体 `model`；`global + depth='quick'` 默认走 `ModelDefaults.tutorQuick`（`TUTOR_QUICK_MODEL`，留空优先 `TUTOR_MODEL` 同 provider 的 Flash；DashScope 为 `qwen3.6-flash`）；深度学习、课堂与复习走 `TUTOR_MODEL` / `LLM_MODEL`，无声明时依次回落 StepFun `step-3.7-flash`、DeepSeek `DeepSeek-V4-Flash`、DashScope `qwen3.7-plus`。
- **管理员运行时控制**：`@/lib/services/ai-control-service.ts` 按 mode 读取最新已发布版本；基线 prompt 仍由代码生成，管理员只可追加指令和切换注册模型，不可替换完整 prompt。追加后再次附上隐私、引用与场景边界等不可覆盖合同；草稿、预览、发布、回滚走 `/api/admin/ai-control`。
- **强制 Chat Completions**：OpenAI-compatible provider 必须走 `.chat()`，`modelApi: 'chat'`（AI SDK v6 默认走 Responses API，需显式覆盖）。
- **Provider fallback**（`resolveTutorAgentProviderFallbacks`）：primary 失败且错误可重试（5xx/限流/超时）时，按 StepFun → DeepSeek → Qwen 切换到下一已配置 key；401/403/模型不存在等不重试。设了 `TUTOR_API_KEY` 则不 fallback（专用通道）。
- **首字熔断**：每个 provider 默认 15 秒内没有任何用户可见输出就中止本次尝试，并沿同一 fallback 链切换备用通道；已经开始输出的长回答不会被截断。可用 `TUTOR_FIRST_TOKEN_TIMEOUT_MS` 在 5–45 秒内覆盖。
- **Qwen thinking 抑制**：`qwen3.*-plus` 等推理模型默认输出大量 `reasoning_content` 拖慢 TTFT，通过 fetch hook 注入 `enable_thinking=false` 关闭推理。
- `stopWhen: stepCountIs(3)` 留安全余量（纯对话 1 步即完成）。
- `experimental_transform: smoothStream({ chunking, delayInMs: 12 })`：中文 1 字 1 切、英文 1 词 1 切，让前端字符逐个浮现。

## 依赖

- `@/lib/prompts/tutor-prompts` — `buildTutorSystemPrompt(mode, context, options)`，6 mode 唯一 prompt 源
- `@/lib/services/learning-intent-service` — `/api/tutor/intent` 的模型计划生成与确定性兜底
- `@/lib/services/learning-memory-distillation-service` — `/api/tutor/memory` 的证据约束、去重更新与模型失败空结果
- `@/lib/prompts/learning-understanding-prompts` — intent / memory 共用的 system prompt、user input 拼装与独立版本号
- `@/lib/utils/tutor-agent-provider` — provider 解析 + fallback
- `@/lib/services/share-agent-service` — `shared` mode 加载 `SharedAgent.snapshotJson`
- `@/lib/services/ai-control-service` — 管理员 prompt 追加、模型路由、版本发布与运行时读取
- `@/lib/services/llm-service` — 通用 LLM 调用层（legacy 路径用）
- `@/lib/services/conversation-service` — 对话持久化
- `@/lib/services/auth-service` — 认证

## 语音同桌（2026-08 已下线）

- 实时语音通话整体下线：`useOmniRealtimeCall` 原本走独立 WebSocket（Qwen Omni realtime via `/api/tutor-call`），**不打** `/api/tutor/agent`；该 WS 代理已从 server.js 拆除，相关组件全部 deprecated（保留一个周期后物理删除）。
