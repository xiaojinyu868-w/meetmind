# AGENTS.md — MeetMind 全局入口（LLM Wiki）

> 你是接手 MeetMind 的 AI 开发者。本文件只做四件事：**工作方式、命令、路由、索引**。
> 深知识在 wiki 页面里——按 §4 路由表找到该读的页面，再读源码确认，然后动手。

**产品一句话**：用户像发微信一样把学习现场发给 MeetMind；先收下，后台慢慢理解，长出一个真正听过课、懂你在学什么的 AI 同学。两条主线：收集线（随手收下一切）与课堂线（录一节课，课中同桌、课后复习、应用矩阵）。**好的输出 = 个人上下文 + 场景上下文 + 好的模型智能**——产品层给上下文、工具和渲染契约，不用硬规则替模型判断。

**阅读顺序**：本文件 §1 工作方式 → §2 命令 → §4 按任务类型查路由 → 对应 `DOMAIN.md` → 源码。

---

## 1. 工作方式（写给强模型）

产品对自己模型的信条是 **Less Structure, More Intelligence**（`项目开发文档/提示词设计哲学.md`）：给真实上下文、必要契约和判断权，不用规则替它思考，"prompt 永远不为最弱的模型降级设计"。这条信条对你同样成立——本文件与 `skills/*` 给你的是上下文、不变量和验证手段，步骤由你判断。写成规则的地方都带理由；理由不成立的场合可以偏离，把理由写进提交说明或文件头注。

**默认行动，做完汇报。** 产品对用户是"零提问"的（机器 act，不 ask），你对用户也一样：范围内的可逆决定自己拿，用资深同事的常识补齐模糊处并说明假设；发现问题就修，不写"建议后续处理"。只有三种情况停下来问：不可逆的破坏性动作（删数据、改已推送历史、动 `main`）、真正的范围变更、产品 taste 层面的分歧。会话结束时要么工作树干净（已提交并推送到特性分支），要么在汇报里写明什么没提交、为什么。

**地图与真相。** `DOMAIN.md` 是地图（上一个 agent 写的，会过期），源码是真相。要动的东西读源码；读到地图与代码不一致，顺手改对地图。不要因为"节省上下文"而只读地图就动手。

### 不变量（破了会伤产品、数据或下一个人）

- **依赖方向单向**：`app/api → lib/services → lib/utils, lib/db, lib/config`；`app/pages → components → hooks → stores → types`。API 路由是薄壳（转换 + 鉴权 + 调 service）；组件不直接 import services（走 hooks / props）；utils 不 import services / components
- **契约不破**：SSE 事件名、stream marker、`/api/apps/execute` 渲染契约、偏好 key、IndexedDB schema 版本、旧数据回放（teach 的 legacy 词表分支永久保留）——改之前找全消费方，字符串契约类型系统抓不到
- **隐私铁律**：个人上下文默认私有；分享态不出时间戳、不出 marker、不注入访客画像；微信扫码事件只更新登录挑战，不进收集流
- **用户面字符串走 `import { COPY } from '@/lib/ui/copy'`**——这是口吻审查的单一入口；内部黑话不进 UI（回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎 / 引导）
- **日志用 `src/lib/logger.ts`（pino）**，不要 console.log
- **vendor 树不改写**（`src/lib/services/teach-engine/vendor/`、`assets/fenshen/huashu-nuwa/`）：只随上游整体替换，必要修复标 `[FIX vs upstream]`
- **git 边界**：默认在当前特性分支做原子提交并推送同名远端分支；推送或合并 `main`、force-push、改写已推送历史、删远端分支、开 PR 合并——这些要明确指令
- **多人并行（2026-09-11 起）**：一个会话一个 worktree 一个分支，只 `git add <路径>` / `git commit -- <路径>`（禁 `git add -A` / `commit -a` / `stash`），不进别人的目录执行 git；生产只从 `/mnt/meetmind-prod`（`release/prod`）跑，上线 = 合进 `release/prod` 再 `make deploy` → `docs/RELEASE_FLOW.md`

### 默认做法（有理由可偏离）

