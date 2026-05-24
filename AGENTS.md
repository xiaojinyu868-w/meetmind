# Agent Rules — MeetMind

> 你是接手 MeetMind 的 AI 开发者。读完这份文件再动手。
> 详细规则在 `skills/` 目录中，本文件只给你最核心的上下文。

---

## 0. Agent 阅读路径（最先读这里）

拿到任务后，按以下顺序阅读，效率最高：

```
第 1 步：本文档（AGENTS.md）→ 第 1-5 节（命令 + 产品 + Big Picture + Skills + 设计系统）
第 2 步：skills/making-changes/SKILL.md → 了解 Plan→Execute→Verify→Commit 流程
第 3 步：根据任务类型选择 ↓
```

### 按任务类型选择阅读路径

| 任务类型 | 阅读顺序 |
|---------|---------|
| **改 UI / 组件** | `src/components/DOMAIN.md` → 对应子目录 DOMAIN.md → 具体组件 |
| **改课堂同桌 / Hero / 内联 app 卡** | `src/components/classroom/DOMAIN.md` → 对应组件（注意：Skill chip 走 `<open_app:KEY/>` 链路，不是 `/api/apps/execute` 直调） |
| **改复习态 Tutor / Skill chip / Tool card** | `src/components/tutor/DOMAIN.md` → 对应组件 |
| **改 Workshop 应用窗口** | `src/components/apps/windows/DOMAIN.md` → 对应窗口组件 |
| **改页面路由** | `src/app/DOMAIN.md` → 对应 page.tsx |
| **改 API 接口** | `src/app/api/DOMAIN.md` → 对应子目录 DOMAIN.md → route.ts |
| **改 Tutor 后端** | `src/app/api/tutor/DOMAIN.md`（M10：`/api/tutor/agent` 是三个对话入口的唯一后端，按 `mode: 'in-class' \| 'review'` 分支） |
| **改 prompt** | `src/lib/prompts/tutor-prompts.ts`（mode-driven `buildTutorSystemPrompt`） + `项目开发文档/提示词设计哲学.md` |
| **改业务逻辑（service）** | `src/lib/services/DOMAIN.md` → 找到对应 service 文件 |
| **改 ASR 链路** | `src/lib/services/asr/`（text-utils / render-state-machine / post-edit / audio-constraints） |
| **改 AI-Native 插件** | `src/lib/ai-native/plugins/DOMAIN.md` → 对应 plugin |
| **改用户面文案** | `src/lib/ui/copy.ts`（**唯一真相源**——不要把字符串散落到组件里） |
| **改状态管理** | `src/stores/DOMAIN.md` → 了解哪些状态已迁移到 store |
| **改类型定义** | `src/types/DOMAIN.md` → `src/types/index.ts` |
| **改配置** | `src/lib/config/DOMAIN.md` → `src/lib/config/app.config.ts` |
| **改模型 / LLM provider / API key / 默认模型** | `src/lib/config/DOMAIN.md` → `src/lib/config/app.config.ts` → `src/lib/services/DOMAIN.md` → `src/lib/services/llm-service.ts` → `src/lib/utils/tutor-agent-provider.ts` → `src/app/api/tutor/DOMAIN.md` → `src/app/api/tutor/agent/route.ts` → `docs/TUTOR_AGENT.md` |
| **改设置项 / 用户偏好** | `src/app/DOMAIN.md` → 设置页 `page.tsx` → `src/lib/utils/DOMAIN.md`（偏好 key / 解析）→ 所有消费该偏好的 hooks / components |
| **改工具函数** | `src/lib/utils/DOMAIN.md` → 对应 utils 文件 |
| **处理 bug** | `skills/debugging/SKILL.md` → 先诊断再动手 |
| **改 God File (page.tsx)** | `src/app/DOMAIN.md` → 理解数据流 → 找对应功能区 → 精确替换 |

### 铁律

