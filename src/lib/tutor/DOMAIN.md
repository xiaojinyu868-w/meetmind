# lib/tutor — Tutor 纯业务辅助

> 不渲染 UI，供 `/api/tutor/agent`、hooks、components 复用。

## 文件索引

| 文件 | 职责 |
|------|------|
| `classroom-agent-request.ts` | 课堂同桌打 `/api/tutor/agent` 的瘦身请求体构建（只带 recentFocus，不上传整节 transcript） |
| `classroom-agent-request.test.ts` | 课堂同桌请求体单测 |
| `tutor-tools.ts` | Tutor Agent 的工具函数（review mode 暴露；in-class 返回空工具集，课中轻产物走 open_app marker） |
| `tutor-tools.test.ts` | Tutor tools 单测 |
| `realtime-conversation-bridge.ts` | 语音同桌转写去重、标题生成等纯 helper |

## 依赖方向

`components/` / `hooks/` / `app/api` 可以 import 本目录；本目录不得 import UI 组件。
