# 产品打磨升级路线图

> 2026-05 版，M1-M4 的主指引。
>
> 本文档是三份业界最佳实践调研的**决策收口**，每一条都能追到 ticket/PR。

---

## 总目标

把 meetmind-classroom-v2-hci-polish 从"能用的学习产品"打磨到"飞书妙记同级别的体感 + 真正会用工具的同桌"。

**标准**：
- ASR 感知质量追平飞书妙记（没真实数据——用合成课堂 + 评测 harness 量化）
- Tutor 升级为 agent loop，能主动调 Workshop 生成闪卡/测验/思维导图
- 全程 harness 驱动（没 harness 的改动不合并）

---

## 业界最佳实践决策表（锁定，不再扯皮）

| 层 | 选什么 | 不选什么 | 理由来源 |
|---|---|---|---|
| **Agent Loop** | Vercel AI SDK v6 `streamText + tools + stopWhen + onStepFinish` | LangGraph.js / OpenAI Agents SDK / 自写 while | 已装 ai@6，零迁移 |
| **工具协议** | `tool() + zod`，内部用 | MCP（等规模到了再上） | Workshop 是内部工具 |
| **Prompt 版本** | `lib/prompts/*.ts` + `PROMPT_VERSION` 常量 + git | Promptfoo/LangSmith Prompt Hub/Braintrust | 规模不到 |
| **Eval Harness** | **Promptfoo + TS grader + 冻结 fixture** | Ragas/DeepEval（Python 栈）、OpenAI Evals（锁死 OAI） | TS 单栈 + SWE-Bench 风格 |
| **Observability** | **Sentry `vercelAIIntegration()` + `pinoIntegration()` + pino** | 自建大型日志系统；OTel GenAI（还在 dev） | 一行集成即可 |
| **ASR 前处理** | Silero VAD (`@ricky0123/vad-web`) + WebRTC 原生 3A（关 AGC） | RNNoise 默认关；AEC 浏览器内置 | RNNoise 会削中文辅音 |
| **ASR 长音频** | ≤10min 分片 + 2s 重叠 + token-level LCS 缝合 | 无重叠硬切 | Whisper 官方推荐 |
| **ASR 可靠性** | `reconnecting-websocket` + `p-retry` + timeOffset 单调 | 自写重连 | AWS Full Jitter 退避 |
| **ASR 后校对** | Qwen3-Max 只打低置信片段 | LLM 校对全部；WeTextProcessing（双重 ITN） | 降 CER 1.5-2.5pp |
| **热词** | Qwen3-ASR-Flash `context` 动态注入课程/名单（最多 10k tokens） | 传统 hotword weight | 飞书妙记 80% 的差距在这里 |
| **三段式渲染** | interim(灰斜体) / stable(黑) / final(commit) | 单文本跳变 | 感知稳定度 >> 字面准确度 |
| **评测数据** | AISHELL-1 + WenetSpeech test_meeting + CosyVoice 2 合成 × MUSAN SNR 5/10/15/20 | 光跑真实数据（没有） | 没真实数据的唯一科学绕法 |
| **评测指标** | 按字切 jiwer-style CER + Qwen3-Max LLM-as-Judge 兜底 | 自己发明指标 | 中文按字不按词 |
| **ASR 主引擎** | Qwen3-ASR-Flash | AssemblyAI Universal-2 / Deepgram Nova-3 | 中文 CER 4.2% 目前无对手 |
| **ASR 兜底** | gpt-4o-transcribe（英文）；Whisper large-v3-turbo（离线） | 新引擎生态负担 | 只在特殊场景触发 |
| **说话人分离** | 火山引擎流式双声道（MVP）；pyannote 3.1（长期备选） | 自建 pyannote；diart（中文不稳） | MVP DER 8% |

---

## 路线图

### M1 · 可观测底座 + Harness 骨架（已完成 ✓）

**分支**：`milestone/m1-observability-foundation`

**交付物**：
- [x] `src/lib/logger.ts` 升级为 pino backend（结构化 JSON，带 ALS requestId/userId），保持原 API
- [x] `src/lib/logger.ts` 新增 `track(event)` 四大路径埋点（asr / tutor / echo / sync）
- [x] `instrumentation.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts` + `instrumentation-client.ts`
  - `vercelAIIntegration` 自动捕获 AI SDK v6 step/tool span
  - `pinoIntegration` 映射 warn/error 为 breadcrumbs + logs
