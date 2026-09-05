# fenshen/ —— 「请一个分身」线服务端（codex app-server 底座，teach 平级复刻）

> 用 nuwa skill 原文（女娲·Skill造人术，assets/fenshen/huashu-nuwa/，一个字
> 不改）把一个人蒸馏成分身 skill，再以「课后完整学习上下文 + harness agent」
> 形态与学生对话。复用 teach-codex 已验证的通用件（codex-app-server /
> shim-server / teach.config provider 注册表），零改动 teach 主链路。
> 计划事实源：`docs/../roadmap` 外的实现计划与 spike 在 `out/fenshen-spike/`。

## 架构

```
浏览器 ←SSE→ /api/fenshen/* ←JSON-RPC(stdio)→ codex app-server（每线程一进程）
                ├ 蒸馏线程（每分身一个，一次性）：sandbox=workspace-write
                │    ↕ MCP stdio：Firecrawl 官方 MCP（npx -y firecrawl-mcp，
                │      env 注入 FIRECRAWL_API_KEY）——名人轨语料 agent 自己联网找
                └ 对话线程（每分身一个，长期）：sandbox=read-only，不挂 MCP
              shim（复用 teach 的 Responses→Chat 翻译，ensureShimServer）
                ↓
          上游 chat 模型（teach.config provider 注册表，TEACH_PROVIDER 一行切换）
```

目录布局（`data/fenshen-codex/<egoId>/`）：`distill-home/` 与 `chat-home/`
是两个线程各自的 CODEX_HOME（进程隔离）；`work/` 是两线程共享的 cwd——
蒸馏线程往里写 `skills/<name>-perspective/` 产物，完成时镜像到 `work/skill/`
（对话线程 baseInstructions 的固定挂载点 `./skill/SKILL.md`）；对话上下文
物化文件（`lesson/`、`learner/`）由我们直接写进 `work/`（与沙箱无关）。

关键决定：
- **全线零自研工具**：语料采集 = Firecrawl 官方 MCP（复用现有
  FIRECRAWL_API_KEY）；上下文按「上传长文本」范式物化成文件，agent 用 codex
  内置文件能力自己读；文件读写全走 codex 内置能力。
- **skill 走文件挂载不进 prompt 本体**（SKILL.md 很长，防漂移靠 nuwa 模板
  自带机制）；确认发生在输出上（试听对话 → 像/不像反馈条）。
- **完成检测 = 文件系统事实**：`work/skills/<name>-perspective/SKILL.md`
  出现即蒸馏完成（每个 item/completed 与 turn/completed 后查一次）→
  status=ready + 镜像 skill/ + 发 ego-ready。不解析 agent 的结论文本。
- **unlike → 重蒸馏 turn**：蒸馏线程 resume 后发修订消息（带学生 note），
  状态回 learning，产物修订落盘后完成检测再次触发 ready。

## 文件

