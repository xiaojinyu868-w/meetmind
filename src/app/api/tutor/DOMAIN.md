# API: Tutor — AI 私教路由

> AI 家教的后端路由，处理对话、引导、引用。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | ~708 | 主路由：接收用户消息、调用 LLM、支持“初次困惑点分析 / 后续追问 / 全局对话”三种模式，其中后两者和初次分析现在都可流式返回 |
| `tutor-types.ts` | — | 共享类型定义 |
| `tutor-prompts.ts` | — | System Prompt 模板 |
| `tutor-citations.ts` | — | 引用处理（从转录中定位引用） |
| `tutor-guidance.ts` | — | 引导问题生成 |

## 子路由

| 路径 | 职责 |
|------|------|
| `/api/tutor/agent` | Agent loop（多轮 tool calling，用于应用生成与 plugin 调用） |

## 依赖

- `lib/services/llm-service` — LLM 调用
- `lib/services/conversation-service` — 对话持久化
- `lib/services/auth-service` — 认证

## 最近约定

- 困惑点初次分析不再默认自动触发，由前端点击后再请求
- `/api/tutor` 的 SSE 现在同时覆盖：
  - 初次困惑点分析
  - 困惑点后续追问
  - 整节课全局对话
- 初次困惑点分析在 SSE 结束时会额外回传 `parsed_response` 元数据，前端据此恢复结构化区块
