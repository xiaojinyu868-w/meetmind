# CHANGELOG

产品打磨升级（2026-05 四个 Milestone）的里程碑日志。
每条都可追到 `docs/UPGRADE_PLAN.md` 决策表和 GitHub 分支 commit。

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
