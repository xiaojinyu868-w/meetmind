# Tutor Agent Domain

## 当前实现（2026-07）

Tutor 的唯一新主链路是 `POST /api/tutor/agent`，由 `buildTutorSystemPrompt` 按六种 mode 组装：`in-class / review / shared / goal / word / global`。所有 mode 都是纯文字对话，`tools = {}`；闪卡、测验、导图等结构化产物由前端 SkillChip 直接调用 `/api/apps/execute`，不再依赖 LLM tool call 或 `<open_app:KEY/>` marker。

全局 Ask MeetMind 使用 `mode='global'`：

- quick：直接回答，不做意图确认，也不在正文里生成记忆标记；回答持久化后仍由独立流程判断用户是否真实表现出值得长期保留的学习理解。
- deep：先调用 `/api/tutor/intent` 得到 `LearningIntentPlan`。模型应先利用已有课堂和个人上下文；没有真实歧义时前端立即开始，不展示内部置信度或额外确认卡。只有答案会明显改变路径时才暂停，并通常只返回 1 个动态选择问题（两个问题彼此独立且都足以改变路径时最多 2 个）。前端回传包含问题与选项语义的 `answers[{questionId, question, optionIds, optionLabels}]` 后取得最终计划并自动开始。意图确认后的第一轮必须执行第一个检查点，先给解释、示例、对比或微型练习；禁止继续追问目标、难点、水平与偏好等元问题。若仍需诊断，应从一个当场可答的小任务里判断，而不是让用户再次自我归类。
- 长期理解整理不依赖 quick / deep 开关：任一全局学习问答持久化后，`/api/tutor/memory` 都依据本轮用户真实表达/作答静默判断是否形成最多 2 条新增或更新的学习理解。证据不足返回空数组，愿望、建议、人格与敏感推断不能进入长期理解；访客态与 Tutor 主链路一致可用，route 内限流。
- 活跃学习线只由 deep 会话推进，和长期理解是否形成完全解耦：客户端先用本轮真实回答保存可恢复摘要，模型成功时再返回独立 `threadProgress{summary,nextStep}` 精炼累计进度。快捷问答不携带 `activeThread`，不得把临时问题写进正在继续的学习线；学习活动先落库，再串行整理长期理解与线索，避免并发画像写入互相覆盖。
- 深度线创建时绑定发起现场的 `sessionId`，实际持久化的深度回答会以 `global-ask:<conversationId>:` 稳定来源写入客观 Event，并且只有与 Task 的 `conversationId` 精确匹配时才追加为该 Task 证据；应用矩阵的生成结果只进入 `recentLearningActivities`，同一课堂里的闪卡自评、测验作答和讲给同桌听完成才会以 `app-interaction:` 证据原子更新线索摘要，跨课堂、跨会话或没有明确绑定的活动不会被强行归因。
- `activeLearningThread` 只是当前 Task 的快速指针；`learningThreads` 按 ID 保留最多 16 条历史。创建新 Task 会把旧活跃 Task 转为暂停，完成只清指针不删历史；同课应用互动把 `relatedSessionIds` / `relatedActivityIds` 作为可追溯证据追加到同一 Task，每类最多 24 个。
- “我的上下文 → 学习任务”是 Task 历史的用户控制面：进行中、暂停和完成状态都可见；用户可把活跃 Task 暂放或完成，也可重新打开任一历史 Task。恢复动作必须携带被点击的 `LearningThreadEntry` 直接初始化 deep 对话，不能依赖异步共享状态再猜当前 Task。
- Task 行的证据下钻只接受 `relatedActivityIds` 命中的 `recentLearningActivities`，最多展示最近 6 条；跨设备尚未回温时只显示“任务进展已保留”的诚实状态，不使用同课堂 `sessionId` 推测一条未绑定的 Event。
- 今日情报请求会继续携带课堂 provenance，并按“活跃 Task → 最近 8 条历史 Task → 长期理解 → 近期 Event”编排：历史 Task 只发送状态、摘要、后续、课堂数和练习数，不复制课堂正文；模型可以区分同课反馈、其他课堂和真正跨课互动，opaque ID 只做边界，不被展示为课程名称。
- `LearnerProfile.memories` 是模型整理、用户可纠正/暂停/忘记的学习理解；`recentLearningActivities` 是课堂、提问、材料和应用等客观学习现场，始终保持独立，不被自动升级或改写成对用户的判断。
- `GlobalAskPanel` 基于 ChatBase。登录态 `useGlobalAskHistory` 会先通过 `/api/conversations/sync` 排空当前账号的独立 outbox、拉取云端，再按 active learning thread 的 `conversationId`（无绑定时才取最近一条）从 IndexedDB 恢复；服务端快照默认给最近 20 个会话，但会在查询参数中额外钉住当前线索对应的旧会话，并按 JWT 账号归属过滤。若当前线索来自更早的本地历史，客户端会用独立 pinned bootstrap marker 先补传本地父会话和消息，只有服务端明确接受后才停止重试；基础同步已在进行时，客户端等待后执行这一步再去重补拉该 ID。首次持久化会把实际会话 ID 回填到学习线索，打开期间刚发出的乐观消息与迟到历史合并，不会被水合覆盖。首次启用会分批补传现有本地全局问答；登录后的匿名全局问答由独立认领通道迁移，服务端确认后才改变本地归属，失败保留重试；课堂复习聊天仍只进入对应 Workspace evidence，两个同步域不混用。

