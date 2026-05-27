# Tutor — AITutor 拆分子模块

> 从 `AITutor.tsx`（1940 行）提取的类型、工具函数和小组件。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tutor-types.ts` | Tutor 共享类型定义 |
| `tutor-utils.ts` | Tutor 工具函数（纯函数） |
| `TutorWidgets.tsx` | Tutor 小组件集合 |
| `TutorAgentPanel.tsx` | M10 复习态 AI 同桌面板（AI SDK v6；复习态 open_app marker 优先交给中间学习工作区打开，只有无父级回调时才回退内联应用卡片；历史恢复时必须先查共享应用缓存，避免重复生成） |
| `tutor-inline-app-cache.ts` | 复习对话内联应用缓存桥接：读取 / 写入应用矩阵同一份 `app_workspace_result:*` 缓存，并用 running 状态避免同一 app 重复并发执行 |
| `tutor-agent-history.ts` | TutorAgentPanel 历史消息转换与状态文案 helper |
| `tutor-agent-adapter.ts` | SafeAITutor / TutorAgentPanel 的 context / launchQuestion / learnerProfile / recent learning activity 纯适配 helper；个人画像、近期对话和应用交互动态只作为模型上下文，不做硬规则 |
| `realtime-conversation-bridge.ts` | 兼容 re-export；实际 helper 在 `src/lib/tutor/realtime-conversation-bridge.ts` |
| `realtime-tutor-panel-model.ts` | RealtimeTutorPanel 的上下文标签、近场语音 prompt、禁用状态纯 helper |
| `RealtimeTutorPanel.tsx` | 独立语音同桌面板：承接 `TutorRealtimeCallScreen`，把转写写入 `global-chat` 并回传 conversationId 给文字 agent |
| `TutorCallComposer.tsx` | 语音同桌模式下「文字代语音」的发送入口卡（仅作为降级/兼容，realtime 模式默认走舞台） |
| `TutorRealtimeCallBar.tsx` | 手机端语音同桌模式的 realtime 语音通话条（对话中途使用） |
| `TutorRealtimeCallScreen.tsx` | 语音同桌的通话舞台（PC 与手机共用），负责接通、状态反馈、动作区；接通 `useOmniRealtimeCall` 做实时语音 |

## 依赖方向

`AITutor.tsx` → `tutor/`（单向依赖，tutor/ 不反向 import AITutor）

## 视觉约定

- `TutorAgentPanel.tsx` 是复习态文字对话的新视觉基准：正文 14px+、1.7+ 行高，assistant 消息必须走 `StreamingMarkdown`，不能用 `whitespace-pre-wrap` 直接吐 raw markdown；工具按钮保留但弱化为辅助信息。
- legacy `AITutor.tsx` 只做 fallback，不再作为新排版基准。