- [x] `tests/eval/` 骨架（SWE-Bench 风格）：`{asr,tutor}/{datasets,graders,fixtures,runs}` + `README.md`
- [x] **ASR harness**：`cer.ts` CER 指标 + 10 条 seed `seed-zh-classroom.jsonl`
- [x] **Tutor harness**：三个 grader（tool-selection / timestamp-citation / learning-rubric）+ 8 条 seed
- [x] **Runner**：`npx tsx tests/eval/asr/runner.ts` + `tests/eval/tutor/runner.ts`；写 JSONL trace 到 `runs/`
- [x] **战术拆分**：`server.js` 1341 → 1186 行；抽出 `server/asr/text-utils.js`（11 个纯函数 + 单测）
- [x] `make eval` / `make eval-asr` / `make eval-tutor` / `make test-all` 入口
- [x] 依赖：`@sentry/nextjs@10.51` / `pino@10.3` / `p-retry@7.1` / `reconnecting-websocket@4.4` / `promptfoo@0.121`

**基线（M2 起的对照基准）**：
```
[asr-eval]   10 case(s) | avg_cer=1.46% | p95_cer=8.33% | failed=0
[tutor-eval] 7/8 passed | tool=100.0% cite=66.7% rubric=100.0%
```

**测试统计**：
- `make test` (src/): baseline
- `make test-server` (server/asr/): 26/26
- `make eval-unit` (grader 单测): 29/29
- `make eval-asr` (dry-run): 10/10 valid
- `make eval-tutor` (dry-run): 7/8（1 条故意构造的 citation-fail 断言 harness 能检出）

---

### M2 · ASR 飞书妙记级工艺（已完成 ✓）

**分支**：`milestone/m2-asr-feishu-grade`

**交付物**（基于 M1 harness 量化对照）：

#### P0 稳定性四修
- [x] **T2.1** 长音频分块 timeOffset 失败传播 bug 修复（`stitchSegments` 新实现；失败块的 offset 按分块定义累加、`failedIndices` 显式返回）
- [x] **T2.2** `DashScopeASRClient` 自动重连（Full Jitter 退避，audioQueue 保留跨重连；重连成功后 flush）
- [x] **T2.3** `p-retry` + Full Jitter 替换线性 polling；总预算 5min → 10min
- [x] **T2.4** ASR 响应体新增 `failedSegmentIndices / partialFailure`，前端可局部重试 + 友好降级

#### P1 飞书级工艺
- [x] **T2.5** 动态 contextual biasing：`buildASRContextHint` 扩展 `courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords`
- [x] **T2.6** 三段式渲染状态机 `TranscriptRenderMachine`（interim/stable/final，stabilizationCount + stabilizationMs 双门控）
- [x] **T2.7** 长音频分片：SEGMENT_DURATION 180s → 600s（10min），2s overlap + token-level LCS 缝合（`stitchSegmentsWithOverlap`）
- [ ] T2.8 LLM 后校对（低置信片段）—— 依赖 Qwen3-ASR 返回 logprob，推迟
- [ ] T2.9 用户纠错闭环 MVP —— 推迟到 M2.5 Sprint，需要 DB schema 变更

#### 进阶 + 配置
- [x] **T2.11** `.env.example` 文档化 AGC/AEC/NS 约束选项，当前默认保持 `AGC=on/AEC=off/NS=on`（课堂场景调研推荐）
- [x] **T2.22** `qwenAsyncCaller` 为 harness 接入真实 Qwen3-ASR-Flash async API；`make eval-asr-real` 可跑

#### 观测 + 埋点
- [x] `transcribe-fast/route.ts` 全链路 `track()` 埋点（start/success/fail + 错误码 + partial failure）
- [x] `DashScopeASRClient` 重连路径 track（`mode: 'realtime-reconnect'`）

**M2 交付的关键代码文件**：
- `src/lib/services/asr/text-utils.ts` + `.test.ts`（27 测试）：stitch + overlap stitch + fullJitterDelay + LCS
- `src/lib/services/asr/render-state-machine.ts` + `.test.ts`（10 测试）：三段式状态机
- `src/lib/utils/page/context-and-format.ts`：contextual biasing 扩展
- `src/app/api/transcribe-fast/route.ts`：分片 + 重叠 + Full Jitter polling + 埋点
- `src/lib/services/dashscope-asr-service.ts`：重连 + audioQueue 保留 + 埋点
- `tests/eval/asr/qwen-caller.ts`：真实 Qwen3-ASR-Flash 调用器

**测试统计**（M2 交付时）：
- `make test` (src/): **184 passed** (M1 基线 151 + M2 新增 33)
- `make test-server`: 26 passed
- `make eval-unit`: 29 passed
- `make eval-asr --dry-run`: 10/10 valid（基线 1.46% / p95 8.33% 保持）
- `make eval-asr-real`: 可用，要求 audio URL 公网可达 + DASHSCOPE_API_KEY