- **每次改完必跑 `make check`**（tsc 类型检查）
- **改 ASR / Tutor 前后必跑 `make eval-asr` / `make eval-tutor`**（数字波动 = 回归信号）
- **只读 DOMAIN.md，不确定的再读源码**
- **不要发明新脚本，只用 Makefile 里的命令**
- **代码和文档必须一起交付**：凡是改了配置、模型、路由契约、目录结构、关键文件、依赖边界、默认行为或用户可见流程，必须同步更新对应 `DOMAIN.md` / `AGENTS.md` / `docs/*` / `.env.example`
- **新增目录若包含 3 个以上源码文件，或承担独立职责，必须补一个 `DOMAIN.md`**
- **用户面字符串必须 `import { COPY } from '@/lib/ui/copy'`，禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎**

---

## 1. Golden Commands

**日常开发**
```bash
make dev          # 启动开发服务器（默认端口 3001，PORT 可覆盖）
make check        # 类型检查（最常用，每次改完必跑）
make build        # 生产构建（限单核 + 1GB 内存，防 OOM）
make deploy       # 构建 + PM2 重启
```

**代码质量**
```bash
make test         # 运行 Vitest 单元测试（src/）
make test-server  # server/ 下 ASR 工具函数单测
make test-all     # src/ + server/ + eval/ 全套
make test-watch   # 单元测试 watch 模式
make lint         # ESLint 检查（--max-warnings 0）
make smoke        # 端到端 smoke：路由/WS/auth/API 全通（需 dev server 在 3101）
make clean-logs   # 自动清理所有 console.log 残留
make stats        # 项目统计（超标文件、console.log 残留）
```

**Eval Harness（M1 底座，SWE-Bench 风格）**
```bash
make eval               # 完整套件（unit + ASR + Tutor）
make eval-unit          # grader 自身单测
make eval-asr           # ASR dry-run（基于 seed 数据集）
make eval-asr-real      # ASR 真实调用（需 DASHSCOPE_API_KEY + 公网 audio URL）
make eval-tutor         # Tutor dry-run
make eval-tutor-real    # Tutor 真实调用（优先 DEEPSEEK_API_KEY；也兼容 OPENAI_API_KEY / DASHSCOPE_API_KEY）
make eval-guard         # CI gate：baseline 在 tests/eval/baselines/
make eval-guard-update  # 接受当前数字为新 baseline（慎用）
make eval-ci            # CI 完整流程：unit + asr + tutor + guard
```

**数据库**
```bash
make db-push      # 同步 Prisma schema 到 SQLite
make db-studio    # 打开 Prisma Studio
```

**只用这些命令。不要发明新脚本。**

### 文档同步检查（没有单独命令，必须走人工清单）

每次代码变更后，在 `make check` 之前先做一次文档同步判断：

| 变更类型 | 必须同步 |
|---------|---------|
| 新增 / 删除 / 重命名文件、目录、关键职责 | 对应目录 `DOMAIN.md` + 必要时 `AGENTS.md` 架构速查 / 关键文件 |
| 新增 API 路由、请求体字段、响应契约、stream marker | `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example` + `docs/TUTOR_AGENT.md` + `AGENTS.md` |
| 改 Tutor / ASR / AI-Native 主链路 | 对应 `DOMAIN.md` + `docs/TUTOR_AGENT.md` / `docs/ASR_PIPELINE.md` / `src/lib/ai-native/DOMAIN.md` |
| 改用户面文案或设置项 | `src/lib/ui/copy.ts` 或设置页说明 + 偏好 key 所在 `DOMAIN.md` |

判断方式不是运行新脚本，而是用 `git diff --name-only` 看本次改动，再按上表补齐文档。最终验证仍然只用 Makefile 命令：`make check`，必要时加 `make eval-*` / `make test`。

---

## 2. 产品是什么

MeetMind 是以学习者长期上下文为中心的 AI 学习产品。

**一句话**：用户像发微信一样把学习现场发给 MeetMind，先收下，后台慢慢理解，理解成熟后自然长出**同桌、回声、复习、Tutor**。

**当前聚焦**：课堂场景。一个大学生录了一节课 → MeetMind 当场作为 AI **同桌**陪他听 → 课后基于用户真实意图帮他解释、定位、复述、验证或生成闪卡 / 测验 / 速查表 / 思维导图 / 学习报告 → 生成一张让他忍不住分享到班级群的回声卡。

