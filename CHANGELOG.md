# CHANGELOG

产品打磨升级（2026-05 四个 Milestone）的里程碑日志。
每条都可追到 `docs/UPGRADE_PLAN.md` 决策表和 GitHub 分支 commit。

---

## 2026-05-30 — 接入阶跃星辰 StepFun 作为默认 AI

- **新 provider**：`src/lib/config/app.config.ts` + `src/lib/services/llm-service.ts` 增加 `stepfun` provider，模型 `step-3.7-flash`（OpenAI 兼容，base URL `https://api.stepfun.com/v1`，文档：https://platform.stepfun.com/docs/zh/quickstart/overview）
- **默认模型切换**：MeetMind 全链路（课堂同桌 / 复习 Tutor / 学习应用 / 速查表 / 闪卡 / 测验 / 思维导图 / Studio 等）默认改用 `step-3.7-flash`；保留 DeepSeek、DashScope 作为 fallback，用户可在 `/settings` 切换
- **Tutor agent 路由**：`src/lib/utils/tutor-agent-provider.ts` 识别 `step-*` 模型并路由到 StepFun，fallback 链改为 `step-3.7-flash → deepseek-v4-flash → qwen3.6-plus`
- **设置页**：现有模型选择器自动通过 `/api/chat` 拉取 StepFun 模型；`AI_MODEL_PREFERENCE_KEY` 偏好契约不变
- **环境变量**：`STEPFUN_API_KEY` / `STEPFUN_BASE_URL` 加入 `.env.example`；`LLM_MODEL` / `TUTOR_MODEL` 默认值改为 `step-3.7-flash`

---

## M11 — v3.0 SharedAgent · 场景上下文成为分享单元（进行中）

**一句话**：MeetMind 的产品同构性换轨——「场景上下文」从个人收纳升级为可被分享的、有人格的容器；Agent 是裂变载体，班级是增长单元。

战略文件：`roadmap/v3.0-virality-agent.md`（北极星，与本文件冲突时以那份为准）。

### 新增

**战略 / 文档**
- `roadmap/v3.0-virality-agent.md` — v3.0 战略锁定（场景层 vs 个人层、应用矩阵分层、裂变形态约束、M11-M15 路线图）
- `src/app/api/share/DOMAIN.md` / `src/app/share/DOMAIN.md` / `src/components/share/DOMAIN.md` — 三处目录索引

**数据模型（Prisma）**
- `SharedAgent` —— 一个被分享出去的 Agent 快照（token / snapshotJson / artifactKind / 计数器 / status / expiresAt）
- `ShareInteraction` —— view / chat / claim / reshare 埋点
- `ShareClaim` —— `(shareId, claimerUserId)` 唯一，幂等领取记录

**业务层**
- `src/lib/services/share-agent-service.ts` —— `createSharedAgent` / `getSharedAgentByToken` / `getSharedAgentInternal` / `claimSharedAgent` / `revokeSharedAgent` / `trackShareInteraction`
- `SharedAgentSnapshotSchema`（zod）— 接受场景层产物 + transcriptDigest，**禁止个人层数据进入 snapshot**

**API 路由**
- `POST /api/share/agent` —— 创建分享（鉴权 / zod parse / token 碰撞重试）
- `GET /api/share/[token]` —— 公开读，自动写 view 埋点；404 不区分原因（防泄露存在性）
- `POST /api/share/[token]/track` —— 公开埋点（chat / reshare）
- `POST /api/share/[token]/claim` —— 领取到 claimer workspace（创建 WorkspaceCapture）

**Tutor agent**
- `/api/tutor/agent` 新增 `mode: 'shared'` + `shareToken` 字段
- `buildTutorSystemPrompt` 新增 `'shared'` 分支 + `buildSharedModeSegment(sharerNickname, courseTitle)` + `capSharedContext`
- 隐私铁律：分享态显式跳过 `learnerProfile` 注入；禁用 native tools；inline app marker 默认关
- 分享态自动写一条 `chat` interaction 到 `ShareInteraction`

