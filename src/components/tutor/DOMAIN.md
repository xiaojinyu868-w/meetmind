# Tutor — AITutor 拆分子模块

> 从 `AITutor.tsx`（1940 行）提取的类型、工具函数和小组件。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tutor-types.ts` | Tutor 共享类型定义 |
| `tutor-utils.ts` | Tutor 工具函数（纯函数） |
| `TutorWidgets.tsx` | Tutor 小组件集合 |
| `TutorAgentPanel.tsx` | M10 复习态 AI 同桌面板（AI SDK v6；结构化应用只交给中间学习工作区，右栏空态仅保留“讲主线 / 从标记开始”两个对话动作，不再复制应用矩阵；管理员顶栏轻入口可将本次真实 review / in-class 上下文带到 AI 控制中心） |
| `tutor-inline-app-cache.ts` | 复习对话内联应用缓存桥接：读取 / 写入应用矩阵同一份 `app_workspace_result:*` 缓存，并用 running 状态避免同一 app 重复并发执行 |
| `tutor-agent-history.ts` | TutorAgentPanel 历史消息转换与状态文案 helper |
| `tutor-agent-adapter.ts` | SafeAITutor / TutorAgentPanel 的 context / launchQuestion / learnerProfile / recent learning activity 纯适配 helper；个人画像、近期对话和应用交互动态只作为模型上下文，不做硬规则 |
| `realtime-conversation-bridge.ts` | 兼容 re-export；实际 helper 在 `src/lib/tutor/realtime-conversation-bridge.ts` |
| `realtime-tutor-panel-model.ts` | RealtimeTutorPanel 的上下文标签、近场语音 prompt、禁用状态纯 helper（随语音通话下线，仅 deprecated 组件引用） |
| `RealtimeTutorPanel.tsx` | **@deprecated 2026-08**：独立语音同桌面板（语音通话已下线，入口已移除，保留一个周期后物理删除） |
| `TutorCallComposer.tsx` | **@deprecated 2026-08**：语音同桌模式下「文字代语音」的发送入口卡 |
| `TutorRealtimeCallBar.tsx` | **@deprecated 2026-08**：手机端语音同桌模式的 realtime 语音通话条 |
| `TutorRealtimeCallScreen.tsx` | **@deprecated 2026-08**：语音同桌的通话舞台（/api/tutor-call 已拆除） |

## 依赖方向

`AITutor.tsx` → `tutor/`（单向依赖，tutor/ 不反向 import AITutor）

## 视觉约定

- `TutorAgentPanel.tsx` 是复习态文字对话的新视觉基准：正文 14px+、1.7+ 行高，assistant 消息必须走 `StreamingMarkdown`，不能用 `whitespace-pre-wrap` 直接吐 raw markdown；工具按钮保留但弱化为辅助信息。
- legacy `AITutor.tsx` 只做 fallback，不再作为新排版基准。
