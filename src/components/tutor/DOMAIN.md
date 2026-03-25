# Tutor — AITutor 拆分子模块

> 从 `AITutor.tsx`（1940 行）提取的类型、工具函数和小组件。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tutor-types.ts` | Tutor 共享类型定义 |
| `tutor-utils.ts` | Tutor 工具函数（纯函数） |
| `TutorWidgets.tsx` | Tutor 小组件集合 |

## 依赖方向

`AITutor.tsx` → `tutor/`（单向依赖，tutor/ 不反向 import AITutor）