**前端**
- `src/app/share/[token]/page.tsx` —— Next.js 路由壳
- `src/app/share/[token]/SharedAgentLanding.tsx` —— 落地页主体（Octo Buddy + 头部 + 转录摘要 + artifact 预览 + 对话面板 + 粘底动作栏）
- `src/app/share/[token]/SharedAgentChat.tsx` —— 分享态对话面板，`useChat` + `DefaultChatTransport(api='/api/tutor/agent')`
- `src/components/share/ShareAgentCard.tsx` —— Canvas 长图（暖白底 + 深褐字 + URL 显式可读）
- `src/components/share/useShareAgentCreator.ts` —— 一键创建分享 + 弹卡片的钩子，让任何上层 UI 一行接入

**用户面文案**
- `src/lib/ui/copy.ts` 新增 `share.landing` / `share.creator`（claimAction / reshareAction / chatPlaceholder / sharerNickname / artifactTitle ...）

**埋点**
- `logger.ts` `TrackEvent` 新增 `share.create` / `share.interaction` / `share.fail`

### 变更

- `prisma/schema.prisma` — `User` / `Workspace` 增加反向关系到 `SharedAgent` / `ShareInteraction` / `ShareClaim`
- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 联合类型扩展为 `'in-class' | 'review' | 'shared'`，`TutorSystemContext` 新增 `shared` 字段
- `AGENTS.md` — "by task type" 表新增「改 SharedAgent / 分享 Agent / 裂变」一行；架构速查补 `app/share` 和 `api/share` 索引；当前里程碑改为 M9 + M10 + M11

### 隐私边界（必读）

- snapshotJson **永远不带**原作者的 chat history、`learnerProfile`、个人层应用产物（闪卡 / 薄弱点 / 学习报告默认私有）
- `PublicSharedAgent` 类型故意不带 `ownerId` / `workspaceId`，防社工
- 分享态对话**不读**访问者本地 conversation，**不写**回流到原作者
- snapshot 是 share-time 刻一份，原作者后续修改不影响分享出去的副本

### M11 已完成 vs 待办（在后续 Sprint 落地）

✅ 已完成：
- 数据模型 + 4 个 API + tutor mode='shared' + 落地页 + 对话面板 + Canvas 长图 + 创建器 hook
- 全链路 `make check` 通过（0 类型错误）

🟡 待集成（M11 收尾）：
- 把 `useShareAgentCreator` 接入 `src/components/classroom/ClassroomRecordingView.tsx` 录课结束动线（Octo Buddy 「递结晶」按钮）
- `make eval-tutor` 增加 shared 模式 baseline
- 5 人班级灰度跑数：观察 K 系数
- M11.5：扫码二维码渲染（依赖 qrcode 包）
- M12：应用矩阵 UI 分组「带回去用 / 分享出去」 + 班级共错卡

### 验收

- ✅ `npx tsc --noEmit` 零错误
- ✅ `prisma db push` 成功，`prisma generate` 成功
- ✅ 全链路接口可达（POST /api/share/agent → GET /api/share/[token] → /share/[token] → /api/tutor/agent mode='shared' → POST /api/share/[token]/claim）

---

## M3 — Tutor 会用工具的同桌（`milestone/m3-tutor-tool-use`）

**一句话**：Tutor 从"LLM 文本框"升级为 agent loop，能主动调 Workshop 插件生成闪卡/测验/思维导图，能引用课堂转写时间戳 `[t=MM:SS]`。

### 新增
- `src/lib/prompts/tutor-prompts.ts` — prompt 版本化（`VersionedPrompt` + `PROMPT_VERSIONS`）
- `src/lib/tutor/tutor-tools.ts` — 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript）
- `src/app/api/tutor/agent/route.ts` — 新 agent loop endpoint，`streamText + stopWhen(stepCountIs(6)) + onStepFinish`
- `tests/eval/tutor/real-caller.ts` — harness 接入真实 LLM + tools
- `make eval-tutor-real`

### 变更
- `TUTOR_SYSTEM_V3` 明确工具使用原则 + 时间戳格式 + 失败话术
- `onStepFinish` 每步 `track({kind:'tutor.step'})` 埋点
- Sentry `experimental_telemetry.metadata.promptVersion` 注入

### 新增依赖
- `@ai-sdk/openai@3.0.62`

### 验收
- src tests: **190 passed**（+6 tutor-tools）
- 0 新类型错误

---

## M2 — ASR 飞书妙记级工艺（`milestone/m2-asr-feishu-grade`）

**一句话**：根据"飞书妙记 80% 差距在工艺"的判断，落地 P0 四修（稳定性）+ P1 飞书级工艺（contextual biasing / 三段式渲染 / 重叠缝合）。