**M2 结束标准**（等业主提供公网 audio 后的验收）：
- `make eval-asr-real` 在 AISHELL-1 / 合成课堂 dataset 跑出真实 CER
- 稳定性：WebSocket 自动重连 > 5 次测试（需人工/E2E）
- 合规测试（hotword / context 注入）：通过合成数据验证 CER 下降 ≥ 15%

---

### M3 · Tutor 会用工具的同桌

**分支**：`milestone/m3-tutor-tool-use`

**交付物**：
- [ ] **T3.1** `src/lib/prompts/` + `PROMPT_VERSION` 常量；`experimental_telemetry.metadata.promptVersion` 传给 Sentry
- [ ] **T3.2** `src/lib/tutor/tools/` 把 Workshop 10 个插件包装成 `tool() + zod` schema
- [ ] **T3.3** `src/app/api/tutor/route.ts` 改造成 `streamText + tools + stopWhen(stepCountIs(6)) + onStepFinish`
- [ ] **T3.4** UI 层：Tutor 消息流中内嵌 Workshop 产物卡片（闪卡/测验/思维导图）
- [ ] **T3.5** 工具调用失败的兜底话术（不是"执行失败"而是"要不要换一种方式"）
- [ ] **T3.6** Tutor 能引用转写时间戳 `[t=MM:SS]`；点击跳转到课堂转写
- [ ] **T3.7** `tests/eval/tutor/runner.ts` 接入真实 streamText caller；扩 dataset 到 50 条
- [ ] **T3.8** CI: `make eval-tutor` 作为合并 gate，tool/citation/rubric 三指标综合 pass rate ≥90%

**M3 结束标准**：
- Tutor 在 50 条 dataset 上 tool-selection ≥95%、citation ≥90%、rubric ≥80%
- Sentry 面板能看到每次 Tutor 调用的 agent step 耗时、token、cost、错误

---

### M4 · 文档 + release 收口

**分支**：`milestone/m4-docs-and-polish`

- [ ] CHANGELOG + 每个 milestone 的 release note
- [ ] DOMAIN.md 补齐新目录（tests/eval/, server/asr/）
- [ ] 撰写 `docs/OBSERVABILITY.md`、`docs/ASR_PIPELINE.md`、`docs/TUTOR_AGENT.md`
- [ ] 更新 README 指向本路线图

---

## 工作原则（harness 思想）

1. **没 harness 的改动不合并**：ASR / Tutor 任何 PR 必须带前后对比数字
2. **冻结 fixture 是真理**：`datasets/*.jsonl` + `fixtures/` 的改动需要 reviewer 确认
3. **每周跑一次全量 eval**：数字写进 release note，形成"可复现的历史"
4. **Sentry 是线上生产的唯一窗口**：任何线上用户反馈先查 Sentry span 再动手
5. **调研先行**：新技术 / 新依赖要在 `docs/research/` 留一份一页纸 pro/con（抄本文档的格式）

---

## 明确**不做**清单（避免扩张）

- ❌ 引入 LangGraph / OpenAI Agents SDK（已装 Vercel AI SDK）
- ❌ 引入 Whisper/AssemblyAI/Deepgram 作为主 ASR（Qwen 够用）
- ❌ 自建 pyannote 说话人分离（等数据量到了再说）
- ❌ LangSmith / Braintrust / LangFuse（Sentry AI 够用）
- ❌ i18n（等出海再说）
- ❌ CRDT 冲突解决（等多设备成规模再说）
- ❌ 重写 `page.tsx 2302 行` / `Recorder.tsx 1781 行`（不卡 M2/M3 主线）
- ❌ 多 agent 架构（先让单 agent 会用工具）

---

## 关键文件索引

- 本文档：`docs/UPGRADE_PLAN.md`
- Logger：`src/lib/logger.ts`（pino-backed + track）
- Sentry：`instrumentation.ts` / `sentry.server.config.ts` / `instrumentation-client.ts`
- Harness README：`tests/eval/README.md`
- ASR 工具函数：`server/asr/text-utils.js`（+ `.test.js`）
- CER grader：`tests/eval/asr/graders/cer.ts`
- Tutor grader：`tests/eval/tutor/graders/{tool-selection,timestamp-citation,learning-rubric}.ts`
- Runner：`tests/eval/asr/runner.ts` / `tests/eval/tutor/runner.ts`
- Makefile：`make eval` / `make eval-asr` / `make eval-tutor` / `make test-all`
