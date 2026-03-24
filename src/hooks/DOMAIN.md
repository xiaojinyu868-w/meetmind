# Hooks — 客户端状态与交互逻辑

> 封装可复用的客户端逻辑。被 components 和 page.tsx 调用。

## 依赖规则

```
hooks → stores + types + lib/db + lib/utils
```

- ✅ hooks 可以调用 `stores/`, `types/`, `lib/db/`, `lib/utils/`
- ✅ hooks 可以调用其他 hooks
- ❌ hooks 不能 import `components/`（hooks 被组件调用，不能反向）
- ❌ hooks 不能 import `lib/services/`（服务端）

## 文件索引

### 顶层 hooks

| 文件 | 行数 | 职责 |
|------|------|------|
| `useAnalytics.ts` | 349 | 用户行为分析上报（会话/页面/事件追踪） |
| `useAnchors.ts` | 130 | 困惑锚点 CRUD（IndexedDB） |
| `useAudio.ts` | 104 | 音频播放控制（play/pause/seek） |
| `useAudioSessions.ts` | 127 | IndexedDB 会话/锚点/转录查询 |
| `useConversationHistory.ts` | 385 | 对话历史管理（CRUD + 分页 + 消息级操作） |
| `useDragGesture.ts` | 143 | 拖拽手势（用于浮窗拖动） |
| `useNetworkStatus.ts` | 26 | 网络在线状态监听 |
| `useOnboarding.ts` | 545 | 新手引导流程定义 + 状态机 |
| `useRecording.ts` | 70 | 录音控制（start/stop/pause） |
| `useResizable.ts` | 145 | 面板大小调整（拖拽调整宽度） |
| `useResponsive.ts` | 113 | 响应式断点检测（mobile/tablet/desktop） |
| `useTextSelection.ts` | 97 | 文本选择检测（用于划词解释） |
| `useTranscript.ts` | 134 | 转录数据管理 |
| `useVoiceInput.ts` | 270 | 语音输入（含 buffered 模式判断） |
| `useWorkshopWindows.ts` | 122 | Workshop 浮窗状态管理 |

### data/ — API 数据 hooks

| 文件 | 行数 | 职责 |
|------|------|------|
| `useSession.ts` | 140 | 会话 CRUD（IndexedDB） |
| `useSummary.ts` | 155 | 课堂摘要生成（调用 API） |
| `useTopics.ts` | 129 | 精选片段生成（调用 API） |
| `useTranscript.ts` | 121 | 转录数据请求（调用 API） |
| `useTutor.ts` | 164 | AI 家教交互（调用 API） |

## ⚠️ 超标文件

- `useOnboarding.ts` (545) — 引导流程定义占据大部分行数