**当前里程碑**：M9（agent-native 同学：identity + citations + inline apps in chat）+ M10（mode-driven prompts，三入口收口为 `/api/tutor/agent`）。详见 `docs/UPGRADE_PLAN.md` 和 `CHANGELOG.md`。

### Taste（任何改动都必须对齐）

**顶层原则：视觉为智能让路。安静是底色，智能是主角，仪式感是点缀。智能 = 用户意图理解 + 模型能力；遵循 The Bitter Lesson，产品层提供上下文、工具和渲染契约，不用硬规则替模型判断意图。**

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促。95% 的界面保持极简克制 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件，引用都能跳回 `[MM:SS]` 转录 |
| **第一印象** | 学生打开 MeetMind，第一反应应该是「这个 AI 真的懂我在学什么」——不是"好看"，不是"安静"，是**智能**。视觉为这个目标服务 |

### 仪式时刻白名单（允许破戒的 5 个场景）

日常 95% 的界面**仍然**遵守「平涂、克制」，但以下 5 个关键仪式时刻允许情绪化视觉（渐变/光晕/柔光）：

1. **录音中的呼吸球**：柔光渐变（粉→紫→蓝低饱和度）+ 高斯模糊光晕 + 呼吸动画。停止即消散。
2. **AI 正在"酿"的提示**：右栏或卡片边缘一道极淡的彩色气息流过，< 1.5s，不阻塞交互。
3. **Echo 卡片生成完成的瞬间**：一道柔光扫过卡片。
4. **录课结束的收尾动画**：屏幕中央极简收束动画，像合上一本笔记。
5. **Tab 切换 / AI 流式输出**：字符逐个浮现（stagger），让学生**看见** AI 在思考。

**除此以外，其他任何地方禁止**：`bg-gradient-*`、`shadow-*`、`ring-*` 装饰、非系统 Tailwind 色、emoji 作 UI 元素。

### 用户面文案（M9 zero-prompt 原则）

- 唯一真相源：`src/lib/ui/copy.ts`，所有出现在 UI 的字符串必须 `import { COPY }` 引用
- 角色名："**同学**"（不是 tutor / 助教 / 客服）
- 禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎 / 引导（这些是开发者黑话）
- 首选词：笔记总结 / 整理 / 预感 / 应用 / 同学
- **零提问产品**：机器应该 act，不该 ask；UX 决策埋进静默后端行为，仅按需 hover 浮现

---

## 3. Big Picture Architecture

> 以下架构需要阅读多个文件才能理解全貌，是代码库的"根"。

### 3.1 DOMAIN.md 文档生态系统

整个代码库使用 **DOMAIN.md 模式**：每个重要目录都包含一个 `DOMAIN.md`，作为该域的索引、依赖规则和文件清单。这不是可选文档——它是架构的一部分。

- 阅读顺序：先读该目录的 `DOMAIN.md`，再读具体源码
- 新增目录若包含 3+ 源码文件或承担独立职责，**必须**补 `DOMAIN.md`
- 目录结构或依赖边界变化时，**必须**同步更新对应 `DOMAIN.md`

### 3.2 双存储架构

| 层级 | 技术 | 用途 | 说明 |
|------|------|------|------|
| 服务端 | Prisma 7.2 + SQLite | 用户数据、Workspace、Echo、AsrCorrection / AsrHotword | `prisma/schema.prisma` |
| 客户端 | Dexie.js (IndexedDB) | 转录文本、本地缓存、离线状态 | `src/lib/db/` |

**关键决策**：IndexedDB 是客户端真实数据源，服务端 SQLite 是同步备份。组件直接从 IndexedDB 读取，API 成功后回写本地。

### 3.3 核心数据流：收 → 酿 → 应

```
用户输入（录音/链接/文件/文字）
  → context-reach 识别内容类型
  → page.tsx 路由到对应 handler
  → 调用 API route（薄壳，只转请求/响应）
  → services 处理业务逻辑
  → 返回结果 → IndexedDB 持久化 → UI 更新
  → 后台触发 Echo / 复习 / Tutor 生成（"酿"）
```

