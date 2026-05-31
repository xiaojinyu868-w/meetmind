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
| **改 SharedAgent / 分享 Agent / 裂变** | `roadmap/v3.0-virality-agent.md`（北极星）→ `src/app/api/share/DOMAIN.md` → `src/app/share/DOMAIN.md` → `src/app/me/shares/`（A 管理面）→ `src/components/share/DOMAIN.md` → `src/lib/services/share-agent-service.ts`。**v3.0 闭环 5 个支点**：(1) 创建 `OctoCrystalDispatcher` (2) 落地页 `SharedAgentLanding` + `ArtifactRender` 真渲染产物 (3) 分享态对话 `mode='shared'` (4) 领取 `claimSharedAgent` → `WorkspaceCapture(sourceType='shared-agent')` 在 B 工作台点击跳回 `/share/[token]` (5) 管理 `MyShareList` + `DELETE /api/share/[token]`（撤销不影响已领取副本）|
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

**当前里程碑**：M9（agent-native 同学：identity + citations + inline apps in chat）+ M10（mode-driven prompts，三入口收口为 `/api/tutor/agent`）+ **M11（v3.0 SharedAgent：场景上下文 = 可分享的 Agent，班级裂变核心）**。详见 `roadmap/v3.0-virality-agent.md`、`docs/UPGRADE_PLAN.md` 和 `CHANGELOG.md`。

> ⚠️ v3.0 战略转向：MeetMind 从「个人学习收纳产品」升级为「场景上下文可被分享、Agent 是裂变载体」。任何与 v3.0 哲学（"上下文是公共财产、Agent 是分享单元"）冲突的旧设计以 `roadmap/v3.0-virality-agent.md` 为准。

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

**桌面上下文动作原则**：搜索笔记、历史收集、笔记总结这类“伸手拿资料”的动作，不用居中小弹窗打断主界面；优先使用右侧上下文 sidecar / 抽屉，让主学习现场仍然在背景里，像打开一页旁注而不是跳出一个 demo 弹框。

**同桌出现原则**：同桌不是无上下文聊天机器人。空课堂 / 未听课时不占右栏、不显示 Octo Buddy、不提供“问同学”入口；只有真实录课或示例课处于听课态时才自动出现。否则它只能拒答，会伤害“这个 AI 真的懂我在学什么”的第一印象。

**首屏录音来源原则**：电脑内录是核心能力，不是帮助文档里的隐藏功能。课堂零存量首屏必须让“麦克风 / 电脑声音 / 两路都录”作为轻量选择直接可见；不要只给一个“开始录课”按钮让用户猜。

**试听课原则**：试听课必须真的能听，不能只是静态转录演示。进入示例课 recording 视图时必须挂载 `/demo-audio.mp3`，用真实音频播放时间驱动转录渐进露出；中间结构树也必须随音频长出来，不能长期停在空态。若浏览器拦截自动播放，必须提供显式“播放声音”入口。英文试听课默认 EN→中，但用户手动切换后要尊重用户选择。音频自然结束后必须留在试听课堂现场，由 Octo Buddy 轻引导用户点“结束这节课”，再进入既有课后复习页 / 应用矩阵；不要在课中页面承载完整课后学习，也不能回到“原声已保留”的失败卡片。

**课中轻引导原则**：同桌右栏可以引导，但必须像旁边同学轻轻递话，不像功能导览。优先用 Octo Buddy 像素章鱼 + 2-3 个自然问题 chip（点了就发送），避免大面积“我能做什么”的说明卡。Octo Buddy 是 IP，不是静态 icon；内嵌在右栏时也要有呼吸 / 听课 / 开心等轻动画。

