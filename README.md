# MeetMind

> **你随手种下的，会安静地长成你意想不到的东西。**

一个以学习者长期上下文为中心的 AI 学习产品。用户像发微信一样把学习现场的一切发给 MeetMind，MeetMind 先收下，后台慢慢理解，理解成熟后自然长出**同桌、回声、复习、Tutor**。

---

## 产品哲学

**先收，再懂，再教。**

用户不需要分类、不需要选功能、不需要先做决策。

### 当前聚焦：课堂场景

先打透「一节课」这个场景，再自然扩展到全场景。

一个大学生录了一节课 → MeetMind 当场作为 AI **同桌**陪他听（识别专业词、即时英→中字幕、回答"刚才那啥意思"）→ 课后帮他听懂这节课、自动产出闪卡 / 测验 / 速查表 / 思维导图 / 学习报告，并生成一张让他忍不住分享到班级群的回声卡。

增长单元不是「一个用户」，是「一个班级」。

### Taste

| 关键词 | 含义 |
|--------|------|
| **安静** | 95% 界面不通知、不弹窗、不催促 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 没有「生成」按钮，像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件，引用都能跳回 `[MM:SS]` 转录 |
| **第一印象 = 智能** | 学生第一反应应该是「这个 AI 真的懂我在学什么」——不是"好看"，不是"安静"，是**智能** |

视觉为智能让路：日常 95% 平涂极简（零渐变、零阴影），仅 5 个仪式时刻允许灵魂迸发（呼吸球、酿造气息、Echo 扫光、收尾动画、流式字符）。

详见 [`AGENTS.md`](./AGENTS.md) 第 2 节 与 [`docs/ECHO_PRODUCT_DEFINITION.md`](./docs/ECHO_PRODUCT_DEFINITION.md)。

---

## 快速开始

```bash
git clone git@github.com:xiaojinyu868-w/meetmind.git
cd meetmind
npm install
cp .env.example .env   # 编辑 .env，填入 API Key

make dev                # 开发模式（端口 3001，可在 .env 用 PORT 覆盖）
```

> Agent 和人类都只用 `Makefile` 里的命令。常用：`make dev` / `make check` / `make build` / `make test` / `make eval` / `make smoke`。

### 环境变量（关键项）

完整模板见 [`.env.example`](./.env.example)。最小可跑配置：

```bash
# 必需
DATABASE_URL="file:./prisma/meetmind.db"
DASHSCOPE_API_KEY=sk-your-api-key

# LLM 默认（M10 默认走 qwen3.5-plus / qwen3-vl-plus）
LLM_MODEL=qwen3-vl-plus-2025-12-19
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 实时 ASR（课堂同桌依赖）
DASHSCOPE_ASR_WS_MODEL=qwen3-asr-flash-realtime
DASHSCOPE_ASR_WS_SR=16000

# 转录后校对（M5 引入；分层 light → fallback）
TRANSCRIPT_CORRECTION_MODE=layered
TRANSCRIPT_LIGHT_MODEL=qwen-turbo
TRANSCRIPT_FALLBACK_MODEL=qwen-plus

# Echo（CommonStack + Gemini 3 Flash）
COMMONSTACK_ECHO_API_KEY=your-key
COMMONSTACK_ECHO_MODEL=google/gemini-3-flash-preview

# 微信服务号（可选）
WECHAT_APP_ID=your-app-id
WECHAT_APP_SECRET=your-app-secret
WECHAT_MP_TOKEN=your-mp-token

# 功能开关
NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER=true
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true
NEXT_PUBLIC_TUTOR_AGENT_ENABLED=true   # M6+：默认走 agent loop（/api/tutor/agent）
ASR_POST_EDIT_ENABLED=false            # M5：低置信片段 LLM 校对（A/B 后再开）

# 公网（生产）
PUBLIC_DOMAIN=capture.meetmind.online
PUBLIC_PROTOCOL=https

# 可观测（M1）
# SENTRY_DSN=...
# LOG_LEVEL=info
```

### 生产部署

```bash
# 构建（低内存服务器，限 1 核 + 1GB）
make build

# 部署 = build + PM2 重启
make deploy
```

