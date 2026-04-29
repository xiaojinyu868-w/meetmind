# MeetMind Repository Map

> 目标：让任何人 3 分钟内知道这个仓库里哪些是原 MeetMind，哪些是新的 Agent Native Infra，哪些是共享底座。
> 最近修订：2026-04-29

## 一句话

这个仓库现在承载两条产品线和一套共享底座：

```text
原 MeetMind 学习产品
  -> 个人学习 / 收集 / 课堂 / Echo / Tutor

新 Agent Native Infra
  -> B 端机构数字员工 / Skill / Tool Atom / Artifact / Trace / Eval

共享底座
  -> Auth / Prisma / LLM / ASR / Search / Voice / Design System / Import pipeline
```

不要把两条产品线混成一个产品叙事。原 MeetMind 是学习产品；新项目是面向机构的 agent native infra。它们共享能力，但目标用户、产品形态和开发判断标准不同。

## 顶层文档入口

| 文档 | 用途 |
|------|------|
| `README.md` | 原 MeetMind 学习产品的公开介绍和快速开始 |
| `AGENTS.md` | AI 开发者进入仓库时的工作规则 |
| `specs/agent-native-infra-spine.md` | 新项目顶层总纲：Agent Native Infra |
| `specs/agent-native-coding-agent-guide.md` | 新空间 coding agent 指南：如何只围绕数字员工 infra 开发 |
| `specs/README.md` | 新项目 specs 阅读入口 |
| `docs/ECHO_PRODUCT_DEFINITION.md` | 原 MeetMind Echo 产品定义 |

## Recommended Product Split

为了降低熵，建议从现在开始把两条线当成 **两个可独立交付的项目**：

| 项目 | 状态 | 建议 |
|------|------|------|
| 原 MeetMind 学习产品 | 已有线上产品 | 继续独立维护和部署，保持 `/app` / Echo / Tutor / 微信收集 |
| Agent Native Infra | 当前交付重点 | 作为新项目推进，可只启动数字员工端，对外开放 `/consult` / `/console` / `/teacher` / `/learn` |

当前共仓是过渡形态：它方便复用 Auth / LLM / ASR / Search / Voice / Prisma 等共享底座，但不意味着两个产品必须长期同进程部署。新的 coding agent 默认服务 **Agent Native Infra**，除非任务明确说要维护原 MeetMind 学习产品。

### 独立部署建议

如果新服务器要同时跑两套服务，推荐使用两个 checkout 或 `git worktree`：

```text
/srv/meetmind-learning      -> 原 MeetMind
/srv/meetmind-agent-infra   -> Agent Native Infra
```

必须隔离：

- PM2 进程名
- 端口
- `.env`
- SQLite / Prisma database path
- `storage/` 上传和运行时资产目录
- `.next` / `.next-dev` 构建目录

示例：

| 项 | 原 MeetMind | Agent Native Infra |
|----|-------------|--------------------|
| PM2 name | `meetmind-learning` | `meetmind-agent-infra` |
| PORT | `3001` | `3002` |
| URL | `/app`, `/wechat`, `/api/workspace`, `/api/tutor` | `/consult`, `/console`, `/teacher`, `/learn`, `/api/consult`, `/api/console` |

不要让两个服务抢同一个端口、数据库或 storage 目录。

## Product Track A：原 MeetMind 学习产品

### 产品定位

以学习者长期上下文为中心的 AI 学习产品。用户像发微信一样把学习现场发给 MeetMind，系统先收下、再理解、再自然长出 Echo / Review / Tutor。

### 主要入口

| 区域 | 路径 | 职责 |
|------|------|------|
| 学习主应用 | `src/app/(meetmind-learning)/app/` | 收集、复习、课堂、Tutor、AI 工坊主界面，URL 仍是 `/app` |
| 微信入口 | `src/app/(meetmind-learning)/wechat/` | 微信 capture / open H5，URL 仍是 `/wechat/*` |
| 学习 API | `src/app/api/(meetmind-learning)/workspace/`, `chat/`, `tutor/`, `wechat/`, `apps/` | 原 MeetMind 的工作区、Tutor、微信、AI 工坊 API，URL 不含 route group |
| 学习组件 | `src/components/Recorder.tsx`, `AITutor.tsx`, `EchoCard.tsx`, `apps/`, `mobile/`, `recorder/`, `tutor/` | 原学习产品 UI |
| 学习服务 | `src/lib/services/workspace-*`, `commonstack-echo-service.ts`, `tutor-service.ts`, `qwen-asr-service.ts`, `web-article-extract-service.ts` | 原学习产品业务逻辑 |
| 客户端数据 | `src/lib/db/`, `src/stores/` | IndexedDB 与 Zustand 状态 |