**课后复习三栏原则**：视频和音频课后复习都必须是“左边有根，中间练习，右边有人陪”。左栏保留原始课堂证据（视频/音频播放器、时间轴、转录锚点），且视频复习默认应给左栏最大权重，保证视频真的可看；中栏承载完整学习工作区（应用矩阵、闪卡、测验、思维导图等）；右栏只做同桌解释与复盘。三栏之间两条边界都可拖拽；左证据栏不自动折叠，学习区和同桌被挤到阈值后折叠成窄 rail，可点击恢复。复习态 `<open_app:KEY/>` 不能把完整应用塞进聊天气泡，必须打开中间学习工作区；测验/闪卡等应用交互动态要先写入课后学习黑板，再由同桌作为上下文读取，避免中间应用和右侧聊天直接耦合。黑板是轻结构自然语言便签，只写学习现场事实，不写“如果/应该/优先/提醒/建议”等面向模型的指令，把判断权留给模型。

### 仪式时刻白名单（允许在系统外释放灵魂的 6 个场景）

日常 95% 的界面**仍然**遵守「克制 + 双签名色 + 米白纸感」，但以下 6 个仪式时刻允许情绪化视觉：

1. **录音中的呼吸球**：仪式色板（rose/lilac/sky 三色低饱和度）+ 高斯模糊光晕 + 呼吸动画。停止即消散。
2. **AI 正在"酿"的提示**：`thinking-strip` 极淡墨绿/朱批气息流横扫，&lt; 2s，不阻塞交互。
3. **Echo / 应用卡生成完成的瞬间**：墨绿 check + 一道柔光扫过卡片，< 1.6s。
4. **录课结束的收尾动画**：屏幕中央极简收束，像合上一本笔记。
5. **Tab 切换 / AI 流式输出**：字符逐个浮现（`stream` + `typing-caret`），让学生**看见** AI 在思考。
6. **分享落地页 `/share/[token]`（v3.0 唯一允许整页放飞的页面）**：
   - 大气场墨绿/朱批 radial gradient 背景 + Octo `original.png` 大图 + `hero-float` 动画
   - Instrument Serif italic 装饰标题
   - 这一页的目标是被陌生人在班级群点开——它的视觉权重要承担起裂变的任务

**除此以外，常规页面允许**：极淡墨绿 1px ring（`surface-ai`）、`shadow-soft/card/float` 极克制投影、双签名色作引用资产 / 状态点 / mark 高亮。

**始终禁止**：饱和色撞脸 ChatGPT 紫 / Stripe 蓝 / 多邻国绿、emoji 作 UI 元素、用渐变填充按钮、用阴影替代结构。

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
| **分享态对话** (v3.0) | `SharedAgentChat` (落地页 `/share/[token]`) | `mode: 'shared'`, `shareToken`，服务端从 `SharedAgent.snapshotJson` 加载上下文；不读取访问者画像，禁用 native tools，禁用 inline app marker |

```
POST /api/tutor/agent
  body: { mode, context: {...}, options: {...}, transcript, messages, sessionId, subject, model? }
  → resolveTutorAgentProviderConfig(env, { modelId }) 选择 StepFun / DeepSeek / DashScope / OpenAI-compatible provider（默认 `step-3.7-flash`）
  → buildTutorSystemPrompt(mode, context, options) 拼 system
  → streamText({ model, tools: [makeXxx + lookupTranscript],
                 // DeepSeek 与 StepFun 都不暴露 native tools，结构化产物走 <open_app:KEY/> + /api/apps/execute；
                 // DeepSeek 是因为 reasoning_content tool-call 续写错误，StepFun 是为降低 TTFT（6 个 tool description ~700 字会拖慢 prefill）
                 stopWhen: stepCountIs(3),
                 experimental_transform: smoothStream({ chunking: 'word' }),  // 让前端字节流按词平滑刷出
                 onStepFinish: track('tutor.step') })
  → toUIMessageStreamResponse()  // AI SDK v6 帧
```

**渲染契约（前端硬合同，不能删）**：
1. `[MM:SS]` / `[MM:SS-MM:SS]` — 可点击时间戳，跳回转录（解析在 `timestamp-parsing.ts`）
2. `[资料N]` — 引用 support material 时复用编号，禁止编造
3. `<open_app:KEY/>` — 学生索要结构化产物时单行 marker，前端拦截后开窗或嵌入
4. 思维引导：`---思维演示---` / `---正式回答---` / `【步骤名】` / `💡` / `🌟` 分段标记