当前 prompt telemetry 版本：`2026-08-tutor-v12-goal-marker-contract`。goal 首次会面和 global deep 都遵循“先帮助、后理解”：不做画像或目标访谈，意图确认后立即交付第一个有效学习动作，仅在真实需要用户决定时追问。用户明确同意沉淀后，goal 必须逐字输出 `---我了解到的你---` / `---我想要的---` 与 `---结束---`，不得改写成 Markdown 分隔线或近义标题。

所有用户面对的 mode 都显式关闭 provider 原始思维链。深度学习仍由确认后的意图和检查点推进，但 UI 只展示可验证的任务状态与正式回答，不展示隐藏推理。长会话每轮最多重传最近 24 条 / 约 32k 序列化字符；课堂/附件材料最多 6 份、总计约 12k 字，且用户本轮主动附件优先于自动接入的最近内容。这样长期理解继续由独立 context 提供，历史长度不会线性拖慢 TTFT。

课堂同桌前端由 `useClassroomCompanion` 组合 `useClassroomCompanionHistory` 与 `useClassroomInlineApps`。历史按 session key 水合和持久化，切换课堂先中止旧 stream，禁止上一节课的迟到回答落入新课堂；同一课堂连续提问时，新问题会使旧请求失效，旧请求的迟到回调不得覆盖新流，用户主动停止则保留已经读到的部分回答。录课结束保留当前内存会话并追加收尾，不再异步重新水合覆盖收尾消息。发给模型的历史只包含真实非空文本，不包含 UI-only 的空应用卡或自动在场消息；每次请求读取当前模型偏好与当前 learner profile。

### 管理员 AI 控制中心

`/admin/ai-control` 提供 Tutor 六种 mode、Tutor 上下游的“学习意图确认 / 学习上下文整理”，以及应用矩阵全部六条生成链路的可观测与安全调优界面：