### 新增
- `src/lib/services/asr/text-utils.ts` — `stitchSegments` / `stitchSegmentsWithOverlap` / `findOverlapLength` / `fullJitterDelay`（27 单测）
- `src/lib/services/asr/render-state-machine.ts` — `TranscriptRenderMachine`（interim / stable / final 三段式，10 单测）
- `tests/eval/asr/qwen-caller.ts` — harness 接入真实 Qwen3-ASR-Flash async API
- `make eval-asr-real`

### 变更
- **T2.1** `transcribe-fast/route.ts`: `stitchSegments` 替换内联 timeOffset 逻辑，修复失败传播 bug；响应体新增 `failedSegmentIndices / partialFailure`
- **T2.2** `DashScopeASRClient`: `userStopRequested` flag + `scheduleReconnect` + `doReconnect`，Full Jitter 退避，audioQueue 跨重连保留
- **T2.3** `waitForSingleTask`: `p-retry` + Full Jitter 替换线性 polling，总超时 5→10min
- **T2.5** `buildASRContextHint` 扩展 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **T2.7** 长音频分片 180→600s + 2s overlap + LCS 缝合；`ASR_SEGMENT_DURATION_SEC` / `ASR_SEGMENT_OVERLAP_SEC` 环境变量可配

### 验收
- src tests: 151 → **184 passed**（+33）
- harness baseline 保持
- 0 新类型错误

---

## M1 — 可观测底座 + Eval Harness（`milestone/m1-observability-foundation`）

**一句话**：结束"改改试试"的玄学开发模式——结构化日志 + Sentry AI + SWE-Bench 风格 eval harness 一次性铺到位，后续所有改动都要在 harness 上量化。

### 新增
- **可观测性**
  - `src/lib/logger.ts` — pino backend + AsyncLocalStorage 注入 `requestId/userId` + `track()` 四路径埋点
  - `instrumentation.ts` / `sentry.{server,edge}.config.ts` / `instrumentation-client.ts`
  - `vercelAIIntegration` 自动捕获 AI SDK step/tool span
  - `pinoIntegration` 自动映射日志为 Sentry breadcrumbs
- **Eval Harness**（SWE-Bench 风格）
  - `tests/eval/{asr,tutor}/{datasets,graders,fixtures,runs}` 目录
  - `cer.ts` — 按字切 Levenshtein + 归一化（14 单测）
  - `tool-selection.ts` / `timestamp-citation.ts` / `learning-rubric.ts`（LLM-as-judge，离线自动跳过）
  - ASR seed dataset 10 条 + Tutor seed dataset 8 条
  - `make eval` / `eval-asr` / `eval-tutor` / `eval-unit`
- **战术拆分**
  - `server.js` 1341 → 1186 行（-155）
  - `server/asr/text-utils.js`（11 个纯函数 + 26 单测）

### 新增依赖
- `@sentry/nextjs@10.51` / `pino@10.3` / `p-retry@7.1` / `reconnecting-websocket@4.4` / `promptfoo@0.121`

### 验收基线
- `asr-eval`: 10 case / avg_cer=1.46% / p95=8.33% / failed=0
- `tutor-eval`: 7/8 passed / tool=100% cite=66.7% rubric=100%
- src tests: **151 passed**
- server tests: **26 passed**
- eval-unit: **29 passed**

---

## 主要指导原则（见 `docs/UPGRADE_PLAN.md`）

- **不造轮子**：调研 → 决策 → 用现成工具
- **harness 驱动**：没量化对比的改动不合并
- **灰度友好**：不改旧 endpoint，新 endpoint 并存（/api/tutor/agent）
- **明确不做**：LangGraph / MCP / Whisper / pyannote / i18n / CRDT / LangSmith / Braintrust

## 下一步（Next Sprint 建议）

- [ ] 扩 Tutor dataset 到 50 条 + `make eval-tutor-real` 作为 CI gate
- [ ] 用 AISHELL-1 / CosyVoice 合成课堂 / MUSAN 噪声扩 ASR dataset
- [ ] 纠错闭环 MVP（T2.9）：`POST /api/asr/corrections` + 周度聚合进 `userHotwords`
- [ ] 前端接入 `/api/tutor/agent`（feature flag 灰度）
- [ ] Tutor 消息流中渲染 Workshop 产物卡片（T3.4）
- [ ] 说话人分离 MVP（火山引擎双声道）