旧 `/api/tutor` (legacy SSE 路径) 仍存在并被 `SafeAITutor` 在 flag off 时降级使用；移动端文字 AI / 历史详情也应走 `SafeAITutor → TutorAgentPanel`。复习态 `open_app` 不是 iframe；桌面端有中间学习工作区时，marker 只负责把应用打开到中栏，完整 `AppRenderSurface` 不再塞进聊天气泡；恢复历史对话时必须先读 `app_workspace_result:{sessionId}:{appKey}` 共享缓存，不能因为历史里有 `<open_app:KEY/>` 就重新并发生成。`useOmniRealtimeCall` 走独立 WebSocket（qwen-omni realtime），不打这个 endpoint；移动端语音同桌由 `RealtimeTutorPanel → TutorRealtimeCallScreen` 承接，语音最终转写必须写入 `conversationService` 的 `global-chat` 并把 conversationId 接回文字 agent。

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

## 5. 设计系统 v7（快速参考）

> 完整设计宪法 + 可视化 showcase 在 `design-demo/v7/`（9 篇文档：tokens / foundations / AI 视觉 / 组件 / 应用矩阵 / 课中 / 复习 / 分享落地 / 移动端 / 暗色）。

**核心理念：图书馆台灯 + 朱批红笔。** "色 = 架构"——墨松绿是 AI 沉淀（场景上下文），朱批红是学生此刻（个人上下文 / 引用 / 标注）。

### 双签名色（Tailwind class · CSS var）

| 角色 | 名称 | 色值 | Tailwind | CSS Var | 语义 |
|------|------|------|----------|---------|------|
| **主签名** | 墨松绿 Pine | `#2D4F3E` | `pine` / `pine-mist` / `pine-fog` | `--mm-pine` | AI / 沉淀 / 长期上下文 |
| **次签名** | 朱批红 Vermilion | `#B5483C` | `vermilion` / `vermilion-mist` / `vermilion-fog` | `--mm-vermilion` | 此刻 / 引用 / 学生标注 |

### 中性色

| Token | 色值 | Tailwind | 用途 |
|-------|------|----------|------|
| `paper` | `#FAF7F2` | `bg-paper` | 主底色 · 米白纸感（v7 升级 · 暖于 v6 燕麦灰） |
| `paper-warm` | `#F2EDE3` | `bg-paper-warm` | hover / 次表面 |
| `card` | `#FFFFFF` | `bg-card` | 主卡片 |
| `ink` | `#1C1B19` | `text-ink` | 主文字 / 主按钮 |
| `ink-secondary` | `#5C5A55` | `text-ink-secondary` | 次文字 |
| `ink-muted` | `#8E8B82` | `text-ink-muted` | 弱文字 / 标注 |
| `divider` | `#E8E2D5` | `border-divider` | 边线（偏暖纸感） |

### 字体三件套（已在 `app/layout.tsx` 通过 next/font 加载）

| 字体 | Tailwind | 用途 |
|------|---------|------|
| **Inter** | `font-sans`（默认） | 正文 · 'palt' 紧排让中英混排立刻 +30% 高级感 |
| **Instrument Serif** | `font-serif` 或 `.font-serif-italic` | 仪式字 · 标题里偶尔的 italic em |
| **JetBrains Mono** | `font-mono` 或 `.font-mono-cite` | 引用资产化 · `[MM:SS]` / `[资料 N]` 专用 |

### 投影系统（v7：必须存在但克制）

| Tailwind | 强度 | 用途 |
|---------|------|------|
| `shadow-soft` | 0/4/16 · 0.04 | 日常卡片 |
| `shadow-card` | 0/8/28 · 0.06 | 主卡片（首选） |
| `shadow-float` | 0/16/48 · 0.08 | 悬浮元素 |
| `shadow-modal` | 0/32/80 · 0.12 | 模态 |
| `shadow-ai-glow` / `shadow-glow` | 1px pine ring + 8/28 pine | **AI 在场专属** |