**"酿"是隐式的**：后台理解过程不体现在界面上，只在用户"伸手"时通过 AI 回答质量体现。

### 3.4 AI-Native 插件系统

`src/lib/ai-native/plugins/` 是 Workshop 应用的运行时（17 个 plugin）。每个插件实现统一的 `AppPlugin` 契约：

- `manifest.id` + `canHandle(context)` + `run(context, tools)`
- 输出 `AppExecutionResult { cards, trace, render }`，前端统一交给 `AppRenderSurface` 渲染；WorkshopWindow、独立应用页、InlineAppCard 不得各写一套 UI
- 主要 plugin：cheatsheet / flashcards / quiz / mindmap / study-report / class-check / confusion-drill / review-plan / knowledge-cards / studio-workshop（播客 + 信息图）/ fallback
- catalog：`src/lib/ai-native/app-catalog.ts` 是 UI 端的应用矩阵（7 类 ready 应用）

### 3.5 课堂同桌 → Workshop 的统一链路（M9 关键）

Skill chip / 自然对话 / 内联 app 现在走**严格同链路**：

```
用户点 chip 或手敲 "整一张速查表"
  → useClassroomCompanion.send()
  → POST /api/tutor/agent (mode='in-class')
  → LLM 出 "好，我这就给你整一张<open_app:cheatsheet/>"
  → 前端 extractOpenAppMarker 拦截
  → 走 /api/apps/execute（appKey → pluginId）
  → InlineAppCard 承载完整 AppExecutionResult，并通过 AppRenderSurface 复用应用矩阵 UI 嵌进对话流
  → 学生可以在对话里直接操作与课后同款 UI
```

**合法 appKey**：`flashcards / quiz / mindmap / cheatsheet / study-report`（合约写在 `tutor-prompts.ts` 的 `capOpenAppContract`）。`audio-overview / infographic` 不适合内联，自动 fallback 到 WorkshopWindow。

### 3.6 God File 提取策略

`src/app/(main)/app/page.tsx` 是已知遗留债务（~2300 行），正在按**域**分阶段提取为 hooks + 子组件：

| 阶段 | 提取的 hooks | 减少行数 |
|------|-------------|---------|
| Phase 2 | `useSourceImport` | -603 |
| Phase 3 | `useCollectionComposer`, `useCollectionPulse` | -613 |
| Phase 4 | `useTutorLauncher`, `useRecordingLifecycle`, `useTranscriptHandlers`, `useAudioMessagePlayback` | -729 |
| Phase 5 | `useCollectionListActions`, `useWechatCaptureImport`, `useWorkspaceContextLoader`, `useSeekController`, `useAppStateRestore` | -581 |
| Phase 6 | `useSeekController` 消费, `usePendingRecordedAudio`, `useNoteActions`, `useActionItems`, `useExtractTerms`, `useSourceItemManagement` | -289 |

**agent 修改原则**：不要一次性拆分，只在当前任务中顺手提取≥50 行的独立模块，立即 `make check` 验证。

### 3.7 Tutor 后端（M10 mode-driven 收口）

历史上分散到三个入口（课堂同桌 / 录音复习 / 视频复习）的 prompt + 后端，已收口为**单一 endpoint**：

| 入口 | 调用方 | 关键参数 |
|------|--------|---------|
| 课堂同桌 | `useClassroomCompanion` | `mode: 'in-class'`, `recentFocus` (最近 30s) |
| 录音/视频复习 | `TutorAgentPanel` / `SafeAITutor` | `mode: 'review'`, `fullTranscript`, `currentTimestampSec`（秒，不是毫秒）, `learnerProfile`（个人画像 + 当前课程近期对话痕迹）, options.thinkingGuide |

