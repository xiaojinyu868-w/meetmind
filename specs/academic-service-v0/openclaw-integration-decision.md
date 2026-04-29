# OpenClaw 集成决策

> 状态：已对齐，作为 Education Service OS V0 的架构前置决策。
> 最近修订：2026-04-24（根据 OpenClaw 官方文档调整：Gateway 是单工作区 full-operator-access surface；改为"机构级 sidecar"而非"学生级 sidecar"；协议从概念改成具体 HTTP 接口）

## 结论

Education Service OS V0 采用 **OpenClaw Gateway 作为机构级 sidecar**。

OpenClaw 是独立智能执行层，负责长记忆、主动 agent、搜索和多步执行；MeetMind 是产品体验和业务数据系统，负责用户、Workspace、素材、语音同桌、展示和回写。

一句话：

**OpenClaw Gateway 每机构一个实例，只监听内网；MeetMind 后端通过两个官方 HTTP 接口代理所有调用；学生数据留 MeetMind，OpenClaw memory 只承载机构级与运行期资产。**

## 核心现实约束（来自官方文档）

决策前必须先承认的几件事：

1. OpenClaw Gateway 官方描述为 **"full operator-access surface"**，默认对持有 token 者授予 owner 级权限。
2. Gateway **不是为多租户 SaaS 设计的**，一个实例绑定一个 workspace（`~/.openclaw/workspace/`），memory/skills 都是 workspace 级。
3. 对外有两个稳定 HTTP 接口：
   - `POST /tools/invoke`（非流式）
   - `POST /v1/chat/completions`（OpenAI 兼容，支持 SSE）
4. 鉴权：`Authorization: Bearer <token-or-password>`；token 泄露 = 整个 workspace 沦陷。
5. Skills 定义是 **Markdown + YAML frontmatter**（`SKILL.md`），不是 TypeScript SDK，agent 读 markdown 自己决定用哪些工具。
6. Memory 由 `MEMORY.md` / `memory/YYYY-MM-DD.md` / `DREAMS.md` 组成，默认 SQLite 后端，可替换为 QMD / Honcho。

**推论**：任何把整个平台学生都塞进一个 Gateway、或者把 Gateway 暴露到公网让学生端直连的方案，都 **不可接受**。

## 部署拓扑（V0）

```text
Internet
   │
   ▼
┌─────────────────────────────────────────────┐
│ MeetMind Next.js App  (capture.meetmind.online) │
│  - 学生 /app, 老师 /teacher                    │
│  - Prisma (SQLite) + IndexedDB                 │
│  - /api/academic/*  ← 所有 OpenClaw 调用在此  │
│  - 语音同桌 / ASR / video/import               │
└─────────────────────────────────────────────┘
                   │  (内网 HTTP)
                   │   Authorization: Bearer <org-token>
                   │   sessionKey=<orgId>:<studentId>:<scenario>
                   ▼
┌─────────────────────────────────────────────┐
│ OpenClaw Gateway  (127.0.0.1:18789)           │
│  - 独立 Node 进程，systemd 管理               │
│  - workspace = ~/.openclaw/workspaces/<orgId> │
│  - skills: coaching-twin, institution-playbook│
│  - memory: 机构级 + 运行期                    │
└─────────────────────────────────────────────┘
                   │
                   ▼
        External LLM providers / 搜索 / 工具
```

关键规则：

- **Gateway 绝不绑 0.0.0.0**，只绑 `127.0.0.1` 或内网 VLAN IP。
- **学生/老师浏览器绝不直接命中 Gateway**，所有调用经 MeetMind `/api/academic/*` 代理。
- V0 起步一个机构一个 Gateway；未来多机构部署时：同一台机器跑多实例（不同端口、不同 workspace），或每机构一台容器。

## 版本与安装原则

- `openclaw` npm latest：`2026.4.22`
- `openclaw` Node 要求：`>=22.14.0`
- `@clawdbot/lobster` npm latest：`2026.4.6`（workflow runtime 可选）

V0 默认：