### 开发原则

- 继续遵守原 MeetMind taste：安静、小、有根、回来的比发出去的更好。
- 原学习产品可以复用共享底座，但不应该依赖 consult / academic / platform-skills。
- 不要把 B 端机构语义塞进原个人学习流。

## Product Track B：Agent Native Infra / Education Service OS

### 产品定位

面向 B 端机构的数字员工基础设施：机构定义场景，agent 组合 tool atoms / skill / generative UI / voice，系统记录 trace，Eval Agent 评测并推动改进。

### 核心抽象

| 抽象 | 说明 | 当前代码位置 |
|------|------|--------------|
| Tool Atom Registry | agent 可调用、用户可感知、平台可评测的服务动作 | `src/lib/consult/service-action-atoms.ts` |
| Skill Contract | 机构方法论包，不是固定 workflow | `platform-skills/` |
| Artifact Runtime | 持续演化的服务状态和生成式 UI | `src/components/consult/` |
| Trace System | 记录 agent 每一步，为评测提供输入 | `src/lib/services/consult-session-service.ts`, `src/components/console/replay-thread.tsx` |
| Eval Agent / Arena | 评测 agent 行为质量，定位失败原子 | `src/lib/consult/arena.ts`, `src/lib/services/consult-arena-service.ts` |

### 主要入口

| 区域 | 路径 | 职责 |
|------|------|------|
| 学生咨询页 | `src/app/(agent-native-infra)/consult/` | 新 agent 学生端 demo / org 入口，URL 仍是 `/consult` |
| 机构控制台 | `src/app/(agent-native-infra)/console/` | 机构资产、线索、skill、playbook、agent assets，URL 仍是 `/console` |
| 老师端 | `src/app/(agent-native-infra)/teacher/` | CoachingSource / Checkpoint 工作台，URL 仍是 `/teacher` |
| 学生服务端 | `src/app/(agent-native-infra)/learn/` | Education Service OS 学生场景练习入口，URL 仍是 `/learn` |
| Consult API | `src/app/api/(agent-native-infra)/consult/` | consult chat / upload / lead / voice，URL 仍是 `/api/consult/*` |
| Console API | `src/app/api/(agent-native-infra)/console/` | 机构管理、leads、skills、arena、assets，URL 仍是 `/api/console/*` |
| Academic API | `src/app/api/(agent-native-infra)/academic/` | Education Service OS 的 assets / scenarios / practice / checkpoints，URL 仍是 `/api/academic/*` |
| Agent tools | `src/lib/consult/` | tool registry、UI tools、arena、action routing |
| Academic services | `src/lib/academic/` | 多租户机构、场景、playbook、practice、checkpoint 服务 |
| Consult services | `src/lib/services/consult-*` | 画像、搜索、session、skill import、arena 服务 |
| Agent UI | `src/components/consult/` | 生成式 UI block、artifact、inline voice、workbench |
| Console UI | `src/components/console/` | replay、tool atom registry、资产面板 |
| Skill assets | `platform-skills/` | meta-skill 与平台 scenario skills |
| Eval / smoke | `scripts/consult-smoke.ts`, `src/lib/consult/*.test.ts` | 回归与评测雏形 |

### 开发原则

- 不要把学术申请样板当成平台本体。
- 新能力必须归属到五个一等公民之一。
- Skill 是机构方法论包，不能写成固定步骤。
- Tool 是服务动作原子，不是媒介或技术函数。
- UI block 要推动 artifact 演化，不要刷屏堆卡。
- 任何重要 agent 行为都应该可 trace、可 replay、可 eval。

## Shared Substrate：共享底座

