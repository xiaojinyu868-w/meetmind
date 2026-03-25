# Recorder — 录音组件拆分子模块

> 从 `Recorder.tsx`（1694 行）提取的类型和工具函数。

## 文件索引

| 文件 | 职责 |
|------|------|
| `recorder-types.ts` | 录音器配置/状态类型（含 process.env 默认值读取） |
| `recorder-utils.ts` | 录音器工具函数（纯函数） |

## 依赖方向

`Recorder.tsx` → `recorder/`（单向依赖）