- 使用 `openclaw@2026.4.22` 稳定版初始化 Gateway。
- 不使用 beta，除非明确记录原因。
- OpenClaw 运行环境 Node >=22.14.0，**独立于 MeetMind 主应用 Node 版本**。
- **不** vendoring OpenClaw npm 包源码进仓库。
- 仓库内 `openclaw/` 目录只存**本项目 sidecar 配置、skills 源、workflows、personas、运维脚本**；运行时状态写入 gitignored `.state/` 或 `~/.openclaw/workspaces/<orgId>/`。

## 不恢复旧资产

仓库历史里 `academic-search`、`mock-interview`、`thesis-review`、`taoci`、`essay-review` 等旧 assets **不做机械恢复**。

原因：

- 旧 assets 基于早期申博项目假设，不代表 Education Service OS 方向。
- 旧 workflows 是分散工具，不以 Coaching Twin + InstitutionPlaybook 为中心。
- OpenClaw 生态已更新，应以官方文档为准。

允许：

- 只作为历史线索阅读，帮助理解已有想法。
- 重新按 Education Service OS 写新的 skills/workflows/personas。

禁止：

- 不 `git restore openclaw/` 当实施。
- 不把旧 `taoci.yaml`、`essay-review.yaml` 当 V0 主链路。
- 不把旧 skills 原样注册为生产能力。

## OpenClaw 负责的四类能力

### 1. 长记忆（只存机构级 + 运行期）

OpenClaw 维护 agentic memory：

- 机构 playbook（`MEMORY.md`）
- 历史案例摘要（脱敏，`MEMORY.md` 或独立 skill data）
- 老师辅导风格（跨学生可复用的提炼）
- 老师判断标准
- 当前 workflow 执行上下文（`memory/YYYY-MM-DD.md`）
- checkpoint 条件与触发历史

MeetMind 保存学生级 source of truth：

- 用户、机构、Workspace
- 原始视频、音频、文档、转录
- 学生画像、偏好、长期薄弱点
- CoachingSource、PracticeSession、CheckpointPack、GrowthAsset

**分界原则**：任何一个学生的可识别信息（姓名、联系方式、原始材料全文）都不进 OpenClaw memory；只有脱敏后的"老师是怎么教这类学生的"进。

### 2. 主动 agent

OpenClaw 负责主动推进：

- 新学生完成服务前诊断后，主动补齐上下文
- 老师视频处理完成后，主动生成 Coaching Twin
- 学生练习后，主动总结反馈和下一步
- 学生多次卡住时，主动生成补练任务
- deadline 临近时，主动建议节奏
- 风险超过 AI 边界时，主动生成老师 checkpoint

V0 触发方式：MeetMind 在事件发生时显式调用 `/tools/invoke`；未来可启用 OpenClaw 自带 cron/daemon 做真正主动触发。

### 3. 搜索

OpenClaw 优先承接端到端搜索和工具调用：

- 机构案例库搜索
- 机构 SOP / 话术 / 优秀样本搜索
- 学生材料与历史练习搜索（注：搜索时由 MeetMind 通过 `args` 传入匿名化快照，不在 OpenClaw 常驻）
- 外网学术与公开资料搜索
- 多步搜索后的综合判断

MeetMind 提供备用和上下文能力：

- `workspace-search-service`
- `web-search-service`：Bing / SerpAPI / DuckDuckGo / fallback
- LLM provider 内置 web search / extractor

### 4. 多步执行

OpenClaw 负责编排端到端任务：

```text
education.delivery.coaching-twin-build
  输入：老师视频 analysis（MeetMind 侧转录+视频理解结果）、学生上下文脱敏摘要、服务意图、机构 playbook
  -> 提炼老师辅导方式
  -> 检索相似案例和机构经验
  -> 搜索补全必要背景
  -> 生成 CoachingPersonaPack
  -> 生成 checkpoint 条件
  -> 回写 MeetMind

education.delivery.practice-session
  输入：学生问题、当前材料快照、CoachingTwin 记忆句柄
  -> 读取长期记忆
  -> 必要时搜索内部/外部资料
  -> 生成反馈
  -> 更新记忆
  -> 判断是否触发 checkpoint
```