- **验证与改动成比例**：改了 `.ts/.tsx` 跑 `make check`（增量 tsc，十几秒）；改到哪条链路跑哪条门禁——ASR `make eval-asr`、Tutor `make eval-tutor`、teach-engine / teach-skills / teach prompt `make eval-teach`、prompt / smoothStream / provider `make ttft`（数字波动 = 回归信号）；文档-only 改动不跑 eval
- **代码和文档一起交付**：判断标准是"下一个 agent 读旧文档会不会被误导"。下表是常见对应关系；`DOMAIN.md` 写不变量与理由，不写步骤脚本和一周就过期的行数
- **尺度是预算，不是禁令**：页面/组件/hook/路由/服务 ≤500 行、prompt/工具/类型 ≤300 行是拆分信号。内聚边界清楚才拆；不清楚就先做任务，在头注写一句为什么暂不拆。老的超标文件（实时清单 `make stats`）改到时顺手提取 ≥50 行的独立模块，不企图一次拆完
- **Makefile 是共用命令接口**：可复现、会重复的流程收进去成为新命令；一次性验证脚本放仓库外（`/tmp`），不在仓库里堆临时文件与截图
- **lint 的现实**：`make lint`（`--max-warnings 0`）目前有 178 条历史 warning，是红的，所以不在 CI 门禁里。要求是**你改过的文件不新增 warning**（`npx eslint <文件>` 定向查）；清零历史 warning 是一个独立任务，不要顺手做

### 文档同步对照表

| 变更类型 | 通常要同步 |
|---------|-----------|
| 新增 / 删除 / 重命名文件、目录、关键职责 | 对应目录 `DOMAIN.md` + 必要时本文件 §3/§4 |
| 新增 API 路由、请求体字段、响应契约、stream marker、事件名 | `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 改桌面壳 / 口袋 | `desktop/DOMAIN.md` + `docs/plans/2026-09-09-pocket-capture.md`；改 `desktop/package.json` version 才会触发老用户更新提示 |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example`（涉 Tutor 再加 `docs/TUTOR_AGENT.md`） |
| 改 Tutor / ASR / teach / fenshen / 记忆 主链路 | 对应 `DOMAIN.md` + `docs/TUTOR_AGENT.md` / `docs/ASR_PIPELINE.md` / `docs/TEACH_TUTOR_ENGINE.md` |
| 改用户面文案或设置项 | `src/lib/ui/copy.ts`（按体积拆出的域文件同一口吻规则：`copy-landing` 营销页 / `copy-apps` 应用窗口 / `copy-global-ask` 问同学 / `copy-intent` / `copy-settings` / `copy-share` / `copy-fenshen` / `copy-pocket` 口袋 / `copy-teach-live` 上课舞台）或设置页说明 + 偏好 key 所在 `DOMAIN.md` |
| 交付里程碑 | `CHANGELOG.md` 一条（可追到 commit）+ `make ledger` |

---

## 2. Golden Commands

**运行时：Node.js 24 LTS（`.nvmrc`）；包管理器 pnpm（`pnpm-lock.yaml` 是唯一有效锁文件，`package-lock.json` 已过时）。** `make` 会自动探测 Node 24（`/usr/local/bin`、nvm 目录），找不到才报错；换过 Node 主版本后 `pnpm install --frozen-lockfile` 重装（原生模块按 ABI 编译，不能复用）。