这些能力可以被两条产品线共同复用：

| 能力 | 路径 |
|------|------|
| Auth / User / Session | `src/lib/services/auth-service.ts`, `src/app/api/(shared-substrate)/auth/` |
| Prisma schema | `prisma/schema.prisma` |
| LLM gateway | `src/lib/services/llm-service.ts` |
| Web search | `src/lib/services/web-search-service.ts` |
| ASR / media | `src/lib/services/qwen-asr-service.ts`, `dashscope-asr-service.ts`, `media-tooling.ts` |
| Video / article import | `src/app/api/(shared-substrate)/video/import/`, `src/app/api/(shared-substrate)/article/`, `src/lib/services/*import*` |
| Realtime voice hook | `src/hooks/useOmniRealtimeCall.ts` |
| Design primitives | `src/components/ui/`, `src/components/academic/` |
| Config / logger / utils | `src/lib/config/`, `src/lib/logger.ts`, `src/lib/utils/` |

共享底座可以向两条产品线提供能力，但不要把某条产品线的业务假设写进共享层。

## Local Runtime Data

这些目录/文件不是产品代码，不应该作为开发入口：

| 路径 | 性质 | 处理方式 |
|------|------|----------|
| `.next-dev/`, `.next/` | Next.js 构建缓存 | 可随时删除，运行时自动再生成 |
| `test-results/`, `playwright-report/` | 测试产物 | 可随时删除 |
| `tsconfig.tsbuildinfo` | TypeScript incremental cache | 可删除，但 `make check` 可能再生成 |
| `storage/` | Agent Native Infra 本地上传资产、skill bundle、机构 demo 数据 | 不提交；清理前先确认是否有需要保留的 demo 资产 |
| `public/temp-audio/`, `public/wechat-media/` | 运行时媒体缓存 | 可按需清理，API 会重建目录 |
| 根目录 `*.png` / `*.mp4` / `微信图片_*.png` | 临时截图或演示素材 | 不应留在根目录；需要保留的素材放到 `public/` 或 `docs/assets/` 并命名说明 |

## Dependency Boundaries

```text
app/api -> lib/services -> lib/utils / db / config
app/page -> components -> hooks / stores / types

Agent Native Infra:
src/app/(agent-native-infra)/consult, console, teacher, learn
  -> components/consult, components/console
  -> lib/consult, lib/academic, lib/services/consult-*
  -> shared substrate

Original MeetMind:
src/app/(meetmind-learning)/app, wechat
  -> original components / hooks / stores
  -> lib/services workspace / tutor / echo / import
  -> shared substrate
```

禁止方向：

- 原学习产品不要 import `src/lib/consult` 或 `src/lib/academic`。
- `components/` 不要 import `lib/services/`。
- `lib/services/` 不要 import `components/`。
- 共享底座不要引用具体 consult skill 或 academic scenario。

## Where To Add New Things

| 你要加什么 | 放哪里 |
|------------|--------|
| 新 agent tool atom | `src/lib/consult/`，同步 console replay、student UI、skill docs、tests |
| 新 scenario skill | `platform-skills/scenarios/<name>/SKILL.md` |
| 新机构数据/多租户能力 | `src/lib/academic/` + `src/app/api/(agent-native-infra)/academic` 或 `src/app/api/(agent-native-infra)/console` |
| 新 consult UI block | `src/components/consult/` |
| 新 console asset view | `src/components/console/` + `src/app/(agent-native-infra)/console/` |
| 新 eval rule | `src/lib/consult/arena.ts` + tests |
| 原学习产品功能 | 先看 `src/DOMAIN.md`，按 workspace/tutor/echo/import 对应域添加 |

## Current Cleanup Direction

优先级从高到低：

1. 文档入口降熵：所有新 agent 相关开发先读 `specs/agent-native-infra-spine.md`。
2. 代码边界降熵：DOMAIN 文档明确 Track A / Track B / Shared Substrate。
3. Trace/Eval 升级：让 agent 行为先可记录、可复盘、可评测。
4. Artifact Runtime：让生成式 UI 从卡片堆叠变成持续服务状态。
5. 最后才是增加更多 scenario skill。