## MeetMind ↔ OpenClaw 通信协议（V0 具体化）

### 信道

所有调用走 HTTP + `Bearer token`，两个接口：

#### A. `POST /tools/invoke`（主力，非流式）

用于 coaching-twin-build、memory 查询、检索等 request-response 场景。

```http
POST http://127.0.0.1:18789/tools/invoke
Authorization: Bearer <org-token>
Content-Type: application/json
x-openclaw-account-id: <orgId>

{
  "tool": "education.delivery.coaching-twin-build",
  "action": "run",
  "args": {
    "orgId": "org_abc",
    "studentAnonId": "stu_xyz_hash",
    "scenario": "phd-interview",
    "sourceAnalysis": { /* MeetMind 侧预处理的视频理解结果 */ },
    "studentContext": { /* 脱敏学生上下文 */ },
    "playbookRef": "playbook:shenbo.v1"
  },
  "sessionKey": "org_abc:stu_xyz_hash:phd-interview"
}
```

响应：

```json
{
  "ok": true,
  "result": {
    "personaPack": { /* CoachingPersonaPack 结构 */ },
    "checkpointConditions": [ /* ... */ ],
    "memoryRefs": [ /* 方便后续回写的记忆句柄 */ ]
  }
}
```

#### B. `POST /v1/chat/completions`（OpenAI 兼容，流式陪练用）

用于 PracticeSession 的文本对话模式（走 SSE 流）。语音同桌仍在 MeetMind 内部用 Qwen Omni realtime，**不走 OpenClaw**（延迟敏感）。

```http
POST http://127.0.0.1:18789/v1/chat/completions
Authorization: Bearer <org-token>
Content-Type: application/json
x-openclaw-session-key: org_abc:stu_xyz_hash:phd-interview

{
  "model": "openclaw/coaching-twin",
  "stream": true,
  "messages": [ ... ]
}
```

### 会话/租户隔离

- **sessionKey 格式**：`<orgId>:<studentAnonId>:<scenario>`
- Gateway 为每个 sessionKey 维护独立短期上下文；长期记忆按 orgId 聚合（机构级）
- **无论如何不把学生真实 ID 直接当 sessionKey**，使用 MeetMind 侧生成的 hash

### 回写（OpenClaw → MeetMind）

OpenClaw 不主动回调 MeetMind。V0 采用 **MeetMind 发起 - OpenClaw 返回** 的单向模式：

- MeetMind 调 tool → 拿到 result → 持久化到 Prisma
- 需要"主动推进"时，MeetMind 注册一个 cron/后台队列，定时调 OpenClaw 的 `proactive.tick` tool 询问"对于 orgId=X 有没有新的 NextAction / Checkpoint"

这避免了 Gateway 反向访问 MeetMind 带来的鉴权/防火墙复杂度。

### MeetMind 向 OpenClaw 暴露的"context 快照"契约

每次 tool 调用的 `args` 需包含以下字段之一或组合（不是 OpenClaw 主动来拉数据）：

- `context`：学生画像摘要、机构 playbook ref、服务目标、当前阶段
- `artifact`：视频 analysis、转录片段、论文/材料的 chunked 片段、历史反馈摘要
- `case`：学生服务 case 状态、任务、deadline、checkpoint 状态
- `memoryRefs`：上一次 tool 调用返回的记忆句柄，便于 OpenClaw 读回上下文

### MeetMind 消费的 OpenClaw 产物

- `CoachingPersonaPack`
- `PracticeFeedback`
- `CheckpointPack`
- `MemorySummary`（供前端展示"系统还记得什么"）
- `NextAction`
- `GrowthAsset`

### 接口原则

