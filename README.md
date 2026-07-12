# MeetMind

> **让你收下的每份内容，带回下一条真正有用的信息。**

MeetMind 是个人上下文与目标驱动的学习工作台。你只需要照常听课、整理和收藏；MeetMind 会把这些真实痕迹连成个人上下文，再围绕你当前的目标，推出值得继续看的内外部信息。

---

## 产品哲学

**收下上下文，找到下一步。**

用户不需要整理录音、不需要从头重听，也不需要先学会怎么向 AI 提问。

### 当前聚焦：个人学习情报流

课堂、文章、视频、随手想法都是个人上下文的输入。总结、闪卡、导图、测验和对话仍然是可自由使用的工具箱；它们的使用结果与反馈，继续补全系统对用户的理解。

产品定义与取舍原则见 [`docs/PRODUCT_THESIS_2026.md`](./docs/PRODUCT_THESIS_2026.md)。

### Taste

| 关键词 | 含义 |
|--------|------|
| **安静** | 95% 界面不通知、不弹窗、不催促 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 没有「生成」按钮，像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件，引用都能跳回 `[MM:SS]` 转录 |
| **第一印象 = 智能** | 学生第一反应应该是「这个 AI 真的懂我在学什么」——不是"好看"，不是"安静"，是**智能** |

视觉为智能让路：日常 95% 克制（双签名色 + 米白纸感 + 极克制投影），仅 6 个仪式时刻允许灵魂迸发（呼吸球、酿造气息、Echo 扫光、收尾动画、流式字符、分享落地页整页放飞）。

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
DASHSCOPE_API_KEY=sk-your-api-key     # Qwen（ASR + LLM + 文档解析）

# LLM provider（至少一个 key；注册表在 src/lib/config/app.config.ts，env 驱动 pickAvailableModelId）
# 有 STEPFUN_API_KEY 默认 step-3.7-flash；否则有 DEEPSEEK_API_KEY 默认 DeepSeek-V4-Flash；否则 qwen3.7-plus
DEEPSEEK_API_KEY=sk-your-api-key
# STEPFUN_API_KEY=your-stepfun-api-key
# 各用途默认模型（留空则回落注册表 recommended）
# LLM_MODEL=         # 主默认（同桌 / 复习 / 学习应用通用）
# WORKSHOP_MODEL=    # 课堂工坊学习应用
# TUTOR_MODEL=       # Tutor agent
# VISION_MODEL=      # 多模态/视觉

# 实时 ASR（课堂同桌依赖）
DASHSCOPE_ASR_WS_MODEL=qwen3-asr-flash-realtime
DASHSCOPE_ASR_WS_SR=16000

# 腾讯云实时说话人分离（多人会议模式，可选）
# TENCENT_ASR_APP_ID=your-app-id
# TENCENT_ASR_SECRET_ID=your-secret-id
# TENCENT_ASR_SECRET_KEY=your-secret-key

# 转录后校对（分层 light → fallback）
TRANSCRIPT_CORRECTION_MODE=layered
TRANSCRIPT_LIGHT_MODEL=qwen-turbo
TRANSCRIPT_FALLBACK_MODEL=qwen-plus

# Echo（CommonStack + Gemini 3 Flash，可选但日常回声需要）
# COMMONSTACK_ECHO_API_KEY=your-key
# COMMONSTACK_ECHO_MODEL=google/gemini-3-flash-preview

# 文章 / 网页原文接入（M12，Firecrawl 首选）
# FIRECRAWL_API_KEY=fc-your-key-here

# 微信服务号（可选）
# WECHAT_APP_ID=your-app-id
# WECHAT_APP_SECRET=your-app-secret
# WECHAT_MP_TOKEN=your-service-account-token

# 功能开关
ASR_POST_EDIT_ENABLED=false            # 低置信片段 LLM 校对（A/B 后再开）
# NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true

