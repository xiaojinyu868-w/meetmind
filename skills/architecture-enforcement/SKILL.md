# Architecture Enforcement

> 本 skill 定义 MeetMind 代码库的架构边界：哪些是**不变量**（破了会伤产品），哪些是**预算**
> （超了要有理由）。创建/修改文件、加依赖、开新路由、加配置或公共契约时读它。

## 不变量（硬）

这些规则背后都是已经踩过的坑，破坏它们的代价是数据、隐私或旧数据回放：

- **依赖方向单向**：`app/api → lib/services → lib/utils | lib/db | lib/config`；
  `app/pages → components → hooks → stores → types`。services 不 import components；
  components 不直接 import services（走 hooks / props）；utils 不 import services / components；
  `types/` 纯类型，谁都可以 import。
- **API 路由是薄壳**：请求/响应转换 + 鉴权 + 调 service。业务逻辑、数据库操作都在 `lib/services/`。
- **用户面字符串走 `src/lib/ui/copy.ts`**，日志走 `src/lib/logger.ts`。
- **契约不破**：SSE 事件名、stream marker、`/api/apps/execute` 渲染契约、偏好 key、IndexedDB
  schema 版本——改之前找到所有消费方（含前端旧数据回放：teach 的 legacy 词表分支永久保留）。
- **vendor 树不改写**：`src/lib/services/teach-engine/vendor/`、`assets/fenshen/huashu-nuwa/`
  只随上游整体替换；必要的修复以 `[FIX vs upstream]` 标注，准备提回上游。
- **可变服务端状态挂 `globalThis`**（Next dev 每路由独立编译 entry，模块级 Map 会被复制）。

## 尺度预算（软）

| 类型 | 预算 | 含义 |
|------|------|------|
| 页面 / 组件 / hook / 路由 / 服务 | 500 行 | 超过 = 该检查内聚性的信号 |
| prompt / 工具 / 类型 | 300 行 | 同上 |
| vendor 树 | 豁免 | 不改写上游 |

- **预算不是禁令**。判断标准是内聚：一个 600 行的状态机好过三个互相偷看内部状态的文件。
  拆分只在边界清楚、拆出来的东西能独立命名和测试时做。
- 超预算的新文件或明显变大的老文件，在头注写一句为什么（或拆分计划）。不写理由的超标才是问题。
- 已超标的老文件（`make stats` 列出实时清单，不要相信任何文档里写死的行数）：**不要企图一次拆完**。
  先完成当前任务；改动自然形成 ≥50 行独立模块就顺手提取；每次提取后 `make check`。
  整体拆分是独立任务，需要独立的意图和验证。

## 模块边界

```
src/
├── app/                    # Next.js 路由层（薄层）
│   ├── (main)/app/         # 主页面 page.tsx（God File，按域分阶段提取中）
│   ├── api/                # ~125 条 API 路由（薄壳）
│   └── teach/ share/ …     # 独立页面
├── components/             # UI（纯渲染 + 本地状态）；chat/ 是 6 面板共用的 ChatBase 底座
├── hooks/                  # 客户端 hooks（组件与 services 之间的唯一桥）
├── stores/                 # Zustand
├── types/                  # 共享类型
└── lib/
    ├── services/           # 业务逻辑（核心）；子域 asr/ keyframe/ classroom/ teach-codex/ teach-engine/ fenshen/
    ├── ai-native/          # 应用矩阵插件系统（catalog + plugins）
    ├── prompts/            # 所有 prompt 的唯一源
    ├── db/                 # IndexedDB（Dexie）schema + CRUD
    ├── config/             # app.config.ts 模型注册表（env 驱动）
    ├── ui/copy.ts          # 用户面文案
    ├── utils/              # 纯函数
    └── logger.ts
server/                     # 自定义 server.js 的运行时 + ASR WS 代理
desktop/                    # Electron 壳
assets/                     # teach-skills / fenshen nuwa 模板（数据，非代码）
tests/eval/                 # SWE-Bench 风格 harness + baselines
```

## 域划分（放对地方）

| 域 | 入口 | 主要位置 |
|----|------|---------|
| **capture** 收集线 | `page.tsx` + context-reach | `lib/context-reach/`、`hooks/useSourceImport`、`api/sources/*` |
| **classroom** 课中同桌 | `/app` 课堂态 | `components/classroom/`、`hooks/useClassroomCompanion`、`services/classroom/` |
| **asr** | `server.js` WS 代理 + `/api/asr/*`、`/api/transcribe*` | `services/asr/`、`server/asr/`、`docs/ASR_PIPELINE.md` |
| **tutor** 六模式对话 | `POST /api/tutor/agent` | `api/tutor/`、`prompts/tutor-prompts.ts`、`components/tutor/` |
| **apps** 应用矩阵 | `/api/apps/execute` | `lib/ai-native/`、`components/apps/`、`docs/APPLICATION_MATRIX_PRD.md` |
| **teach** AI 家教上课线 | `/api/teach/*`（按 `TeachThread.engine` 分发） | `services/teach-codex/`（codex 底座）、`services/teach-engine/`（pi + OpenMAIC）、`components/teach/` |
| **fenshen** 请一个分身 | `/api/fenshen/*` | `services/fenshen/`、`components/fenshen/`、`assets/fenshen/` |
| **memory** 学习记忆 | `/api/memory/*`、`/api/tutor/memory` | `services/learning-event-service.ts`、`hooks/useLearningContext`、`docs/plans/LEARNING_MEMORY_P0_HANDOFF.md` |
| **workspace** 工作区 / 证据 | `/api/workspace/*` | `services/workspace-*`、`workspace-evidence-service.ts` |
| **auth + wechat** | `/api/auth/*`、`/api/wechat/*` | `services/auth-service.ts`、`wechat-*` |
| **share** 分享裂变 | `/api/share/*`、`/share/[token]` | `roadmap/v3.0-virality-agent.md` |
| **compat** 清小搭 OpenAI 兼容层 | `/api/compat/*` | `api/compat/DOMAIN.md`、`prompts/rehearsal-prompts.ts` |
| **desktop** | Electron | `desktop/DOMAIN.md`、`services/keyframe/` |

不确定归哪个域时，读对应 `DOMAIN.md`；两个域都沾边的逻辑放 services 并让两边通过明确的接口调用，
不要在一个域里偷读另一个域的内部状态。

## 变更影响评估（改之前回答三个问题）

1. **影响范围**：这个文件 / 符号被谁 import？（grep；字符串契约类型系统抓不到）
2. **类型安全**：改了接口后，所有消费方会自动报错吗？不会的话手工列出消费方。
3. **可回滚**：这次变更能用 `git revert` 安全撤销吗？（数据迁移、schema 变更要额外想）

## 文档同步

架构边界变了就同步事实来源，判断标准是"下一个 agent 读旧文档会不会被误导"：

- 目录 / 文件职责变化 → 对应 `DOMAIN.md`
- 阅读路径、关键文件、默认模型、主链路变化 → `AGENTS.md`
- API 请求 / 响应 / marker / 事件名变化 → `src/app/api/**/DOMAIN.md` + 相关 `docs/*`
- 环境变量 / provider / 默认配置变化 → `src/lib/config/DOMAIN.md` + `.env.example`

`DOMAIN.md` 写不变量与理由，不写步骤脚本和行数。

## 新依赖

加 npm 包前想清楚：有明确的使用场景；没有现有依赖能替代；体积与维护状态说得过去；
不是只用一次的小工具（那就抄核心几十行）。想清楚了就加，不需要走审批流程。
包管理器是 **pnpm**（`pnpm-lock.yaml` 是唯一有效的锁文件）。
