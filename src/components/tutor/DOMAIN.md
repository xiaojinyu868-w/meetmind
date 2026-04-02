# Tutor — AITutor 拆分子模块

> 从 `AITutor.tsx`（1940 行）提取的类型、工具函数和小组件。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tutor-types.ts` | Tutor 共享类型定义 |
| `tutor-utils.ts` | Tutor 工具函数（纯函数） |
| `TutorWidgets.tsx` | Tutor 小组件集合 |
| `TutorCallComposer.tsx` | 语音同桌模式的语音通话入口卡 |
| `TutorRealtimeCallBar.tsx` | 手机端语音同桌模式的 realtime 语音通话条 |
| `TutorRealtimeCallScreen.tsx` | 手机端语音同桌的二级通话页舞台，负责接通、状态反馈与动作区 |

## 依赖方向

`AITutor.tsx` → `tutor/`（单向依赖，tutor/ 不反向 import AITutor）
