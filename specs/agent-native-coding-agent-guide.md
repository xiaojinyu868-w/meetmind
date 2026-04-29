# Agent Native Infra Coding Agent Guide

> 目标：给接手新项目空间的 coding agent 一个低熵入口。
> 最近修订：2026-04-29

## 先判断你在做哪个项目

这个仓库历史上承载过原 MeetMind 学习产品，现在正在形成一个可独立交付的 **Agent Native Infra / 机构数字员工项目**。

默认判断：

```text
如果任务提到 consult / console / skill / tool atom / trace / eval / 数字员工 / 机构 / 申请顾问
  -> 你在做 Agent Native Infra

如果任务提到 /app / Echo / Recorder / Tutor / 微信收集 / 课堂录音 / 学习工作台
  -> 你在做原 MeetMind 学习产品
```

不要把两个项目的产品哲学混在一起。原 MeetMind 是个人学习产品；Agent Native Infra 是面向机构交付数字员工的基础设施。

## Agent Native Infra 的第一性原理

新项目不是“学术申请页面”，也不是“CV / 套磁 / 面试 workflow 集合”。

它要交付的是：

```text
机构定义场景
  -> 数字员工在 agent loop 里组合 tool atoms / skill / generative UI / voice
  -> 系统记录 trace / artifact / user action
  -> Eval Agent 评测体验和任务质量
  -> 改进 tool / skill / UI / memory / search
```

智能应该从 infra、场景方法论、服务动作原子、用户参与和评测闭环中自然涌现，而不是平台提前写死。

## 进入代码前先读

按顺序读：

1. `AGENTS.md`
2. `REPO_MAP.md`
3. `specs/agent-native-infra-spine.md`
4. 本文件
5. 你要修改目录的 `DOMAIN.md`

如果任务明显属于新项目，优先读这些目录：

| 目标 | 路径 |
|------|------|
| 学生端 agent | `src/app/(agent-native-infra)/consult/`, `src/components/consult/` |
| 机构控制台 | `src/app/(agent-native-infra)/console/`, `src/components/console/` |
| Tool atoms / eval | `src/lib/consult/` |
| 多租户 / academic services | `src/lib/academic/`, `src/lib/services/consult-*` |
| Scenario skills | `platform-skills/` |
| 新项目 specs | `specs/agent-native-infra-spine.md`, `specs/academic-service-v0/product-spine.md`, `specs/skill-platform-v0/overview.md` |

## 五个一等公民

任何新能力必须归属到以下之一：

| 公民 | 问题 | 代码锚点 |
|------|------|----------|
| Tool Atom Registry | agent 能选择哪些服务动作 | `src/lib/consult/service-action-atoms.ts` |
| Skill Contract | 机构如何定义场景方法论 | `platform-skills/` |
| Artifact Runtime | 服务状态如何持续演化 | `src/components/consult/`, `src/lib/consult/` |
| Trace System | agent 做过什么如何复盘 | `src/lib/services/consult-session-service.ts`, `src/components/console/replay-thread.tsx` |
| Eval Agent | 怎么知道数字员工好不好 | `src/lib/consult/arena.ts`, `src/lib/consult/ux-replay.ts` |

如果一个需求不能挂到这里，先不要写代码，先改 spine 或问清楚。

## 新项目开发原则

- Skill 是方法论包，不是固定 workflow。
- Tool 是可被 agent 选择、用户可感知、平台可评测的服务动作，不是技术函数。
- UI block 是交互原子的皮肤，不是 markdown 卡片容器。
- 重要结果应进入 artifact，而不是反复刷出多张中间卡。
- 用户提到的导师、学校、方向默认是“探索信号”，不是长期画像事实。
- 搜索结果必须能被评测来源质量；没有来源就要暴露不确定性。
- 等待态只显示一个诚实当前状态；内部推理和 tool trace 默认进入 trace，不默认展示给学生。
- 每个关键体验都应该能被 Experience Trace / Arena 复现和打分。

## 部署策略

### 推荐：新项目可独立部署

如果目标是交付机构数字员工，新服务器可以只部署 Agent Native Infra 这条线。

对外只开放：

```text
/consult/*
/console/*
/teacher/*
/learn/*
/api/consult/*
/api/console/*
/api/academic/*
/api/auth/*
必要的 shared substrate API
```

原 MeetMind 学习产品继续作为另一个线上服务独立存在。这样心智更清楚，部署风险更低。

### 过渡期：共仓但逻辑独立

当前代码仍在一个 Next.js app 中，route group 不改变 URL：

```text
src/app/(meetmind-learning)/app       -> /app
src/app/(agent-native-infra)/consult  -> /consult
```

共仓可以降低迁移成本，但开发时必须保持依赖边界：

- 原学习产品不能 import `src/lib/consult` / `src/lib/academic`。
- Agent Native Infra 不能把原学习产品的 taste、状态或 workspace 假设当成默认。
- 共享底座只放 Auth / Prisma / LLM / ASR / Search / Voice / Import / Design primitives。

### 同机双服务部署

如果同一台服务器同时跑原服务和新服务，必须隔离：

| 项 | 原 MeetMind | Agent Native Infra |
|----|-------------|--------------------|
| 代码目录 | 独立 checkout 或 worktree | 独立 checkout 或 worktree |
| PM2 进程名 | `meetmind-learning` | `meetmind-agent-infra` |
| 端口 | 例如 `3001` | 例如 `3002` |
| SQLite / storage | 独立路径 | 独立路径 |
| `.env` | 独立 | 独立 |
| Nginx | `/app` 或旧域名 | `/consult` / `/console` 或新域名 |

不要让两个进程抢同一个端口、同一个 SQLite、同一个 storage 目录。

## 交付前检查

每次改完：

```bash
make check
make test
```

如果改了新项目入口体验，还要至少手动跑一遍：

```text
http://localhost:3002/consult/demo
```

用一个“只带背景、不知道目标”的模拟用户测试：

```text
我现在没有明确目标。我本科统计，硕士做过大模型文本检测和数据治理，也有一个国家级统计建模比赛奖项，但不知道应该申硕、申博、找导师还是先补论文。
```

观察：

- 是否先接待真实背景，而不是强行进入 Stanford / Percy / CV workflow。
- 是否只问一个关键问题或给少量选择。
- 是否不暴露低价值内部过程。
- 是否没有重复卡片和残留 skeleton。
- 是否有自然下一步。

## 不要做的事

- 不要新增一个固定场景 workflow 来解决一个体验问题。
- 不要把“学术申请 reference implementation”写成平台本体。
- 不要为了展示 tool 而展示 tool。
- 不要把评测做成只看总分的 dashboard；评测必须能定位到失败原子和代码热点。
- 不要把旧 MeetMind 的个人学习逻辑塞进机构数字员工。
