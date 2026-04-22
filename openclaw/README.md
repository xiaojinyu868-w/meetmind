# OpenClaw — MeetMind AI Agent Gateway

> 与 MeetMind 完全解耦，所有文件在此目录内。
> MeetMind 代码零修改。

## 架构

```
openclaw/
├── .state/              ← OPENCLAW_STATE_DIR（gitignored，运行时产生）
│   ├── openclaw.json    ← Gateway 配置（onboard 后生成）
│   ├── .env             ← API Keys（敏感，不入库）
│   ├── workspace/       ← SOUL.md 等 persona 配置
│   ├── sessions/        ← 用户会话数据
│   └── skills/          ← 运行时 Skill 缓存
├── skills/              ← 自定义 Skills（git tracked）
├── workflows/           ← Lobster YAML 工作流
├── personas/            ← 导师 persona 定义
├── mcp/                 ← MCP Server 配置
└── scripts/             ← 启动/停止/状态脚本
```

## 快速开始

```bash
# 1. 初始化（首次）
cd /mnt/meetmind-capture-v1-server-handoff/openclaw
bash scripts/init.sh

# 2. 启动 Gateway
bash scripts/start.sh

# 3. 查看状态
bash scripts/status.sh

# 4. 停止
bash scripts/stop.sh
```

## 环境变量

| 变量 | 说明 | 在哪里设 |
|------|------|----------|
| `OPENCLAW_HOME` | OpenClaw 安装目录（全局） | scripts/ 自动设置 |
| `OPENCLAW_STATE_DIR` | 状态目录（本项目的 .state/） | scripts/ 自动设置 |

## 多租户模型

- 1 个 OpenClaw Profile = 1 个导师 persona = 无限学生
- `skills/` 共享（导师经验积累）
- `sessions/` 按用户隔离
- `user_contexts/` 按用户隔离（学习者画像）

## 与 MeetMind 的集成

通过 MCP 协议：
- OpenClaw 作为 MCP Client 调用 MeetMind 的 API
- MeetMind 暴露 `POST /api/agent/task` 和 `GET /api/agent/context` 两个端点
- 所有通信走 HTTP，零代码耦合
