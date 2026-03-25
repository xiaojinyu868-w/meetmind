# API: Tutor — AI 私教路由

> AI 家教的后端路由，处理对话、引导、引用。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | ~708 | 主路由：接收用户消息、调用 LLM、流式返回 |
| `tutor-types.ts` | — | 共享类型定义 |
| `tutor-prompts.ts` | — | System Prompt 模板 |
| `tutor-citations.ts` | — | 引用处理（从转录中定位引用） |
| `tutor-guidance.ts` | — | 引导问题生成 |

## 子路由

| 路径 | 职责 |
|------|------|
| `/api/tutor/intent-probe` | 意图探测（判断用户真正想问什么） |

## 依赖

- `lib/services/llm-service` — LLM 调用
- `lib/services/conversation-service` — 对话持久化
- `lib/services/auth-service` — 认证