# 公网（生产）
# PUBLIC_DOMAIN=capture.meetmind.online
# PUBLIC_PROTOCOL=https

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
| AI 模型 | StepFun / DeepSeek / DashScope(Qwen) / Ark / Relay，env 驱动 `pickAvailableModelId`（有 StepFun key 默认 `step-3.7-flash`，否则有 DeepSeek key 默认 `DeepSeek-V4-Flash`，否则 `qwen3.7-plus`）；`qwen3.5-omni-plus` realtime 仍保留原链路；CommonStack（Gemini 3 Flash）用于 Echo |
| AI 框架 | Vercel AI SDK v6（`streamText + tools + stepCountIs + smoothStream`） |
| 渲染 | Shiki（代码高亮）/ Mermaid（图）/ KaTeX + remark-math（公式）/ react-markdown + remark-gfm |
| 音频处理 | wavesurfer.js、fluent-ffmpeg、@ffmpeg-installer/ffmpeg |
| 内容接入 | Firecrawl（网页文章）/ mammoth（.docx）/ unpdf（PDF）/ youtubei.js（YouTube 导入）/ sharp（图像处理） |
| ASR | DashScope qwen3-asr-flash-realtime（实时 WS，高精度）+ 腾讯云 16k_zh_en_speaker（实时说话人分离）+ qwen3-asr-flash-filetrans（异步长音频） |
| 可观测 | Sentry (`vercelAIIntegration` + `pinoIntegration`) + pino 结构化日志 + AsyncLocalStorage requestId |
| 评测 | Promptfoo + 自研 TS grader（CER / tool-selection / timestamp-citation / LLM rubric） |
| 基础设施 | SWR（数据请求）/ ioredis（Redis）/ nodemailer（邮件验证码）/ sonner（Toast）/ PM2 |

---

## 项目结构