| 文件 | 职责 |
|------|------|
| `fenshen-config.ts` | 目录布局（egoPaths：distill-home / chat-home / work）、事件日志目录、nuwa 模板源（assets/fenshen/huashu-nuwa）、私有轨判定 |
| `event-bus.ts` | 按分身 pub/sub + 契约事件类型（SSE 唯一事实源，含 distill-progress / ego-ready） |
| `thread-store.ts` | FenshenEgo prisma CRUD + 事件日志落盘/读取（data/fenshen-events/*.jsonl）+ FenshenServiceError |
| `distill-service.ts` | 蒸馏编排：workspace 准备（nuwa 原文落位 + 私有轨 sources/transcripts/）→ config.toml（shim + Firecrawl MCP）→ thread/start（workspace-write）→ 启动消息（Phase 0A 答案全集）→ exec/MCP 通知映射 distill-progress（**固定人话短语 + 相邻去重**，raw 命令/文件名/Phase 一律丢弃；agent 叙述 text-delta 蒸馏期不下发）→ 完成检测 + skill 镜像；`requestDistillRevision` 重蒸馏 turn |
| `corpus-service.ts` | 私有轨语料管线（P2）：bilibili（官方字幕完整则直接用，否则下载音频 → ffmpeg 转 mp3 → DashScope filetrans 转写）/ upload（复用 /api/upload-audio 产物 → 转写）→ txt 落 `work/sources/transcripts/`；`runPrivateCorpusPipeline` 后台编排（语料就绪→起蒸馏；失败置 failed + failReason + error 事件） |
| `fenshen-session-service.ts` | 对话编排：ensureChatSession（**每次重刷物化文件** + skill 镜像 → config.toml 无 MCP → thread/start，read-only + persona baseInstructions）→ turn/start / turn/interrupt；空轮静默重试（`emptyTurnAction` 纯函数） |
| `lesson-context-service.ts` | 课后上下文物化（从 session-service 拆出）：`buildContextFiles`（纯函数）、`parseLessonSnapshot`、`materializeLessonContext`（prisma / 前端快照 → lesson/* + learner/profile.md） |
| `*.test.ts` | event-bus / thread-store / corpus-service / persona prompt / 上下文物化（lesson-context-service）/ 空轮重试判定（vitest） |

配套：`src/lib/prompts/fenshen-persona-prompt.ts`（对话线程 baseInstructions：
场景设定 + skill 挂载指令）；`assets/fenshen/huashu-nuwa/`（nuwa skill 原文
模板源，运行时复制进每个分身的 work/skills/，一个字不改）。

## 上下文数据源

- `materializeLessonContext(workDir, scope?)`（lesson-context-service）：`scope.sessionId` 给了就按
  「该会话最新分段反查 capture」取这节课（防跨课污染）；查不到用
  `scope.lessonSnapshot`（前端快照，guest/demo 未持久化场景）物化，快照也没有
  就是空课占位——**绝不回落无关 capture**；没给 sessionId 才回退全库最新（旧行为）。
  `ensureChatSession` 每次调用都重刷物化（含已有会话）。
- `WorkspaceTranscriptSegment`（按 capture）→ `lesson/transcript.txt`
  （`[mm:ss] speaker text` 逐段）；无分段退回 capture.normalizedText。
- capture title/previewText + 分段统计 → `lesson/outline.md`。
- `WorkspaceCaptureArtifact` kind='anchor' 且 payload.type='confusion' →
  `lesson/confusions.md`（按时间排序）。
- `User.learnerProfileJson`（bio/goals）→ `learner/profile.md`；
  **只取 capture.userId 归属用户的画像**（capture 归属未知则不取，防跨用户
  画像泄漏）。

## 边界

- 私有轨（bilibili/upload）语料管线在 corpus-service（P2 已交付）：POST
  先返回 ego（learning），后台跑语料→蒸馏；语料失败 status=failed +
  failReason 人可读。中间产物放 public/temp-audio（DashScope filetrans
  需经 PUBLIC_DOMAIN 公网 URL 拉取），转写完成后删除；上传原件保留。
  ASR 依赖 DASHSCOPE_API_KEY + PUBLIC_DOMAIN/PUBLIC_HOST；bilibili 有
  完整官方字幕时可免 ASR。注意：匿名访问 x/player/v2 对 AI 字幕返回空
  （2026-08 实测），不配 BILIBILI_COOKIE 时大部分视频会走 ASR 兜底。
- 单实例部署假设：事件总线/进程注册表是进程内的（复用 teach 的注册表与
  15min 空闲回收；蒸馏 turn 期间通知持续刷新 lastActivity，不会被误回收）。
- 物化是快照：ensureSession 时重刷，session 中途的课件更新 v1 不追求。
- 蒸馏/对话线程共用事件流（按 egoId），但进程与 CODEX_HOME 各自隔离。
- 空轮静默重试：上游偶发瞬断会返回零 delta 的 completed。对话轮完成时
  若一条 delta 都没收到且未补过枪，同线程原样重发一次用户输入（SSE 不断、
  用户无感；判定纯函数 `emptyTurnAction`）。interrupted / 已补过 / 非对话轮
  不重试；重试请求本身失败则按正常完成收尾。