| 项目 | 值 |
|------|-----|
| 域名 | `https://capture.meetmind.online` |
| 端口 | 3002（PM2/`.env`），开发默认 3001 |
| 反向代理 | Nginx（`nginx-capture.conf` / `nginx-hk.conf`） |
| 进程管理 | PM2（`ecosystem.config.js`） |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) + 自定义 server.js（注入 ASR WebSocket 代理） |
| 语言 | TypeScript 5.3 |
| 样式 | Tailwind CSS 3.4（设计 token 在 `tailwind.config.js` + `globals.css`） |
| 服务端 DB | Prisma 7.2 + SQLite |
| 客户端 DB | Dexie.js (IndexedDB) — 转录文本、本地缓存、离线状态的真实数据源 |
| 状态管理 | Zustand（7 stores，~89 状态） |
| AI 模型 | DXKP OpenAI-compatible（默认 `DeepSeek-V4-Flash`，可切 `DeepSeek-V4-Pro` / `Qwen3.6-Plus-A`；`qwen3.5-omni-plus` realtime 仍保留原链路）、CommonStack（Gemini 3 Flash） |
| AI 框架 | Vercel AI SDK v6（`streamText + tools + stepCountIs`） |
| 音频处理 | wavesurfer.js、fluent-ffmpeg、@ffmpeg-installer/ffmpeg |
| ASR | DashScope qwen3-asr-flash（实时 WS）+ qwen3-asr-flash-filetrans（异步长音频） |
| 可观测 | Sentry (`vercelAIIntegration` + `pinoIntegration`) + pino 结构化日志 + AsyncLocalStorage requestId |
| 评测 | Promptfoo + 自研 TS grader（CER / tool-selection / timestamp-citation / LLM rubric） |
| 进程管理 | PM2 |

---

## 项目结构

```
meetmind/
├── server.js                     # 自定义 Next.js server（ASR WS 代理 + 静态资源 + 长任务保活）
├── prisma/                       # Prisma schema + migrations（含 AsrCorrection / AsrHotword）
├── src/
│   ├── app/
│   │   ├── (main)/app/           # 主页面 page.tsx（God File ~2300 行；按域分 6 阶段提取）
│   │   ├── api/                  # 45+ API 路由（薄壳，业务逻辑在 services）
│   │   │   ├── tutor/            # AI 同桌：route.ts (legacy SSE) + agent/route.ts (M10 主入口)
│   │   │   ├── apps/             # AI-Native 应用：execute / catalog / plugins / infographic
│   │   │   ├── classroom/        # 课堂态：foresight / mindmap
│   │   │   ├── translate/        # en-zh / zh-en 课堂实时翻译
│   │   │   ├── transcribe*/      # ASR 三档：标准 / fast (异步) / turbo (WS)
│   │   │   ├── transcript-enhance/ # 分层 LLM 校对
│   │   │   ├── asr/corrections/  # M5 用户纠错回流 + 周度热词聚合
│   │   │   ├── video/import/     # B 站 / YouTube / 小宇宙 / 抖音 / 直链
│   │   │   ├── workspace/        # Workspace + Echo 持久化
│   │   │   └── wechat/           # 微信服务号轻收集入口
│   │   └── wechat/               # 微信 H5 页面
│   ├── components/
│   │   ├── classroom/            # M9 课堂同桌：Hero / Layout / LeftPanel / CompanionPanel /
│   │   │                         #               RecordingView / LessonCard / Avatar /
│   │   │                         #               InlineAppCard / DemoLessonLoader / MindMap
│   │   ├── tutor/                # 复习态 Tutor 模块：AgentPanel / SkillChipRow / ToolCard /
│   │   │                         #                    RealtimeCallScreen (Qwen-Omni 语音)
│   │   ├── apps/windows/         # Workshop 窗口：Cheatsheet / Flashcards / Quiz / Mindmap /
│   │   │                         #                StudyReport / Podcast / Infographic
│   │   ├── recorder/             # Recorder.tsx 拆分子模块（含 mic/system/mixed 三档音源）
│   │   ├── EchoCard.tsx          # 回声卡（应用内）
│   │   ├── EchoShareCard.tsx     # 回声分享图（Canvas）
│   │   ├── AITutor.tsx           # 复习态 Tutor 主视图（legacy；新路径默认 SafeAITutor → TutorAgentPanel）
│   │   └── Recorder.tsx          # 原声录制（~1850 行）
│   ├── hooks/                    # 48 个 hooks（含 useOmniRealtimeCall / useClassroomCompanion）
│   ├── stores/                   # Zustand：collection / capture-editor / echo / player / session / ui / mobile-ai
│   ├── types/                    # 共享类型
│   ├── fixtures/                 # demo-app-outputs.ts（首屏试听 demo 课的 mock app 产物）
│   └── lib/
│       ├── ai-native/            # 应用插件系统（17 plugins：cheatsheet / flashcards / quiz / mindmap /
│       │                         #                          study-report / class-check / confusion-drill /
│       │                         #                          review-plan / knowledge-cards / studio-workshop ...）
│       ├── prompts/              # 版本化 prompts（M10 mode-driven buildTutorSystemPrompt）
│       ├── tutor/                # tutor-tools.ts（4 个 Vercel AI SDK v6 tool）
│       ├── ui/                   # copy.ts ── 用户面文案的单一真相源（去开发者黑话）
│       ├── hooks/                # 服务端/通用 hooks（fetchUIMessageStream / useSSEStream / useAuth）
│       ├── services/             # 60+ 业务服务（按域分组）
│       │   ├── asr/              # text-utils / render-state-machine / post-edit / audio-constraints
│       │   ├── classroom/        # recent-focus（30s 窗口提取，给课堂同桌做代词消歧）
│       │   ├── commonstack-echo-service.ts   # Echo LLM 调用
│       │   ├── workspace-echo-service.ts     # Echo 数据管线（~1297 行）
│       │   └── ...
│       ├── db/                   # Dexie schema + CRUD
│       ├── capture/              # 收集逻辑
│       ├── context-reach/        # 输入分流（识别录音 / 链接 / 文件 / 文字）
│       ├── longcut/              # 转录算法
│       ├── config/               # 配置中心
│       ├── logger.ts             # pino + Sentry breadcrumbs（不要用 console.log）
│       └── server-failover.ts    # 服务端 failover 工具
├── tests/
│   ├── eval/                     # SWE-Bench 风格 harness：asr / tutor + grader + baselines + regression-guard
│   ├── e2e/                      # Playwright
│   └── smoke/                    # 端到端冒烟（路由 / WS / auth / API）
├── skills/                       # Agent 工作规范（架构 / 变更 / 审查 / 调试）
├── docs/                         # 产品 + 技术文档
└── 项目开发文档/                 # 提示词设计哲学
```

