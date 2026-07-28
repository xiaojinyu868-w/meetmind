# AGENTS.md — MeetMind 全局入口（LLM Wiki）

> 你是接手 MeetMind 的 AI 开发者。本文件只做四件事：**铁律、命令、路由、索引**。
> 深知识全部在 wiki 页面里——按 §4 路由表找到该读的页面再动手，不要通读本文件以外的文档。

**产品一句话**：用户像发微信一样把学习现场发给 MeetMind；先收下，后台慢慢理解，长出一个真正听过课、懂你在学什么的 AI 同学。两条主线：收集线（随手收下一切）与课堂线（录一节课，课中同桌、课后复习、应用矩阵）。

**阅读顺序**：本文件 §1 铁律 → §2 命令 → §4 按任务类型查路由 → 对应 `DOMAIN.md` / wiki 页面。

---

## 1. 铁律（每次动手前）

- **每次改完必跑 `make check`**（tsc 类型检查）；改 ASR / Tutor 前后必跑 `make eval-asr` / `make eval-tutor`（数字波动 = 回归信号）
- **只读 DOMAIN.md，不确定的再读源码**；不要发明新脚本，只用 Makefile 里的命令
- **代码和文档必须一起交付**：改了配置、模型、路由契约、目录结构、关键文件、依赖边界、默认行为或用户可见流程，必须同步对应 `DOMAIN.md` / `docs/*` / `.env.example`；新增目录含 3+ 源码文件或承担独立职责必须补 `DOMAIN.md`
- **用户面字符串必须 `import { COPY } from '@/lib/ui/copy'`**；禁用词：回声卡 / 酿 / 预知气泡 / 工坊 / 研判 / 引擎 / 引导
- **不主动 git commit / push**，用户明确要求时才做
- **日志用 `src/lib/logger.ts`（pino），不要 console.log**

### 文档同步检查（改完先想这张表，再 `make check`）

| 变更类型 | 必须同步 |
|---------|---------|
| 新增 / 删除 / 重命名文件、目录、关键职责 | 对应目录 `DOMAIN.md` + 必要时本文件 §3/§4 |
| 新增 API 路由、请求体字段、响应契约、stream marker | `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example` + `docs/TUTOR_AGENT.md` |
| 改 Tutor / ASR / AI-Native 主链路 | 对应 `DOMAIN.md` + `docs/TUTOR_AGENT.md` / `docs/ASR_PIPELINE.md` |
| 改用户面文案或设置项 | `src/lib/ui/copy.ts` 或设置页说明 + 偏好 key 所在 `DOMAIN.md` |

### 架构护栏（skills/architecture-enforcement 摘要）

- **文件大小硬限制**：页面/组件/hook/路由/服务 ≤ 500 行；prompt/工具/类型 ≤ 300 行。新文件不得超过；修改导致超标必须先拆分。实时超标清单跑 `make stats`
- **依赖方向（单向）**：`app/api → lib/services → lib/utils, lib/db, lib/config`；`app/pages → components → hooks → stores → types`。禁止：services→components、components→services（走 hooks/props）、utils→services/components、API 路由写业务逻辑、文案散落组件

---

## 2. Golden Commands

**运行时：Node.js 24 LTS（`.nvmrc`）。** 切换运行时先 `nvm use && npm ci`，不要复用其他 Node 主版本的 `node_modules`。

```bash
# 日常
make dev            # 开发服务器（默认 3001，PORT 可覆盖）
make check          # 类型检查（每次改完必跑）
make build          # 生产构建（限单核 + 1GB 防 OOM）
make deploy         # 构建 + PM2 优雅重启 + /api/health 验证

# 质量
make test           # Vitest 单测（src/）
make test-server    # server/ 运行时与 ASR 单测
make lint           # ESLint（--max-warnings 0）
make smoke-all      # 4 个 Tutor mode 的 e2e smoke
make ttft           # 首 token 延迟（改 prompt/smoothStream/provider 后必跑）
make stats          # 项目统计（超标文件、console.log 残留）

# Eval（SWE-Bench 风格）
make eval           # 完整套件
make eval-asr       # ASR dry-run（改 ASR 必跑）
make eval-tutor     # Tutor dry-run（改 Tutor 必跑）
make eval-guard     # CI gate：baseline 在 tests/eval/baselines/

# 数据库
make db-push        # 同步 Prisma schema 到 SQLite + 生成 Client
```

---

## 3. 架构主线（每条一行，深读走链接）