```bash
# 日常
make dev            # 开发服务器（默认 3001，PORT 可覆盖；生产 PM2 跑在 3002）
make check          # 类型检查（改了 .ts/.tsx 就跑）
make build          # 生产构建（≈1.5 分钟；outputFileTracing 已关，此前 30 分钟里 27 分钟是文件追踪）
make deploy         # 固定在 /mnt/meetmind-prod（release/prod）里执行：tsc + 旁路构建（.next-staging）→ 原子切换 → PM2 重载 → 健康与静态资源检查，失败自动回滚；先把你的分支合进 release/prod，否则带不上你的改动（docs/RELEASE_FLOW.md）

# 质量
make test           # Vitest 单测（src/）
make test-server    # server/ 运行时与 ASR 单测
make lint           # ESLint（--max-warnings 0）
make smoke-all      # 4 个 Tutor mode 的 e2e smoke
make ttft           # 首 token 延迟（改 prompt/smoothStream/provider 后跑）
make stats          # 项目统计（超标文件、console.log 残留）
make bundle-report  # 首屏 JS 体积账本（归因构建 → 按文件 / 包列 gzip；ROUTE 可覆盖，默认 /app）

# Eval（SWE-Bench 风格）
make eval           # 完整套件
make eval-asr       # ASR dry-run（改 ASR 链路后跑）
make eval-tutor     # Tutor dry-run（改 Tutor prompt/工具后跑）
make eval-guard     # CI gate：baseline 在 tests/eval/baselines/
make eval-teach     # Teach 引擎出题闭环评测（dry-run；改 teach-engine / teach-skills / teach prompt 后跑）
make ledger         # 生成能力台账（交付里程碑 / 新增底座资产后跑，产物在 design-demo/capability-board/）

# 数据库
make db-push        # 同步 Prisma schema 到 SQLite + 生成 Client

# 共享记忆（Hindsight）
make context-worker # Context 可靠投递进程（生产由 PM2 单独跑：meetmind-context-worker）

# 口袋（桌面剪藏）
make smoke-pocket # 合成账户 → /api/workspace/clip → /pocket 读到 → 撤销 → 清理（SMOKE_BASE 指服务，SMOKE_BROWSER=chromium 加截图）
make test-desktop # 桌面壳纯逻辑单测（不需要 Electron）；框选 / 回执 / 热键体验要在 Mac 上 npm run desktop:dev
make test-context # Context 权限 / 来源 / 重试 / HTTP 契约测试
make smoke-context-live # 真 Hindsight + Tutor + 浏览器全链路验收（SMOKE_BASE 指隔离服务，SMOKE_BROWSER=chromium；非生产库）
```

---

## 3. 架构主线（每条一行，深读走链接）