---

## 当前已成立的能力

### 收集（Capture）
- 微信式聊天收集流
- 原声录制 → 后台 ASR → 去复习
- 统一上传（图片、文档、PDF、PPT、音频、视频、链接）
- 视频链接导入（B 站、YouTube、小宇宙播客、抖音、直链）
- 图文链接导入（小红书、微信公众号、知乎）
- **长音频妙记级 ASR**：>10min 自动切 DashScope 异步模式（支持 12 小时），分片 600s + 2s 重叠 + LCS 缝合
- 微信服务号轻收集入口

### 课堂同桌（M9 agent-native）
- **首屏 Hero**：身份（"同学"）+ 双 CTA（试听 demo / 录我自己的课）+ 5 张能力卡
- **Demo 课**：仓库内 93s `DEMO_SEGMENTS` + `demo-audio.mp3` 一键灌入，零门槛跑完"chip → 生成 → 追问"闭环
- **可拖动右栏**：默认 480px，range 320–720，双击档位循环，localStorage 持久化
- **Skill chips**：速查表 / 闪卡 / 测验 / 思维导图 / 学习报告 / 再讲一遍——chip 与手敲 prompt 严格同链路（统一走 `/api/tutor/agent`）
- **内联 app 卡片**：5 类知识产物直接渲染进对话气泡（不再弹窗打断），答题结果回流对话
- **Citations 打通**：`[MM:SS]` 引用点击 → 切到 recording 态 → 转录段落 1.2s 黄色脉冲高亮
- **代词消歧**：最近 30s 转录作为 `recentFocus` 注入 system prompt，"这啥意思"被理解为"刚才这段啥意思"
- **EN→中 即时翻译条**：`/api/translate/en-zh` 在 StatusHeader 内联呈现，可一键开关
- **Live word explainer**：选中英文术语 → 弹出释义气泡
- **静默 ASR 校对**：`originalText` + `correctionLevel` 保留，hover 600ms 显示"机器修过：XXX"
- **静默热词聚合**：`onRecordingStop` 触发 `/api/asr/corrections/aggregate`，下节课自动用上本节课术语

