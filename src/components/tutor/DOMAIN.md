# Tutor — AITutor 拆分子模块

> 从 `AITutor.tsx`（1940 行）提取的类型、工具函数和小组件。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tutor-types.ts` | Tutor 共享类型定义 |
| `tutor-utils.ts` | Tutor 工具函数（纯函数） |
| `TutorWidgets.tsx` | Tutor 小组件集合 |
| `TutorAgentPanel.tsx` | M10 复习态 AI 同桌面板（AI SDK v6，支持 open_app marker → 内联应用卡片） |
| `TutorCallComposer.tsx` | 语音同桌模式下「文字代语音」的发送入口卡（仅作为降级/兼容，realtime 模式默认走舞台） |
| `TutorRealtimeCallBar.tsx` | 手机端语音同桌模式的 realtime 语音通话条（对话中途使用） |
| `TutorRealtimeCallScreen.tsx` | 语音同桌的通话舞台（PC 与手机共用），负责接通、状态反馈、动作区；接通 `useOmniRealtimeCall` 做实时语音 |

## 依赖方向

`AITutor.tsx` → `tutor/`（单向依赖，tutor/ 不反向 import AITutor）