### v7 工具类（globals.css 直接可用）

```html
<!-- 引用资产化 -->
<span class="cite-ts mono">[20:01]</span>     <!-- 朱批时间戳 -->
<span class="cite-src mono">[资料 3]</span>   <!-- 墨绿资料 -->

<!-- AI 在场卡片 -->
<div class="surface-ai">…</div>                <!-- 1px pine ring + 缓慢光带 -->

<!-- 高亮笔 -->
<mark class="mark-pine">不让中间路由器被淹</mark>
<mark class="mark-vermilion">不让接收方被噎着</mark>

<!-- 流式输出 -->
<p class="stream"><span style="animation-delay:.04s">字</span>…<span class="typing-caret"></span></p>

<!-- 思考气息流 / 录音呼吸点 / Octo 光环 -->
<div class="thinking-strip">Octo 正在对照你前面问过的内容…</div>
<span class="rec-dot"></span>
<div class="octo-aura"><img … /></div>

<!-- 骨架屏 -->
<div class="skel h-3 w-2/3"></div>
```

### v7 原生组件（`@/components/ui`）

| 组件 | 文件 | 用途 |
|------|------|------|
| `Button` (variant: `pine` / `vermilion` / `ghost` / `naked` / `link` / `danger`) | `button.tsx` | 升级版按钮，size 加 `xl` |
| `Card` (variant: `default` / `soft` / `elevated` / `ai`, hoverable) | `card.tsx` | 4 档投影 + AI 在场态 |
| `Badge` (variant: `pine` / `vermilion` / `sand` / `mute`, dot) | `badge.tsx` | 双签名色胶囊，dot 状态点 |
| `Skeleton` + `Skeleton.Paragraph` + `Skeleton.AppCard` | `skeleton.tsx` | shimmer 横扫，不再 pulse 明灭 |
| `Cite` (kind: `ts` / `src`) | `cite.tsx` | **引用资产化**——MeetMind"有根"DNA |
| `OctoAvatar` (mood: 8 态, size, statusDot) | `octo-avatar.tsx` | 头像 wrapper，呼吸光环 + 状态点 |
| `ThinkingStrip` / `TypingDots` / `BrewingStrip` | `thinking-strip.tsx` | 三档等待形态：轻 / 中 / 重（"酿"） |
| `StreamText` | `stream-text.tsx` | 流式输出包装器，stagger 浮现 + caret |

### 暗色模式 first-class

通过 `data-theme="dark"` 切换。底色 `#14110D`（深棕墨黑，温度比纯黑高），墨绿变浅松绿 `#6B9080`，朱批变暖橘红 `#E07A5F`——给凌晨学习的学生眼睛准备的版本。所有 token 自动重映射，组件无需任何改动。

### v6 → v7 兼容映射