- 展示每条链路的产品入口、会注入的上下文字段、示例或从产品现场带入的真实上下文。
- 服务端预览基线 prompt、管理员追加指令、不可覆盖合同和最终系统输入；预览不调用模型。
- 管理员主动试跑时，同一份上下文与测试问题会分别运行当前线上配置和正在编辑的配置，返回两版真实回答、实际使用模型与耗时。试跑不写入用户对话、不保存或发布配置，但会产生两次模型调用成本。
- 支持 mode 级模型路由、草稿、发布与回滚。版本存储在 `AiControlRevision`，运行时读取最新已发布版本并做短缓存。
- 管理员不能替换完整基线 prompt，只能追加行为指令。隐私、引用、时间戳和模式边界等合同始终在追加指令之后重新附加。
- 意图确认与学习上下文整理共用 `learning-understanding-prompts.ts` 的代码基线；真实 API 链路和控制中心预览/对比读取同一份 system prompt 与 user input 拼装，避免后台展示一套、线上实际运行另一套。意图链路额外锁住“当前表达优先、无真实歧义不追问”，整理链路额外锁住“长期理解只以用户表现为证据”；活跃线索进度可以描述本轮讨论，却不能把助手讲过的内容冒充用户已掌握。
- 六类应用共用 `ai-native/app-prompts.ts` 的版本化基线。闪卡、测验、考试速查表、信息图与播客计划按各自结构化 JSON 合同试跑；思维导图保留单课轻结构 Markdown。速查表复用跨课来源与考试范围拼装；信息图强制一个中心命题、手机可读和证据化视觉关系；播客将去时间戳的朗读语料与带时间戳的章节定位证据分开，避免模型猜回放位置或把时间读进音频。管理员不能绕过课堂证据回锚、认知动作、学习层级、输出格式和视觉 / 音频价值边界。
- 没有已发布调整时，`/api/tutor/agent` 与代码内基线行为完全一致。

管理员默认看到与普通用户相同的产品，只有主动打开会话级“管理视图”后，产品界面才在真实 AI 功能旁显示轻量的“查看本次 AI”入口；退出登录或新浏览器会话会自动关闭。点击入口先在当前学习现场打开右侧透镜，使用当前线上 override 重建本次上下文字段、请求模型和最终系统输入；需要持久调整时才把上下文与最近一条用户问题暂存在 `sessionStorage` 后深链到控制中心。普通用户不渲染入口，现场上下文不写 URL、运行日志或额外持久化。服务端接口 `/api/admin/ai-control` 会再次验证 JWT 与 `user.role === 'admin'`。透镜显示的是请求模型；provider 异常后的最终备用通道以真实试跑结果或后端 telemetry 为准。

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

新 endpoint（和旧 `/api/tutor` 并存，灰度友好）。请求体可带 `model`，设置页会把用户选择透传进来；管理员已启用并发布的 mode 级模型路由优先于请求体选择。服务端用 `resolveTutorAgentProviderFallbacks(env, { modelId })` 生成 StepFun / DeepSeek / DashScope / OpenAI-compatible 候选，并始终用 `.chat()` 走 `/chat/completions`。

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
| Prompt 管理 | git 基线 + 管理员追加指令版本 | 任意替换完整 prompt | 保留可评测基线和硬合同，同时支持不发版调优与回滚 |
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
| `TUTOR_FIRST_TOKEN_TIMEOUT_MS` | `8000` | 单个 provider 的无首字熔断（范围 5000–45000ms）；超时切备用通道，已经开始输出的回答不截断 |
| `TUTOR_BASE_URL` | DashScope compatible endpoint | 非 DeepSeek/StepFun 模型的 Tutor OpenAI-compatible baseURL；StepFun 模型使用 `STEPFUN_BASE_URL`，DeepSeek 模型使用 `DEEPSEEK_BASE_URL` |

---

## 下一步

- [ ] M4.5: 扩 Tutor dataset 到 50 条真实/合成课堂问答
- [ ] M5: UI 层把 tool-call/result 帧渲染成 Workshop 产物卡片
- [ ] M5: `make eval-tutor-real` 作为 CI gate，综合 pass rate ≥90%
- [ ] M6: Tutor 支持多轮记忆（跨 session `LearnerProfile`）
- [ ] M6+: 主动性 Tutor（发现学生卡住了，主动 quiz）