1. **双存储**：IndexedDB 是客户端真实数据源，服务端 SQLite（Prisma）是同步备份 → `src/lib/db/DOMAIN.md`
2. **收→酿→应**：输入经 context-reach 分流 → API 薄壳 → services → IndexedDB 回写；后台静默理解（"酿"）→ `src/DOMAIN.md`
3. **Tutor 六模式单一入口**：`POST /api/tutor/agent`（in-class / review / shared / goal / word / global），纯对话无 native tools → `src/app/api/tutor/DOMAIN.md` + `docs/TUTOR_AGENT.md`
4. **应用矩阵 M14.6**：结构化产物不走 LLM marker，前端 SkillChip 直调 `/api/apps/execute` → `src/lib/ai-native/DOMAIN.md` + `docs/APPLICATION_MATRIX_PRD.md`
5. **ASR 单遍化（2026-08）**：课中 realtime 即定稿，课后不再自动跑 batch 定稿与说话人分离（/api/transcribe*、/api/asr/diarize 保留供手动精转）；realtime 零产出时兜底批量转写仍保留；文本纠错由 post-edit（DeepSeek V4 Flash，默认开）接管 → `docs/ASR_PIPELINE.md` + `src/lib/services/asr/DOMAIN.md`
6. **跨设备证据**：服务端正规化（TranscriptSegment + CaptureArtifact），按课堂懒拉回填 IndexedDB，不覆盖本机编辑；**录课不丢（2026-09-10）**：录课中每 5s 分片 / 字幕落 IndexedDB + 登录用户每分钟服务端检查点（`/api/workspace/recording-checkpoint`，另一设备看到「录制中」），忘记结束下次打开首页恢复条「继续录 / 就到这里」，>6h 自动收尾；列表 60s / 回前台刷新；一节课服务端只一行（sourceKey `live:{uid}:{sid}` + 按 sessionId 去重） → `roadmap/v2.1-cross-browser-sync-gap.md`
7. **v4.0 全端采集层**：桌面壳（Electron：参数化桌宠 Octo Buddy + 内嵌网页 + loopback 系统音频 + 双击旁听 + **口袋**：`⌘⇧M` 收下任何应用里的选中文字（HTML→Markdown 含 TeX、来源三元组）/ 剪贴板图 / 框选屏，`⌘⇧K` 口袋窗，拖到桌宠也收；服务端 `/api/workspace/clip` + `pocket-clip-service`，北极星 `docs/plans/2026-09-09-pocket-capture.md`）+ 课中主动截图关键帧 + 移动端 Capacitor（方向已定未动工）→ `roadmap/v4.0-everywhere-capture.md` + `desktop/DOMAIN.md`
8. **标题与课后理解**：`主题 · 课程 · M-D` 契约 + 用户改名双锁；定稿后一次 LLM 调用出标题/摘要/精选 → `src/lib/services/lesson-understanding-service.ts` + `src/app/api/DOMAIN.md`
9. **分享裂变 v3.0**：场景上下文可分享、个人上下文默认私有、Agent 是分享单元 → `roadmap/v3.0-virality-agent.md` + `src/app/share/DOMAIN.md`
10. **微信链路**：公众号收集 + 绑定用户文字走微信 Agent（客服消息推送）+ 桌面扫码登录 → `src/app/api/DOMAIN.md` 微信段
11. **God File**：`src/app/(main)/app/page.tsx` 按域分 6 阶段提取为 hooks；顺手提取 ≥50 行独立模块立即 `make check` → `src/app/DOMAIN.md`
12. **ChatBase 底座**：6 个对话面板收口于薄底座 + adapter，底座不引入业务逻辑 → `src/components/chat/DOMAIN.md`
13. **清小搭接入（2026-08）**：`src/app/api/compat/` OpenAI 兼容适配层（「上场前」智能体：语音试讲 → 追问诊断 → 讲稿 docx / 上场包 HTML），Bearer 自验（`XIAODA_API_KEY`，非 MeetMind JWT）+ 每日成本闸，纯增量不改主链路 → `src/app/api/compat/DOMAIN.md`
14. **AI 家教「上课」线（2026-08 起，迁移中双线并存：codex 底座 ↔ teach-engine）**：`/api/teach/*`（SSE 事件契约 + 历史课程 TeachThread）→ 薄壳路由按 `TeachThread.engine`（创建时按 `TEACH_ENGINE` 快照；null 旧线程 = codex）分发两套编排：codex 线 `src/lib/services/teach-codex/` 编排 codex app-server（每线程一进程，CODEX_HOME 隔离 data/teach-codex/）←MCP stdio→ `server/teach/teach-mcp-server.mjs`（内部回调进事件总线），模型经进程内 shim（Responses→Chat）调上游，`TEACH_PROVIDER` 一行切换（默认 gemini-commonstack），工具 schema 单一事实源 `teach-agent/tools.ts`（11 个，无 ask 阻塞）；engine 线见主线 16。前端 tool-call name 双词表（`teach-events.ts` boardEffectOf 双分支，legacy 分支永久保留供旧线程回放）→ `src/app/api/teach/DOMAIN.md` + `src/lib/services/teach-codex/DOMAIN.md`
15. **「请一个分身」线（2026-08，nuwa skill × codex harness）**：`/api/fenshen/*`（SSE 事件契约与 teach 同构）→ `src/lib/services/fenshen/` 复用 teach-codex 通用件（进程封装/shim/provider 注册表）；蒸馏线程（workspace-write + Firecrawl 官方远端 MCP）跑原版 nuwa skill（`assets/fenshen/huashu-nuwa/` 原文，零改动）产人物 SKILL.md；对话线程（read-only、零 MCP）挂 skill  persona + 课后上下文物化文件（lesson/ learner/）；私有轨语料 `corpus-service.ts`（B站字幕捷径→ASR 兜底）；skill 永不对用户可见，确认走试听「像/不像」→ 重蒸馏；spike 事实源 `out/fenshen-spike/REPORT.md` → `src/app/api/fenshen/DOMAIN.md` + `src/lib/services/fenshen/DOMAIN.md`
16. **teach 引擎迁移（2026-09，pi + vendor OpenMAIC，P1 已接线）**：主线 14 的 engine 侧——`src/lib/services/teach-engine/`（teach-engine-service 编排：每线程一个 pi Agent + StreamFn 桥 + 结构化动作直出边生成边执行；vendor 树豁免 500 行铁律）；`TEACH_ENGINE=codex|engine` 决定新建线程归属（TeachThread.engine 快照），事件契约与 codex 线一致（name 为新动作词表；v1 不发 image-ready）；与 codex 底座双线并存 → `src/lib/services/teach-engine/DOMAIN.md` + `docs/TEACH_TUTOR_ENGINE.md`
17. **共享记忆底座（2026-09-09 合入，Hindsight 0.9.2）**：`src/lib/services/context/`（Context v1 API `/api/context/v1/*` / 可靠投递 worker `make context-worker` / 用户+空间独立 bank / 授权 mmctx_ / 暂停·忘记清理 / prepare 召回）；写侧 `learning-observation-service` **双写** `LearningEvent`（事实）+ `ContextEvent`（原始经历 → Hindsight）；读侧 `LearnerContext` = 事实半（`learner-context-provider`，掌握轨迹）+ 理解半（`context/learner-understanding`，有来源的跨应用记忆），应用矩阵 / Tutor / teach 一处格式化消费；`CONTEXT_ENABLED` 灰度，关掉只影响内部应用读写不删数据 → `src/lib/services/context/DOMAIN.md` + `docs/plans/CONTEXT_M1_DELIVERY.md` + `docs/plans/CONTEXT_SERVER_HANDOFF.md`
18. **teach 第三代引擎 live stage（2026-09-10，第二轮 09-11）**：主线 14/16 的继任候选——模型直出「标签流」（口播 / 板书块 / 动作交错；`<draw>` 模型写 JS 由确定性运行时算几何 / 函数 / 动画（`src/lib/teach-live-draw/`，Worker 沙箱，切线一定垂直半径）、`<svg>` 逐元素闭合即上板、`<plot>` 声明式函数图、`<anim>` 代码动画、`<widget>` 沙箱交互件、`<image>` 异步生图、口播 `{{ }}` 内联计算），服务端只解析 + 扇出（`src/lib/services/teach-live/`，一轮一次 streamText，GLM-5.3-Flash `reasoning_effort=low` TTFT ~0.9s），前端 `/teach/live` 按语音节奏演出（到达 / 演出两条时间轴，`src/components/teach-live/`）；`TeachThread.engine='live'`，与 codex / engine 三线并存 → `src/lib/services/teach-live/DOMAIN.md` + `docs/TEACH_TUTOR_ENGINE.md` §12