```
POST /api/tutor/agent
  body: { mode, context: {...}, options: {...}, transcript, messages, sessionId, subject, model? }
  → resolveTutorAgentProviderConfig(env, { modelId }) 选择 DeepSeek / DashScope / OpenAI-compatible provider
  → buildTutorSystemPrompt(mode, context, options) 拼 system
  → streamText({ model, tools: [4 个 makeXxx + lookupTranscript],
                 stopWhen: stepCountIs(6), onStepFinish: track('tutor.step') })
  → toUIMessageStreamResponse()  // AI SDK v6 帧
```

**渲染契约（前端硬合同，不能删）**：
1. `[MM:SS]` / `[MM:SS-MM:SS]` — 可点击时间戳，跳回转录（解析在 `timestamp-parsing.ts`）
2. `[资料N]` — 引用 support material 时复用编号，禁止编造
3. `<open_app:KEY/>` — 学生索要结构化产物时单行 marker，前端拦截后开窗或嵌入
4. 思维引导：`---思维演示---` / `---正式回答---` / `【步骤名】` / `💡` / `🌟` 分段标记

旧 `/api/tutor` (legacy SSE 路径) 仍存在并被 `SafeAITutor` 在 flag off 时降级使用；移动端文字 AI / 历史详情也应走 `SafeAITutor → TutorAgentPanel`。`useOmniRealtimeCall` 走独立 WebSocket（qwen-omni realtime），不打这个 endpoint；移动端语音同桌由 `RealtimeTutorPanel → TutorRealtimeCallScreen` 承接，语音最终转写必须写入 `conversationService` 的 `global-chat` 并把 conversationId 接回文字 agent。

### 3.8 ASR 飞书妙记级工艺（M2 + M5 + M8）

ASR 链路（`src/lib/services/asr/`）：

- **三段式渲染**：`TranscriptRenderMachine` interim(灰斜体) / stable(黑) / final(commit)
- **长音频**：DashScope 异步 file-trans，分片 600s + 2s overlap + LCS 缝合（`stitchSegmentsWithOverlap` / `findOverlapLength`）
- **稳定性**：`reconnecting-websocket` + `p-retry` Full Jitter 退避，audioQueue 跨重连保留
- **Contextual biasing**：`buildASRContextHint` 注入 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **后校对**：`postEditSegments` 用 qwen3.5-plus 只打低置信片段（feature flag `ASR_POST_EDIT_ENABLED`，默认关）
- **状态兜底**：`audioSessions.transcriptionStatus` 区分 pending/completed/failed；转写失败或超时后课堂卡片显示“原声已保留”，不能永久停在“整理中”
- **静默校对 + 热词聚合**：`AsrCorrection` 表存用户编辑，`onRecordingStop` 触发 `/api/asr/corrections/aggregate` 生成下节课的 `userHotwords`
- **AEC/NS/AGC**：`buildAudioConstraints` 是 getUserMedia 的唯一真相源，env 可覆盖

---

## 4. Skills（详细规则在这里）

| Skill | 路径 | 何时读 |
|-------|------|--------|
| **架构执行** | `skills/architecture-enforcement/SKILL.md` | 创建/修改文件时 |
| **变更流程** | `skills/making-changes/SKILL.md` | 每次写代码时 |
| **代码审查** | `skills/code-review/SKILL.md` | 完成变更后自审 |
| **系统化调试** | `skills/debugging/SKILL.md` | 遇到 bug 时 |

**工作流**：Plan → Execute → Document → Verify → Review → Commit（详见 `skills/making-changes/SKILL.md`）。其中 Document 不是可选项：只要代码改变了事实来源、公共契约、默认行为或运维方式，就必须同步文档后再验证。

---

## 5. 设计系统（快速参考）

**铁律：95% 平涂极简；5 个仪式时刻允许灵魂迸发（详见第 2 节 Taste 白名单）。**

| Token | 色值 | 用途 |
|-------|------|------|
| `canvas` | `#F7F7F5` | 全局背景 |
| `card` | `#FFFFFF` | 卡片 |
| `ink` | `#232322` | 正文 |
| `ink-secondary` | `#787774` | 次要文字 |
| `ink-muted` | `#A3A39E` | 时间、标注 |
| `divider` | `#E9E9E7` | 分隔线 |

