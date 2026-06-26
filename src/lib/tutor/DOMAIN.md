# lib/tutor — Tutor 纯业务辅助

> 不渲染 UI，供 `/api/tutor/agent`、hooks、components 复用。

## 文件索引

| 文件 | 职责 |
|------|------|
| `classroom-agent-request.ts` | 课堂同桌打 `/api/tutor/agent` 的瘦身请求体构建（只带 recentFocus，不上传整节 transcript） |
| `classroom-agent-request.test.ts` | 课堂同桌请求体单测 |
| `realtime-conversation-bridge.ts` | 语音同桌转写去重、标题生成等纯 helper |

## 已清理（M14.6+）

- `tutor-tools.ts` / `tutor-tools.test.ts` — 已删除。M14.6 起 `agent/route.ts` 纯对话 `tools = {}`，`createTutorTools` 不再被调用，属死代码。

## 依赖方向

`components/` / `hooks/` / `app/api` 可以 import 本目录；本目录不得 import UI 组件。