1. **双存储**：IndexedDB 是客户端真实数据源，服务端 SQLite（Prisma）是同步备份 → `src/lib/db/DOMAIN.md`
2. **收→酿→应**：输入经 context-reach 分流 → API 薄壳 → services → IndexedDB 回写；后台静默理解（"酿"）→ `src/DOMAIN.md`
3. **Tutor 六模式单一入口**：`POST /api/tutor/agent`（in-class / review / shared / goal / word / global），纯对话无 native tools → `src/app/api/tutor/DOMAIN.md` + `docs/TUTOR_AGENT.md`
4. **应用矩阵 M14.6**：结构化产物不走 LLM marker，前端 SkillChip 直调 `/api/apps/execute` → `src/lib/ai-native/DOMAIN.md` + `docs/APPLICATION_MATRIX_PRD.md`
5. **ASR 两段式**：课中 realtime 保延迟，课后完整原声 batch 定稿替换 → `docs/ASR_PIPELINE.md` + `src/lib/services/asr/DOMAIN.md`
6. **跨设备证据**：服务端正规化（TranscriptSegment + CaptureArtifact），按课堂懒拉回填 IndexedDB，不覆盖本机编辑 → `roadmap/v2.1-cross-browser-sync-gap.md`
7. **v4.0 全端采集层**：桌面壳（Electron：内嵌网页 + loopback 系统音频 + 全局热键截图 + 小窗）+ 课中主动截图关键帧 + 移动端 Capacitor（方向已定未动工）→ `roadmap/v4.0-everywhere-capture.md` + `desktop/DOMAIN.md`
8. **标题与课后理解**：`主题 · 课程 · M-D` 契约 + 用户改名双锁；定稿后一次 LLM 调用出标题/摘要/精选 → `src/lib/services/lesson-understanding-service.ts` + `src/app/api/DOMAIN.md`
9. **分享裂变 v3.0**：场景上下文可分享、个人上下文默认私有、Agent 是分享单元 → `roadmap/v3.0-virality-agent.md` + `src/app/share/DOMAIN.md`
10. **微信链路**：公众号收集 + 绑定用户文字走微信 Agent（客服消息推送）+ 桌面扫码登录 → `src/app/api/DOMAIN.md` 微信段
11. **God File**：`src/app/(main)/app/page.tsx` 按域分 6 阶段提取为 hooks；顺手提取 ≥50 行独立模块立即 `make check` → `src/app/DOMAIN.md`
12. **ChatBase 底座**：6 个对话面板收口于薄底座 + adapter，底座不引入业务逻辑 → `src/components/chat/DOMAIN.md`

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
| **改 Tutor 后端 / prompt** | `src/app/api/tutor/DOMAIN.md` + `src/lib/prompts/tutor-prompts.ts` + `项目开发文档/提示词设计哲学.md` |
| **改管理员 AI 控制中心** | `src/components/admin/DOMAIN.md` → `src/lib/services/ai-control-service.ts` → `src/app/api/admin/ai-control/route.ts` |
| **改目标共建 / 教练对话** | `src/components/intent/DOMAIN.md`（IntentDialog 系列 + `buildGoalSegment`） |
| **改实时语音通话** | `src/components/realtime/DOMAIN.md` → RealtimeOrb + 两个 CallScreen；WS 在 `server.js` `/api/tutor-call` |
| **改业务逻辑（service）** | `src/lib/services/DOMAIN.md` → 对应 service 文件 |
| **改 ASR / 说话人分离** | `docs/ASR_PIPELINE.md` + `src/lib/services/asr/DOMAIN.md` + `diarization-service.ts` |
| **改 AI-Native 插件** | `src/lib/ai-native/plugins/DOMAIN.md` → 对应 plugin |
| **改 SharedAgent / 裂变** | `roadmap/v3.0-virality-agent.md` → `src/app/api/share/DOMAIN.md` → `src/app/share/DOMAIN.md` → `src/components/share/DOMAIN.md` |
| **改文章 / 网页原文接入** | `src/lib/services/web-article-extract-service.ts` + `jina-reader-service.ts`；`.env.example` 配 `FIRECRAWL_API_KEY` |
| **改微信登录 / 绑定 / Agent** | `src/app/api/DOMAIN.md` 微信段 → `wechat-qr-auth-*` / `wechat-agent-service.ts` / `wechat-identity-service.ts` |
| **改跨设备同步** | `roadmap/v2.1-cross-browser-sync-gap.md` → `workspace-evidence-service.ts` + `backfill-captures-to-indexeddb.ts` |
| **改桌面壳 / 全端采集** | `roadmap/v4.0-everywhere-capture.md` → `desktop/DOMAIN.md` → `src/lib/services/keyframe/DOMAIN.md` |
| **改标题 / 课后理解** | `src/lib/services/lesson-title-service.ts` + `lesson-understanding-service.ts` + `src/app/api/DOMAIN.md` AI 能力段 |
| **改用户面文案** | `src/lib/ui/copy.ts`（唯一真相源） |
| **改状态管理 / 类型 / 配置 / 模型** | `src/stores/DOMAIN.md` / `src/types/DOMAIN.md` / `src/lib/config/DOMAIN.md` → `app.config.ts` → `llm-service.ts` |
| **改设置项 / 用户偏好** | `src/app/DOMAIN.md` 设置页 → `src/lib/utils/DOMAIN.md` → 所有消费该偏好的 hooks/components |
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
| `skills/architecture-enforcement/SKILL.md` | 创建/修改文件时 |
| `skills/making-changes/SKILL.md` | 每次写代码时（Plan→Execute→Document→Verify→Review→Commit） |
| `skills/code-review/SKILL.md` | 完成变更后自审 |
| `skills/debugging/SKILL.md` | 遇到 bug 时 |

**技术栈速记**：Next.js 14 + 自定义 `server.js`（ASR WS 代理）+ TS 5.3 · Tailwind 3.4 · Prisma + SQLite · Dexie · Zustand · AI SDK v6 · PM2 · Electron（`desktop/`）

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
│   ├── ui/copy.ts  # 用户面文案唯一真相源
│   └── config/     # app.config.ts（模型注册表，env 驱动）
├── desktop/        # Electron 壳（仓库根 desktop/：main/shell-window/quick-panel/screenshot/updater）
└── tests/eval/     # SWE-Bench 风格 harness + baselines
```