---

## 4. 任务路由表（按任务类型找该读的页面）

| 任务类型 | 阅读顺序 |
|---------|---------|
| **改 UI / 组件** | `src/components/DOMAIN.md` → 对应子目录 DOMAIN.md → 具体组件 |
| **改任意 AI 对话面板** | `src/components/chat/DOMAIN.md`（ChatBase 底座 + 6 面板 adapter） |
| **改课堂同桌 / Hero / 内联 app 卡** | `src/components/classroom/DOMAIN.md` → 对应组件 |
| **改复习态 Tutor / Skill chip** | `src/components/tutor/DOMAIN.md` → 对应组件 |
| **改 Workshop 应用窗口** | `src/components/apps/windows/DOMAIN.md` → 对应窗口 |
| **改页面路由** | `src/app/DOMAIN.md` → 对应 page.tsx（God File 先读 §3-11） |
| **改 API 接口** | `src/app/api/DOMAIN.md` → 对应子目录 DOMAIN.md → route.ts |
| **改清小搭接入 / 「上场前」** | `src/app/api/compat/DOMAIN.md` → 对应 route / `src/lib/prompts/rehearsal-prompts.ts` |
| **改 AI 家教上课线（codex 底座）** | `src/app/api/teach/DOMAIN.md`（事件契约）→ `src/lib/services/teach-codex/DOMAIN.md` → 对应模块；工具 schema 改 `teach-agent/tools.ts` |
| **改 teach 新引擎（pi + OpenMAIC，P1）** | `src/lib/services/teach-engine/DOMAIN.md` → teach-engine-service.ts / runtime/*；动作词表改 `runtime/action-map.ts`；prompt 改 `src/lib/prompts/teach-teacher-prompt.ts` 的 `buildTeachEngineInstructions` |
| **改上课舞台（teach-live：标签流 / 多模态板书 / 节奏）** | `src/lib/services/teach-live/DOMAIN.md`（协议 + 事件）→ `src/components/teach-live/DOMAIN.md`（两条时间轴）→ 协议改 `src/types/teach-live.ts` + `live-markup-parser.ts`；教学大脑改 `src/lib/prompts/teach-live-prompt.ts`（改 `<draw>` API 必须同步 `DRAW_API` 段）；渲染器在 `components/teach-live/blocks/` 与 `draw/`；`<draw>` 运行时 `src/lib/teach-live-draw/DOMAIN.md`；文案 `src/lib/ui/copy-teach-live.ts` |
| **改「请一个分身」线（蒸馏/对话）** | `src/app/api/fenshen/DOMAIN.md`（事件契约）→ `src/lib/services/fenshen/DOMAIN.md` → 对应模块；nuwa 模板在 `assets/fenshen/huashu-nuwa/`（只随上游版本整体替换，不做局部改写）；前端 `src/components/fenshen/DOMAIN.md` |
| **改 Tutor 后端 / prompt** | `src/app/api/tutor/DOMAIN.md` + `src/lib/prompts/tutor-prompts.ts` + `项目开发文档/提示词设计哲学.md` |
| **改管理员 AI 控制中心** | `src/components/admin/DOMAIN.md` → `src/lib/services/ai-control-service.ts` → `src/app/api/admin/ai-control/route.ts` |
| **改目标共建 / 教练对话** | `src/components/intent/DOMAIN.md`（IntentDialog 系列 + `buildGoalSegment`） |
| **改实时语音通话** | 2026-08 已下线（/api/tutor-call 已拆除，组件 deprecated）；历史参考：`src/components/realtime/DOMAIN.md` |
| **改业务逻辑（service）** | `src/lib/services/DOMAIN.md` → 对应 service 文件 |
| **改 ASR / 说话人分离** | `docs/ASR_PIPELINE.md` + `src/lib/services/asr/DOMAIN.md` + `diarization-service.ts` |
| **改 AI-Native 插件** | `src/lib/ai-native/plugins/DOMAIN.md` → 对应 plugin |
| **改 SharedAgent / 裂变** | `roadmap/v3.0-virality-agent.md` → `src/app/api/share/DOMAIN.md` → `src/app/share/DOMAIN.md` → `src/components/share/DOMAIN.md` |
| **改文章 / 网页原文接入** | `src/lib/services/web-article-extract-service.ts` + `jina-reader-service.ts`；`.env.example` 配 `FIRECRAWL_API_KEY` |
| **改微信登录 / 绑定 / Agent** | `src/app/api/DOMAIN.md` 微信段 → `wechat-qr-auth-*` / `wechat-agent-service.ts` / `wechat-identity-service.ts` |
| **改跨设备同步** | `roadmap/v2.1-cross-browser-sync-gap.md` → `workspace-evidence-service.ts` + `backfill-captures-to-indexeddb.ts` |
| **改桌面壳 / 全端采集** | `roadmap/v4.0-everywhere-capture.md` → `desktop/DOMAIN.md` → `src/lib/services/keyframe/DOMAIN.md` |
| **改标题 / 课后理解** | `src/lib/services/lesson-title-service.ts` + `lesson-understanding-service.ts` + `src/app/api/DOMAIN.md` AI 能力段 |
| **改用户面文案** | `src/lib/ui/copy.ts`（口吻真相源；/app 首屏用不到的域按体积拆成同目录 `copy-*.ts`：landing / apps / global-ask / intent / settings / share / fenshen，规则相同——新增字符串先看所属域文件） |
| **改状态管理 / 类型 / 配置 / 模型** | `src/stores/DOMAIN.md` / `src/types/DOMAIN.md` / `src/lib/config/DOMAIN.md` → `app.config.ts` → `llm-service.ts` |
| **改设置项 / 用户偏好** | `src/app/DOMAIN.md` 设置页 → `src/lib/utils/DOMAIN.md` → 所有消费该偏好的 hooks/components |
| **改共享学习记忆 / Context 服务 / 记忆开发者接入** | `docs/plans/LEARNING_MEMORY_V1_SPEC.md`（V1 目标）→ `docs/plans/CONTEXT_M1_DELIVERY.md`（已实现能力与限制）→ `src/lib/services/context/DOMAIN.md` + `src/app/api/context/DOMAIN.md`；UI 看 `src/components/context/DOMAIN.md`，接入包看 `packages/context-sdk/DOMAIN.md`；旧入口与迁移背景见 `src/app/api/memory/DOMAIN.md` + `docs/plans/LEARNING_MEMORY_P0_HANDOFF.md` |
| **改设计 / 视觉** | `docs/DESIGN_SYSTEM.md` + `design-demo/v7/` showcase + `docs/PRODUCT_TASTE.md` |
| **处理 bug** | `skills/debugging/SKILL.md` → 先诊断再动手 |

---

## 5. Wiki 索引（深知识在这里）

**产品**
- `README.md` — 产品叙事、上下文理念、能力清单
- `docs/PRODUCT_TASTE.md` — Taste 宪法：安静/有根/第一印象、行为原则、仪式时刻白名单、文案规则
- `docs/ECHO_PRODUCT_DEFINITION.md` / `docs/APPLICATION_MATRIX_PRD.md` / `docs/PRODUCT_THESIS_2026.md` — 单品定义

**设计**
- `docs/DESIGN_SYSTEM.md` — 设计系统 v7 文字真相源（双签名色 / token / 组件 / 暗色）
- `design-demo/v7/` — 9 篇可视化 showcase HTML + tokens.css

**技术深潜**
- `docs/ASR_PIPELINE.md` — ASR 飞书妙记级工艺总图
- `docs/TUTOR_AGENT.md` — Tutor agent loop（AI SDK v6）
- `docs/TEACH_TUTOR_ENGINE.md` — AI 家教课堂引擎设计（pi harness + vendor OpenMAIC 28 动作引擎 + skill 体系；选型实测见 `out/teach-harness-ab/REPORT.md`）
- `docs/OBSERVABILITY.md` — pino + Sentry + track 埋点
- `docs/MODEL_REGISTRY_REFACTOR.md` — 模型注册表
- `项目开发文档/提示词设计哲学.md` — Less Structure, More Intelligence

**路线与历史**
- `roadmap/v4.0-everywhere-capture.md` — 全端采集层三层北极星（采集 / 学习线索 / 规则 Hook）
- `roadmap/v3.0-virality-agent.md` — 分享裂变北极星
- `roadmap/v2.1-cross-browser-sync-gap.md` — 跨设备同步
- `roadmap/多模态Agent技术架构路线2026-2030.md` — 长期技术路线
- `CHANGELOG.md` — 里程碑日志（当前至 2026-07 v4.0 周期）
- `docs/UPGRADE_PLAN.md` — M1-M4 旧路线（M5+ 以 CHANGELOG/commit 为准）

**Agent 工作规范（Skills）**

| Skill | 何时读 |
|-------|--------|
| `skills/architecture-enforcement/SKILL.md` | 创建/修改文件、加依赖、开路由时——不变量 vs 尺度预算、域划分 |
| `skills/making-changes/SKILL.md` | 每次写代码时——判断优先的变更方式、文档同步、验证比例、提交与推送边界 |
| `skills/code-review/SKILL.md` | 完成变更后自审——三问 + 严重等级 |
| `skills/debugging/SKILL.md` | 遇到 bug 时——假设驱动、证据优先，不能复现也能修 |

（`skills/rehearsal-coach/`、`skills/thu-slide-deck/` 是给清小搭「上场前」智能体用的产品 skill，不是 agent 工作规范。）

**技术栈速记**：Next.js 14 + 自定义 `server.js`（ASR WS 代理）+ TS 5.3 · Tailwind 3.4 · Prisma + SQLite · Dexie · Zustand · AI SDK v6 · Motion（营销页动效，`motion/react`）· PM2 · Electron（`desktop/`）· pnpm · Node 24

---

## 6. 源码速查树（完整版见 `src/DOMAIN.md` 及各子域 DOMAIN.md）

```
src/
├── app/            # 页面 + API（各自有 DOMAIN.md；page.tsx 是 God File，按域提取中）
├── components/     # ~220 组件（ui / chat / classroom / tutor / apps / intent / realtime / share / companion...）
├── hooks/          # ~55 hooks + data/
├── stores/         # Zustand（8 stores）
├── lib/
│   ├── services/   # ~85 服务（asr/ keyframe/ classroom/ translation/ 子域有 DOMAIN.md）
│   ├── prompts/    # tutor-prompts.ts（六模式唯一 prompt 源）
│   ├── ai-native/  # 应用插件系统（8 plugins + catalog）
│   ├── db/         # IndexedDB schema（v8）+ CRUD
│   ├── ui/copy.ts  # 用户面文案口吻真相源（copy-*.ts：landing / apps / global-ask / intent / settings / share / fenshen 按体积拆出）
│   └── config/     # app.config.ts（模型注册表，env 驱动）
├── desktop/        # Electron 壳（仓库根 desktop/：main/shell-window/quick-panel/screenshot/updater）
└── tests/eval/     # SWE-Bench 风格 harness + baselines
```