### 复习态 Tutor（M3 agent loop）
- Vercel AI SDK v6：`streamText + tools + stepCountIs(6) + onStepFinish`
- 4 个内置工具：`makeFlashcards` / `makeQuiz` / `makeMindmap` / `lookupTranscript`
- 思维引导模式：`---思维演示---` / `---正式回答---` 两段式
- 文本 SSE + 语音通话（Qwen-Omni realtime WebSocket）双形态
- M10 起：`/api/tutor/agent` 用 `mode: 'in-class' | 'review'` + `options` 收口三个对话入口

### 回声（Echo）
- 课堂回声：三层骨架（echo + highlights + takeaway）
- 回声卡：应用内轻卡片，系统设计语言
- 分享图：Canvas 绘制，书籍封面排版
- CommonStack + Gemini 3 Flash 生成
- 课堂回声卡可分享（增长引擎）

### AI-Native 应用矩阵
- 7 类已上线：考试速查表、闪卡训练、测验工坊、思维导图、信息图工坊、学习报告、课堂播客
- 统一通过 `/api/apps/execute` 调用，registry 自动分发到对应 plugin
- 同一套数据既支持 WorkshopWindow（全屏）也支持 InlineAppCard（嵌入对话）

### 设计系统
- Notion 式秩序白皮书：零渐变、零阴影、纯平涂
- 五色系统：canvas / card / ink / ink-secondary / divider
- 四功能色块：sand / mint / dustyblue / rose
- 仪式时刻调色板：`ceremony-rose` / `ceremony-lilac` / `ceremony-sky`（仅限 5 个白名单场景）

### 可观测 + 评测（M1 底座）
- pino 结构化 JSON + AsyncLocalStorage 注入 `requestId/userId`
- `track()` 四路径埋点：asr / tutor / echo / sync
- Sentry `vercelAIIntegration` 自动捕获 AI SDK step/tool span
- Eval harness（SWE-Bench 风格）：`make eval-asr` / `make eval-tutor` / `make eval-guard`
- Baseline 冻结在 `tests/eval/baselines/`，CI gate 防回归（ASR CER 退化 >10% 或 Tutor 评分跌 >5pp 即失败）

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | **Agent 阅读路径 + Golden Commands + 大架构 + 设计系统**（接手必读） |
| [`docs/UPGRADE_PLAN.md`](./docs/UPGRADE_PLAN.md) | M1-M9 打磨升级路线图 + 业界最佳实践决策表 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 各 milestone release notes |
| [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) | 可观测底座（pino + Sentry AI + track 埋点） |
| [`docs/ASR_PIPELINE.md`](./docs/ASR_PIPELINE.md) | ASR 飞书妙记级工艺总图 |
| [`docs/TUTOR_AGENT.md`](./docs/TUTOR_AGENT.md) | Tutor agent loop（Vercel AI SDK v6 + tools） |
| [`docs/ECHO_PRODUCT_DEFINITION.md`](./docs/ECHO_PRODUCT_DEFINITION.md) | Echo 产品定义（taste、三层价值、增长引擎） |
| [`docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md`](./docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md) | Capture V1 产品定义、收集原则、验收清单 |
| [`docs/competition-tech-article-draft.md`](./docs/competition-tech-article-draft.md) | 竞赛技术文章草稿 |
| [`docs/douyin-jingxuan-track-article.md`](./docs/douyin-jingxuan-track-article.md) | 抖音精选赛道技术文 |
| [`tests/eval/README.md`](./tests/eval/README.md) | Eval harness（数据集 / grader / runner / baseline） |
| [`项目开发文档/提示词设计哲学.md`](./项目开发文档/提示词设计哲学.md) | Less Structure, More Intelligence |
| [`skills/*/SKILL.md`](./skills/) | Agent 工作规范（架构执行 / 变更流程 / 代码审查 / 系统化调试） |
| [`roadmap/多模态Agent技术架构路线2026-2030.md`](./roadmap/多模态Agent技术架构路线2026-2030.md) | 长期技术路线 |

---

## 许可证

MIT License