旧 class 全部保留并自动映射到 v7 token：`bg-canvas` → 新米白、`text-ink` → 新墨黑、`bg-mint` / `bg-skyblue` 等都映射到 pine 体系，`bg-coral` 映射到 vermilion 体系。**新代码请直接用 v7 class（pine / vermilion / paper / surface-ai / cite-ts / cite-src）**，不要再用 v6 别名。


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
│   ├── share/DOMAIN.md   # v3.0 SharedAgent 公开落地页（/share/[token]）
│   └── api/
│       ├── DOMAIN.md     # 45+ 个 API 路由总览
│       ├── auth/DOMAIN.md        # 认证接口组
│       ├── workspace/DOMAIN.md    # Workspace 接口组
│       ├── sources/DOMAIN.md      # 内容接入接口组
│       ├── apps/DOMAIN.md         # AI 应用接口组（execute / catalog / plugins / infographic）
│       ├── tutor/DOMAIN.md        # AI 同桌 + agent loop 子路由（M10 主入口；mode='shared' 走 SharedAgent）
│       ├── share/DOMAIN.md        # v3.0 SharedAgent 创建 / 公开读 / 领取 / 埋点
│       └── video/import/DOMAIN.md # 视频导入管线
├── components/
│   ├── DOMAIN.md         # ~140 个 UI 组件索引
│   ├── ui/DOMAIN.md      # 原子 UI 组件库
│   ├── apps/DOMAIN.md
│   ├── apps/windows/DOMAIN.md  # Workshop 窗口（cheatsheet / flashcards / quiz / mindmap / studyreport / podcast / infographic）
│   ├── classroom/DOMAIN.md # M9 课堂同桌完整模块（Hero / Layout / CompanionPanel / InlineAppCard ...）
│   ├── tutor/DOMAIN.md   # 复习态 Tutor + Skill chip + Tool card + Realtime call screen
│   ├── share/DOMAIN.md   # v3.0 SharedAgent 创建器 + Canvas 长图
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
| `src/components/SafeAITutor.tsx` | ~252 | Tutor 入口分发：默认 `TutorAgentPanel`；负责把复习页/移动端/视频复习的启动问题、当前时间（秒）、选中资料、个人画像和应用学习动态适配到 agent context，flag off 才回退 `AITutor` 老 SSE 路径 |
| `src/components/Recorder.tsx` | ~1850 | 录音组件（已拆 3 子模块到 `recorder/`，含 mic/system/mixed 三档音源） |
| `src/components/classroom/ClassroomCompanionPanel.tsx` | ~535 | 课堂右栏同桌面板（header / 气泡 / 流式 / thinking / 输入栏） |
| `src/components/classroom/InlineAppCard.tsx` | ~160 | 内联 app 承载卡（保存完整 AppExecutionResult，复用 AppRenderSurface / 应用矩阵 UI） |
| `src/components/classroom/ClassroomLeftPanel.tsx` | ~635 | 课堂左侧（list / recording 切换 + ActiveLessonPill + StickyStartBar） |
| `src/hooks/useClassroomCompanion.ts` | — | 课堂同桌 hook：消费 `[MM:SS]` citations + `<open_app:KEY/>` marker → InlineAppCard 路径 |
| `src/hooks/useOmniRealtimeCall.ts` | ~793 | Qwen Omni realtime 语音通话 hook（语音同桌入口，独立 WebSocket，不走 /api/tutor） |
| `src/app/api/tutor/agent/route.ts` | ~336 | **M10 主入口**：mode-driven 单一 endpoint，AI SDK v6 streamText；非 DeepSeek 模型可用 native tools，DeepSeek thinking 模型走 `<open_app:KEY/>` 渲染契约避免 `reasoning_content` tool-call 错误 |
| `src/app/api/tutor/route.ts` | 936 | Legacy SSE 路径（flag off 时仍可用，不要在它上面加新功能） |
| `src/lib/prompts/tutor-prompts.ts` | ~300 | `buildTutorSystemPrompt(mode, context, options)` ── 三入口唯一 prompt 源 |
| `src/lib/tutor/tutor-tools.ts` | ~225 | 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript） |
| `src/lib/services/llm-service.ts` | ~660 | 统一 LLM 调用层（StepFun / DeepSeek / DashScope / Ark / Relay），默认学习应用模型优先 `step-3.7-flash`（阶跃星辰），fallback 链 `step-3.7-flash → deepseek-v4-flash → qwen3.6-plus` |
| `src/lib/utils/tutor-agent-provider.ts` | ~160 | Tutor Agent OpenAI-compatible provider 解析：按请求模型 / env 选择 StepFun、DeepSeek、DashScope 或 OpenAI，并强制 Chat Completions；暴露 `shouldUseNativeTutorTools` 禁用 DeepSeek thinking native tool-call |
| `src/lib/utils/ai-model-preference.ts` | 19 | 设置页模型偏好的 key 与 `auto` 解析契约 |
| `src/lib/ui/copy.ts` | ~80 | 用户面文案唯一真相源（COPY 对象 + bannedWords 校验） |
| `src/lib/ai-native/app-catalog.ts` | ~136 | Workshop 应用矩阵（7 类 ready），`WORKSHOP_APP_CATALOG` + `WorkshopAppKey` |
| `src/app/api/video/import/route.ts` | 1212 | 多平台导入管线（已拆 3 子模块） |
| `src/lib/services/commonstack-echo-service.ts` | ~273 | Echo LLM 调用，System Prompt 在此 |
| `src/lib/services/workspace-echo-service.ts` | 1303 | Echo 数据管线；CommonStack 新 schema 不返回 title，需从 takeaway / echo 生成标题后再进质量门 |
| `src/lib/services/asr/audio-constraints.ts` | — | getUserMedia constraints 唯一真相源（AEC/NS/AGC），env 可覆盖 |
| `src/lib/services/asr/post-edit.ts` | — | 低置信片段 LLM 校对（feature-flag `ASR_POST_EDIT_ENABLED`） |
| `src/lib/services/classroom/recent-focus.ts` | — | 课堂同桌的最近 30s 窗口提取（纯 TS，可单测） |
| `src/components/classroom/ClassroomLayout.tsx` | ~270 | 课堂分栏；同桌只在真实录课 / 示例课听课态可见，空课堂隐藏右栏、Octo Buddy 和移动端问同学入口 |
| `src/components/classroom/ClassroomHero.tsx` | ~160 | 课堂零存量 Hero；居中首屏避免右侧空洞，录音来源 rail 直接露出麦克风 / 电脑声音 / 两路都录，示例课只是低门槛预览 |
| `src/components/classroom/ClassroomRecordingView.tsx` | ~610 | 课中视图；试听课播放 `/demo-audio.mp3`，由音频时间驱动转录渐进露出，结束后只显示总结卡和“结束这节课”入口，由上层切到课后复习页 / 应用矩阵 |
| `src/components/classroom/demo-mindmap.ts` | ~103 | 试听课静态结构树；随音频秒数生长，避免中间结构画布长期空态 |
| `src/components/classroom/ClassroomCompanionPanel.tsx` | ~585 | 同桌右栏；课中 / 课后 starter 用会动的 Octo Buddy 像素章鱼 + 轻问题 chip 引导，不做重功能导览 |
| `src/components/classroom/OctoBuddy.tsx` | ~660 | Octo Buddy 像素 IP；Sprite 自带呼吸 / 听课 / 开心动画，悬浮球和右栏内嵌都复用它 |
| `src/components/DesktopVideoReviewLayout.tsx` | ~647 | 桌面端课后复习三栏布局：左=视频/音频证据 + 时间轴，中=学习工作区，右=同桌解释与复盘；视频默认放大证据栏，并持有课后学习黑板 |
| `src/components/ReviewThreePaneLayout.tsx` | ~156 | 课后复习可拖拽三栏容器；两条边界都可拖拽，学习区 / 同桌可折叠成 rail，左证据栏不自动折叠 |
| `src/components/ReviewLearningWorkspace.tsx` | ~119 | 课后中间学习工作区；承载完整 AppRenderSurface，闪卡切低亮度练习背景，并把测验/闪卡动态写入课后学习黑板 |
| `src/components/review-learning-blackboard.ts` | ~131 | 课后学习黑板；轻结构自然语言便签，只记录学习现场事实，不写模型指令，解耦中间应用与右侧同桌 |
| `src/components/AISearchPanel.tsx` | ~740 | 搜索笔记面板；桌面端必须以右侧上下文 sidecar 呈现，移动端全屏 |
| `src/components/mobile/MobileCollectionSheet.tsx` | ~430 | 收集菜单 / 历史收集 / 笔记总结；桌面端历史与笔记总结走右侧上下文抽屉，移动端保留 sheet |
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