**仪式时刻调色板（仅限白名单场景使用）**：
- `ceremony-rose` `#FCE7F3`、`ceremony-lilac` `#E9D5FF`、`ceremony-sky` `#DBEAFE`
- 仅用于呼吸球 / 气息流 / 收尾动画 / 卡片扫光。不得用于常规按钮、卡片、背景。

**日常禁止**：`bg-gradient-*`、`shadow-*`、`ring-*` 装饰、非系统 Tailwind 色、emoji 作 UI 元素。
**仪式时刻允许**：上述元素仅限白名单中的 5 个场景出现，且必须使用 `ceremony-*` 色板。

---

## 6. Architecture Guardrails

> 来自 `skills/architecture-enforcement/SKILL.md`，每次变更前检查。

### 文件大小硬限制

| 类型 | 上限 | 当前超标文件（遗留债务） |
|------|------|------------------------|
| 页面/组件 | 500 行 | `page.tsx`(~2300), `AITutor.tsx`(~2357), `Recorder.tsx`(~1850), `ClassroomLeftPanel.tsx`(~635), `ClassroomCompanionPanel.tsx`(~535) |
| API 路由 | 500 行 | `video/import/route.ts`(1212), `tutor/route.ts`(936) |
| 服务文件 | 500 行 | `workspace-echo-service.ts`(1297), `classroom-data-service.ts`(1009) |
| 工具/类型 | 300 行 | — |

**规则**：新文件不得超过上限；修改若导致超标，必须先拆分。

### 依赖方向（单向，不可反向）

```
app/api → lib/services → lib/utils/, lib/db/, lib/config/
app/pages → components → hooks → stores → types
                       └→ lib/ui/copy（用户面文案唯一源）
```

**禁止**：
- `services/` 不得 import `components/`
- `components/` 不得直接 import `services/`（通过 hooks 或 props）
- `utils/` 不得 import `services/` 或 `components/`
- API 路由不得包含业务逻辑（必须委托给 services）
- 用户面字符串散落在组件里（必须走 `@/lib/ui/copy`）

---

## 7. 架构速查

```
src/
├── DOMAIN.md              # ← 源码总览，从这里开始
├── app/
│   ├── DOMAIN.md         # 页面路由索引
│   └── api/
│       ├── DOMAIN.md     # 45+ 个 API 路由总览
│       ├── auth/DOMAIN.md        # 认证接口组
│       ├── workspace/DOMAIN.md    # Workspace 接口组
│       ├── sources/DOMAIN.md      # 内容接入接口组
│       ├── apps/DOMAIN.md         # AI 应用接口组（execute / catalog / plugins / infographic）
│       ├── tutor/DOMAIN.md        # AI 同桌 + agent loop 子路由（M10 主入口）
│       └── video/import/DOMAIN.md # 视频导入管线
├── components/
│   ├── DOMAIN.md         # ~140 个 UI 组件索引
│   ├── ui/DOMAIN.md      # 原子 UI 组件库
│   ├── apps/DOMAIN.md
│   ├── apps/windows/DOMAIN.md  # Workshop 窗口（cheatsheet / flashcards / quiz / mindmap / studyreport / podcast / infographic）
│   ├── classroom/DOMAIN.md # M9 课堂同桌完整模块（Hero / Layout / CompanionPanel / InlineAppCard ...）
│   ├── tutor/DOMAIN.md   # 复习态 Tutor + Skill chip + Tool card + Realtime call screen
│   ├── recorder/DOMAIN.md
│   ├── mobile/DOMAIN.md
│   ├── layout/DOMAIN.md
│   ├── ConversationHistory/DOMAIN.md
│   └── business/DOMAIN.md
├── hooks/DOMAIN.md       # 48 hooks（含 useOmniRealtimeCall / useClassroomCompanion / useEnToZhTranslation / useLiveConcepts）
├── hooks/data/DOMAIN.md
├── stores/DOMAIN.md      # Zustand 状态（7 stores，~89 状态已迁移）
├── types/DOMAIN.md       # 共享类型
├── fixtures/             # demo-app-outputs.ts（Hero 试听 demo 用）
└── lib/
    ├── DOMAIN.md         # 库代码总览
    ├── services/DOMAIN.md # 60+ 业务服务（按域分组）
    ├── services/asr/      # text-utils / render-state-machine / post-edit / audio-constraints
    ├── services/classroom/ # recent-focus（30s 窗口，给课堂同桌做代词消歧）
    ├── prompts/          # tutor-prompts.ts（M10 mode-driven）
    ├── tutor/            # tutor-tools.ts（4 个 Vercel AI SDK v6 tool）
    ├── ui/               # copy.ts（用户面文案单一真相源）
    ├── hooks/DOMAIN.md   # 服务端/通用 hooks（fetchUIMessageStream / useSSEStream / useAuth）
    ├── utils/DOMAIN.md   # 工具函数
    ├── utils/page/DOMAIN.md # page-utils 拆分模块
    ├── db/DOMAIN.md      # IndexedDB Schema + CRUD
    ├── ai-native/DOMAIN.md # 应用插件系统
    ├── ai-native/plugins/DOMAIN.md # 17 个 Workshop 插件
    ├── longcut/DOMAIN.md # 转录算法
    ├── capture/DOMAIN.md # 收集逻辑
    ├── context-reach/DOMAIN.md # 输入分流
    ├── config/DOMAIN.md  # 配置中心
    ├── swr/DOMAIN.md     # SWR fetcher 封装
    └── logger.ts         # pino + Sentry breadcrumbs（不要用 console.log）
```

