# Lib Hooks — 基础设施 hooks

> 不依赖业务逻辑的通用 hooks（认证、SSE 流、课堂数据）。

## 文件索引

| 文件 | 职责 |
|------|------|
| `useAuth.tsx` | 认证 Provider + hook（JWT + 刷新） |
| `useSSEStream.ts` | 通用 SSE 流式请求 hook |
| `useClassroomData.ts` | 课堂数据加载 hook |

## 注意

- `useAuth.tsx` 是 Provider 组件 + hook 的混合文件
- `useSSEStream.ts` 被 AI 交互和应用执行多处使用