```
meetmind/
├── server.js                     # 自定义 Next.js server（ASR WS 代理：DashScope + 腾讯云说话人分离 + 静态资源 + 长任务保活）
├── prisma/                       # Prisma schema + migrations（含 AsrCorrection / AsrHotword / SharedAgent）
├── openclaw/                     # OpenClaw AI Agent Gateway（与 MeetMind 解耦，已 deprecated，仅 fallback）
├── src/
│   ├── app/
│   │   ├── (main)/app/           # 主页面 page.tsx（God File 2356 行；按域分 6 阶段提取）
│   │   ├── share/[token]/        # v3.0 SharedAgent 公开落地页（SharedAgentLanding + SharedAgentChat）
│   │   ├── api/                  # 68 个 API 路由（薄壳，业务逻辑在 services）
│   │   │   ├── tutor/            # AI 同桌：agent/route.ts (M10 5-mode 主入口) + route.ts (legacy SSE)
│   │   │   ├── apps/             # AI-Native 应用：execute / catalog / plugins / infographic
│   │   │   ├── classroom/        # 课堂态：foresight / mindmap
│   │   │   ├── article/          # M12 文章 / 网页原文导入
│   │   │   ├── wechat/           # 微信服务号：bind / callback / mp / capture
│   │   │   ├── translate/        # en-zh / zh-en 课堂实时翻译
│   │   │   ├── transcribe*/      # ASR 三档：标准 / fast (异步) / turbo (WS)
│   │   │   ├── transcript-enhance/ # 分层 LLM 校对
│   │   │   ├── asr/corrections/  # M5 用户纠错回流 + 周度热词聚合
│   │   │   ├── upload-audio/     # 跨设备同步 T2：录音 blob 上云
│   │   │   ├── video/import/     # B 站 / YouTube / 小宇宙 / 抖音 / 直链
│   │   │   ├── workspace/        # Workspace + Echo 持久化
│   │   │   └── share/            # v3.0 SharedAgent 创建 / 公开读 / 领取 / 埋点
│   │   └── wechat/               # 微信 H5 页面
│   ├── components/
│   │   ├── chat/                 # ChatBase 底座（M11 起 5 面板 100% 收口：ChatBubble/Composer/MessageList/
│   │   │                         #               Renderer + Shiki/Mermaid/lightbox + 3 hooks + markers）
│   │   ├── classroom/            # M9 课堂同桌：Hero / Layout / LeftPanel / CompanionPanel /
│   │   │                         #               RecordingView / LessonCard / Avatar /
│   │   │                         #               InlineAppCard / DemoLessonLoader / MindMap / OctoBuddy
│   │   ├── tutor/                # 复习态 Tutor：AgentPanel / SkillChipRow / ToolCard / RealtimeCallScreen
│   │   ├── intent/               # 「聊聊你想要的」目标共建：IntentDialog / IntentSummaryCard / IntentBioCard
│   │   ├── realtime/             # 实时语音通话 UI：RealtimeOrb + IntentVoiceCallScreen / TutorRealtimeCallScreen
│   │   ├── share/                # v3.0 SharedAgent 创建器 + Canvas 长图
│   │   ├── apps/windows/         # Workshop 窗口：Cheatsheet / Flashcards / Quiz / Mindmap /
│   │   │                         #                StudyReport / Podcast / Infographic
│   │   ├── recorder/             # Recorder.tsx 拆分子模块（含 mic/system/mixed 三档音源）
│   │   ├── EchoCard.tsx          # 回声卡（应用内）
│   │   ├── EchoShareCard.tsx     # 回声分享图（Canvas）
│   │   ├── SafeAITutor.tsx       # Tutor 入口分发（M12 退役 AITutor.tsx 后精简到 138 行）
│   │   └── Recorder.tsx          # 原声录制（1884 行）
│   ├── hooks/                    # 48 个 hooks（含 useOmniRealtimeCall / useClassroomCompanion）
│   ├── stores/                   # Zustand：collection / capture-editor / echo / player / session / ui / mobile-ai
│   ├── types/                    # 共享类型
│   ├── fixtures/                 # demo-app-outputs.ts（首屏试听 demo 课的 mock app 产物）
│   └── lib/
│       ├── ai-native/            # 应用插件系统（7 plugins：cheatsheet / flashcards / quiz / mindmap /
│       │                         #                          class-check / studio-workshop / fallback）
│       ├── prompts/              # 版本化 prompts（M10 mode-driven buildTutorSystemPrompt，5 mode 唯一源）
│       ├── tutor/                # classroom-agent-request + realtime-conversation-bridge
│       ├── ui/                   # copy.ts ── 用户面文案的单一真相源（去开发者黑话）
│       ├── hooks/                # 服务端/通用 hooks（fetchUIMessageStream / useSSEStream / useAuth）
│       ├── services/             # 60+ 业务服务（按域分组）
│       │   ├── asr/              # text-utils / render-state-machine / post-edit / audio-constraints
│       │   ├── classroom/        # recent-focus（30s 窗口提取，给课堂同桌做代词消歧）
│       │   ├── translation/      # 翻译相关服务
│       │   ├── wechat-*-service.ts  # 6 个微信服务（auth / inbox / media / mp / voice-utils / web-session）
│       │   ├── commonstack-echo-service.ts   # Echo LLM 调用
│       │   ├── workspace-echo-service.ts     # Echo 数据管线（1303 行）
│       │   ├── backfill-captures-to-indexeddb.ts  # 跨设备同步回填
│       │   ├── upload-recording-audio.ts     # 跨设备同步 T2 音频上云
│       │   └── ...
│       ├── db/                   # Dexie schema + CRUD
│       ├── capture/              # 收集逻辑
│       ├── context-reach/        # 输入分流（识别录音 / 链接 / 文件 / 文字）
│       ├── longcut/              # 转录算法
│       ├── config/               # 配置中心（app.config.ts 模型注册表）
│       ├── logger.ts             # pino + Sentry breadcrumbs（不要用 console.log）
│       └── server-failover.ts    # 服务端 failover 工具
├── tests/
│   ├── eval/                     # SWE-Bench 风格 harness：asr / tutor + grader + baselines + regression-guard
│   ├── e2e/                      # Playwright
│   └── smoke/                    # 端到端冒烟（路由 / WS / auth / API + 4 mode e2e）
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
- **文章 / 网页原文接入（M12）**：`/api/article/import` + Firecrawl（首选）/ Jina / 本地 fetch 三级回落，Markdown 清洗后展示原文
- **长音频妙记级 ASR**：>10min 自动切 DashScope 异步模式（支持 12 小时），分片 600s + 2s 重叠 + LCS 缝合
- **实时说话人分离（M14.6+）**：双引擎可选——DashScope（高精度无分离）+ 腾讯云 `16k_zh_en_speaker`（实时声纹聚类，支持 10 人）。录音中可无感切换。speakerId 通过 `formatTranscriptWithSpeakers` 注入同桌/复习 AI 上下文
- 微信服务号轻收集入口（`/api/wechat/*` + 6 个 wechat service）

### 课堂同桌（M9 → M14/M14.5 AI-native 重做）
- **首屏 Hero**：身份（"同学"）+ 双 CTA（试听 demo / 录我自己的课）+ 录音来源 rail 直接露出麦克风 / 电脑声音 / 两路都录
- **Demo 课**：仓库内 93s `DEMO_SEGMENTS` + `demo-audio.mp3` 一键灌入，零门槛跑完"chip → 生成 → 追问"闭环
- **可拖动右栏**：默认 480px，range 320–720，双击档位循环，localStorage 持久化
- **动态 chip（M14/M14.5）**：取代 inline app 药丸 / foresight 药丸 / skill 横条，用 Octo Buddy 像素章鱼 + 2-3 个自然问题 chip 轻引导
- **Skill chips / 自然对话 / 内联 app 严格同链路**：统一走 `/api/tutor/agent` mode='in-class'，LLM 出 `<open_app:KEY/>` marker → 前端拦截 → InlineAppCard 嵌入对话；合法 appKey 按 mode 收窄（in-class 只开 mindmap/cheatsheet）
- **Citations 打通**：`[MM:SS]` 引用点击 → 切到 recording 态 → 转录段落高亮
- **代词消歧**：最近 30s 转录作为 `recentFocus` 注入 system prompt
- **EN→中 即时翻译条**：`/api/translate/en-zh` 内联呈现，可一键开关
- **选词解释浮窗（M13）**：选中术语 → `mode='word'` 浮窗释义，基于 selectionText + nearbyContext + fullTranscriptTail
- **静默 ASR 校对 + 热词聚合**：`originalText` + `correctionLevel` 保留；`onRecordingStop` 触发热词聚合，下节课自动用上本节课术语

### Tutor 后端（M10 mode-driven 收口，5 mode 唯一 endpoint）
- Vercel AI SDK v6：`streamText + tools + stepCountIs(3) + smoothStream(word chunking)`
- 4 个内置工具：`makeFlashcards` / `makeQuiz` / `makeMindmap` / `lookupTranscript`
- **5 mode**：`in-class`（课堂同桌）/ `review`（录音视频复习）/ `shared`（分享态对话）/ `goal`（目标共建 onboarding）/ `word`（选词解释浮窗）
- DeepSeek / StepFun / Qwen 三类都禁用 native tools，结构化产物走 `<open_app:KEY/>` 渲染契约
- 思维引导模式（仅 review）：`---思维演示---` / `---正式回答---` 两段式
- 文本 SSE + 语音通话（Qwen-Omni realtime WebSocket）双形态
- ChatBase 底座 5 面板 100% 收口（M13）：IntentDialog / TutorAgentPanel / ClassroomCompanionPanel / SharedAgentChat / WordExplainer

### 回声（Echo）
- 课堂回声：三层骨架（echo + highlights + takeaway）
- 回声卡：应用内轻卡片，系统设计语言
- 分享图：Canvas 绘制，书籍封面排版
- CommonStack + Gemini 3 Flash 生成
- 课堂回声卡可分享（增长引擎）

### v3.0 SharedAgent 裂变（M11 北极星）
- **场景上下文 = 可分享的 Agent**：一节课的理解沉淀成 SharedAgent，班级群点开即用
- 落地页 `/share/[token]`：大气场墨绿/朱批 radial gradient + Octo 大图（唯一允许整页放飞的页面）
- 闭环 5 支点：创建 `OctoCrystalDispatcher` → 落地页 `SharedAgentLanding` + `ArtifactRender` → 分享态对话 `mode='shared'` → 领取 `claimSharedAgent` → 管理 `MyShareList` + 撤销
- 隐私铁律：分享态不读取访问者画像，禁用 native tools，禁用 inline app marker

### AI-Native 应用矩阵
- 6 类已上线：考试速查表、闪卡训练、测验工坊、思维导图、信息图工坊、课堂播客
- 7 个 plugin（`studio-workshop` 含 podcast/renderers/types 3 子模块）
- 统一通过 `/api/apps/execute` 调用，registry 自动分发到对应 plugin
- 同一套数据既支持 WorkshopWindow（全屏）也支持 InlineAppCard（嵌入对话）

### 内容接入扩展（M12）
- **文章 / 网页原文**：`/api/article/import` + Firecrawl（首选）/ Jina / 本地 fetch 三级回落；Markdown 清洗后展示原文
- **微信服务号**：`/api/wechat/*`（bind / callback / mp / capture/[token]）+ 6 个 wechat service
- **视频链接导入**：B 站、YouTube（youtubei.js）、小宇宙播客、抖音、直链
- **文档上传**：图片、PDF（unpdf）、PPT、.docx（mammoth）、音频、视频

### 跨设备同步（v2.1，进行中）
- T1：录音转录段同步到云端 + 登录回填 IndexedDB
- T2：录音 blob 上云持久化 + 流式服务
- **已知缺口**（`roadmap/v2.1-cross-browser-sync-gap.md`）：服务端只存汇总文本不存分段，浏览器 B 点开无转录/锚点/highlight；修复方向=新增分段 SQLite 表 + 客户端拉回回填

### 设计系统 v7
- **核心理念：图书馆台灯 + 朱批红笔。** "色 = 架构"——墨松绿(pine `#2D4F3E`)是 AI 沉淀，朱批红(vermilion `#B5483C`)是学生此刻
- 米白纸感主底色（`paper #FAF7F2`）+ 双签名色 + 极克制投影系统（shadow-soft/card/float）
- 字体三件套：Inter（正文）+ Instrument Serif（仪式字）+ JetBrains Mono（引用资产化 `[MM:SS]`）
- 暗色模式 first-class（`data-theme="dark"`，深棕墨黑 `#14110D`）
- 详见 `AGENTS.md` §5 与 `design-demo/v7/`

### 可观测 + 评测（M1 底座）
- pino 结构化 JSON + AsyncLocalStorage 注入 `requestId/userId`
- `track()` 四路径埋点：asr / tutor / echo / sync
- Sentry `vercelAIIntegration` 自动捕获 AI SDK step/tool span
- Eval harness（SWE-Bench 风格）：`make eval-asr` / `make eval-tutor` / `make eval-guard`
- 4 mode e2e smoke：`make smoke-intent` / `smoke-review` / `smoke-in-class` / `smoke-shared` / `make smoke-all`
- TTFT 测量：`make ttft`（4 mode × N=5）
- Baseline 冻结在 `tests/eval/baselines/`，CI gate 防回归

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | **Agent 阅读路径 + Golden Commands + 大架构 + 设计系统 v7**（接手必读） |
| [`docs/UPGRADE_PLAN.md`](./docs/UPGRADE_PLAN.md) | M1-M4 路线图 + 业界最佳实践决策表（M5+ 见 AGENTS.md §3 摘要） |
| [`CHANGELOG.md`](./CHANGELOG.md) | 各 milestone release notes（停在 M11.5；M12/M13/M14/M14.5 见 commit history） |
| [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) | 可观测底座（pino + Sentry AI + track 埋点） |
| [`docs/ASR_PIPELINE.md`](./docs/ASR_PIPELINE.md) | ASR 飞书妙记级工艺总图 |
| [`docs/TUTOR_AGENT.md`](./docs/TUTOR_AGENT.md) | Tutor agent loop（Vercel AI SDK v6 + tools + 5 mode） |
| [`docs/ECHO_PRODUCT_DEFINITION.md`](./docs/ECHO_PRODUCT_DEFINITION.md) | Echo 产品定义（taste、三层价值、增长引擎） |
| [`docs/APPLICATION_MATRIX_PRD.md`](./docs/APPLICATION_MATRIX_PRD.md) | 应用矩阵产品定义 |
| [`docs/MODEL_REGISTRY_REFACTOR.md`](./docs/MODEL_REGISTRY_REFACTOR.md) | 模型注册表重构记录 |
| [`docs/MOBILE_REFACTOR_PLAN.md`](./docs/MOBILE_REFACTOR_PLAN.md) | 移动端重构计划 |
| [`docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md`](./docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md) | Capture V1 产品定义、收集原则、验收清单 |
| [`tests/eval/README.md`](./tests/eval/README.md) | Eval harness（数据集 / grader / runner / baseline） |
| [`项目开发文档/提示词设计哲学.md`](./项目开发文档/提示词设计哲学.md) | Less Structure, More Intelligence |
| [`roadmap/v3.0-virality-agent.md`](./roadmap/v3.0-virality-agent.md) | v3.0 北极星（场景上下文可分享、Agent 是裂变载体） |
| [`roadmap/v2.1-cross-browser-sync-gap.md`](./roadmap/v2.1-cross-browser-sync-gap.md) | 跨设备同步架构缺口（已确认，待修） |
| [`roadmap/多模态Agent技术架构路线2026-2030.md`](./roadmap/多模态Agent技术架构路线2026-2030.md) | 长期技术路线 |
| [`skills/*/SKILL.md`](./skills/) | Agent 工作规范（架构执行 / 变更流程 / 代码审查 / 系统化调试） |

---

## 许可证

MIT License