**读取顺序**：修改某个目录前，先读该目录的 `DOMAIN.md` 了解文件清单和依赖规则。

---

## 8. 关键文件

| 文件 | 行数 | 注意 |
|------|------|------|
| `src/app/(main)/app/page.tsx` | ~2300 | God File（按域分 6 阶段提取为 hooks + 子组件，详见 §3.6），改前先读 `src/app/DOMAIN.md` |
| `src/components/AITutor.tsx` | ~2357 | 复习态 Tutor legacy fallback；新路径默认走 `SafeAITutor → TutorAgentPanel`，移动端语音走 `RealtimeTutorPanel` |
| `src/components/SafeAITutor.tsx` | ~229 | Tutor 入口分发：默认 `TutorAgentPanel`；负责把复习页/移动端/视频复习的启动问题、当前时间（秒）、选中资料、个人画像适配到 agent context，flag off 才回退 `AITutor` 老 SSE 路径 |
| `src/components/Recorder.tsx` | ~1850 | 录音组件（已拆 3 子模块到 `recorder/`，含 mic/system/mixed 三档音源） |
| `src/components/classroom/ClassroomCompanionPanel.tsx` | ~535 | 课堂右栏同桌面板（header / 气泡 / 流式 / thinking / 输入栏） |
| `src/components/classroom/InlineAppCard.tsx` | ~160 | 内联 app 承载卡（保存完整 AppExecutionResult，复用 AppRenderSurface / 应用矩阵 UI） |
| `src/components/classroom/ClassroomLeftPanel.tsx` | ~635 | 课堂左侧（list / recording 切换 + ActiveLessonPill + StickyStartBar） |
| `src/hooks/useClassroomCompanion.ts` | — | 课堂同桌 hook：消费 `[MM:SS]` citations + `<open_app:KEY/>` marker → InlineAppCard 路径 |
| `src/hooks/useOmniRealtimeCall.ts` | ~793 | Qwen Omni realtime 语音通话 hook（语音同桌入口，独立 WebSocket，不走 /api/tutor） |
| `src/app/api/tutor/agent/route.ts` | ~212 | **M10 主入口**：mode-driven 单一 endpoint，AI SDK v6 streamText + tools，支持请求体 `model` 覆盖默认模型 |
| `src/app/api/tutor/route.ts` | 936 | Legacy SSE 路径（flag off 时仍可用，不要在它上面加新功能） |
| `src/lib/prompts/tutor-prompts.ts` | ~300 | `buildTutorSystemPrompt(mode, context, options)` ── 三入口唯一 prompt 源 |
| `src/lib/tutor/tutor-tools.ts` | ~225 | 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript） |
| `src/lib/services/llm-service.ts` | ~603 | 统一 LLM 调用层（DeepSeek / DashScope / Ark / Relay），默认学习应用模型优先 `deepseek-v4-flash` |
| `src/lib/utils/tutor-agent-provider.ts` | 69 | Tutor Agent OpenAI-compatible provider 解析：按请求模型 / env 选择 DeepSeek、DashScope 或 OpenAI，并强制 Chat Completions |
| `src/lib/utils/ai-model-preference.ts` | 19 | 设置页模型偏好的 key 与 `auto` 解析契约 |
| `src/lib/ui/copy.ts` | ~80 | 用户面文案唯一真相源（COPY 对象 + bannedWords 校验） |
| `src/lib/ai-native/app-catalog.ts` | ~136 | Workshop 应用矩阵（7 类 ready），`WORKSHOP_APP_CATALOG` + `WorkshopAppKey` |
| `src/app/api/video/import/route.ts` | 1212 | 多平台导入管线（已拆 3 子模块） |
| `src/lib/services/commonstack-echo-service.ts` | ~273 | Echo LLM 调用，System Prompt 在此 |
| `src/lib/services/workspace-echo-service.ts` | 1297 | Echo 数据管线 |
| `src/lib/services/asr/audio-constraints.ts` | — | getUserMedia constraints 唯一真相源（AEC/NS/AGC），env 可覆盖 |
| `src/lib/services/asr/post-edit.ts` | — | 低置信片段 LLM 校对（feature-flag `ASR_POST_EDIT_ENABLED`） |
| `src/lib/services/classroom/recent-focus.ts` | — | 课堂同桌的最近 30s 窗口提取（纯 TS，可单测） |
| `src/components/EchoCard.tsx` | ~209 | 回声卡，必须遵守设计系统 |