- OpenClaw **不**直接访问 Prisma。
- OpenClaw **不**直接 import MeetMind 代码。
- MeetMind **不**直接 import OpenClaw runtime；只通过 HTTP 调 Gateway。
- 双方通过 HTTP 合同解耦；合同变更走版本号，不做悄悄改字段。

## 仓库内 `openclaw/` 目录原则

如果在仓库内创建新的 `openclaw/` 目录，它应该是 **sidecar 源代码目录**（模板、骨架、运维脚本），不是运行时状态。

建议结构：

```text
openclaw/
  README.md
  DOMAIN.md
  scripts/
    init.sh           # 装依赖、创建 workspace、写 token
    start.sh          # 起 Gateway（pm2 / systemd）
    stop.sh
    status.sh
    provision-org.sh  # 为新机构创建 workspace
  skills/
    coaching-twin-build/SKILL.md
    coaching-practice/SKILL.md
    institution-playbook/SKILL.md
    academic-search/SKILL.md
  workflows/
    coaching-twin-build.md  # 如果改用 Lobster 声明式，则是 yaml
    practice-session.md
    checkpoint-pack.md
    proactive-tick.md
  personas/
    advisor-coach.md
    interview-panel.md
    thesis-reviewer.md
  playbooks/
    shenbo/           # V0 seed：申博
    baoyan/
    liuxue/
    lunwen/
    jingsai/
  .state/             # gitignored；或直接用 ~/.openclaw/workspaces/<orgId>/
```

**运行时 workspace** 放 `~/.openclaw/workspaces/<orgId>/`，由 `provision-org.sh` 从 `openclaw/skills/` + `openclaw/playbooks/<industry>/` 复制/symlink 而来。**升级策略**：改仓库源 → 跑 `provision-org.sh --reprovision` 同步到所有 workspace。

## 与 Lobster 的关系

`@clawdbot/lobster` 仍是 workflow runtime 参考和可选执行器，用于 deterministic workflow / approval / resume 场景。

V0 主策略是 OpenClaw 原生 skills + workflows；Lobster 在以下场景再引入：

- 需要长时运行（>10 分钟）+ 可恢复的 workflow
- 需要人工 approval 节点的 workflow
- 需要严格 deterministic 重放的场景

V0 这三个需求都还没出现，暂不引入，避免过度工程。

## 安全边界

- Gateway token 生成：`openssl rand -base64 48`，写入 MeetMind 环境变量 `OPENCLAW_GATEWAY_TOKEN`
- Gateway 只绑 loopback / 内网
- MeetMind `/api/academic/*` 路由必须鉴权后才转发
- 所有 `args` 在入 OpenClaw 前经过 `redact()`：去除 PII、缩短原文到段级片段
- 日志不打 token、不打原始学生材料全文

## 暂缓内容

- 不把完整 OpenClaw 作为 MeetMind npm dependency。
- 不把 OpenClaw Gateway 嵌入 Next.js API route 进程内。
- 不恢复旧 `openclaw/` 资产作为生产能力。
- 不在 V0 做完整插件市场。
- 不在 V0 做多 channel bot 产品化；如需使用 channel 能力，先服务 Education Service OS 的交付闭环。
- 不在 V0 做 OpenClaw 的多机构横向扩展自动化（V0 一个机构足够）。

## 参考来源

- OpenClaw homepage: https://openclaw.ai
- OpenClaw docs index: https://docs.openclaw.ai
- Gateway tools invoke: https://docs.openclaw.ai/gateway/tools-invoke-http-api.md
- Gateway OpenAI-compatible: https://docs.openclaw.ai/gateway/openai-http-api.md
- Memory concepts: https://docs.openclaw.ai/concepts/memory.md
- Creating skills: https://docs.openclaw.ai/tools/creating-skills.md
- OpenClaw npm: https://www.npmjs.com/package/openclaw
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- Lobster docs: https://docs.openclaw.ai/tools/lobster
- Lobster npm: https://www.npmjs.com/package/@clawdbot/lobster
- Qwen vision docs（视频理解主模型 qwen3.6-plus）: https://intl.aliyun.com/help/zh/model-studio/vision