---

## 9. 技术栈

- Next.js 14 (App Router) + 自定义 `server.js`（注入 ASR WebSocket 代理）+ TypeScript 5.3
- Tailwind CSS 3.4（token 在 `tailwind.config.js`，CSS 变量在 `globals.css`）
- Prisma 7.2 + SQLite
- Dexie (IndexedDB) 客户端存储
- Zustand 状态管理（7 stores）
- Vercel AI SDK v6（`ai@^6` + `@ai-sdk/openai@^3` + `@ai-sdk/react@^3`）
- Sentry (`@sentry/nextjs@^10`) + pino (`^10`) + `p-retry` + `reconnecting-websocket`
- Promptfoo + Vitest（src + server + eval 三套 config）
- PM2 进程管理

---

## 10. 文档索引

| 文档 | 状态 | 说明 |
|------|------|------|
| `README.md` | ✅ | 产品哲学、技术栈、项目结构、能力清单、文档索引 |
| `docs/UPGRADE_PLAN.md` | ✅ | M1-M9 路线图 + 业界最佳实践决策表 |
| `CHANGELOG.md` | ✅ | 各 milestone release notes（M1-M3 已收录；M5+ 见 commit history） |
| `docs/OBSERVABILITY.md` | ✅ | 可观测底座（pino + Sentry + track 埋点） |
| `docs/ASR_PIPELINE.md` | ✅ | ASR 飞书妙记级工艺总图 |
| `docs/TUTOR_AGENT.md` | ✅ | Tutor agent loop（Vercel AI SDK v6） |
| `docs/ECHO_PRODUCT_DEFINITION.md` | ✅ | Echo 产品定义 source of truth |
| `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` | ⚠️ | 产品定义准确，技术细节可能过时 |
| `tests/eval/README.md` | ✅ | Eval harness 设计原则 + 数据集 + grader |
| `项目开发文档/提示词设计哲学.md` | ✅ | Less Structure, More Intelligence |
| `roadmap/多模态Agent技术架构路线2026-2030.md` | ✅ | 长期技术路线 |
| `skills/*/SKILL.md` | ✅ | Agent 工作规范（架构执行 / 变更流程 / 代码审查 / 系统化调试） |
