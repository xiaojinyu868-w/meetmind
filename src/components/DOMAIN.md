# Components — UI 组件层

> 所有用户可见的 UI 都在这里。纯展示 + 交互逻辑，不含业务逻辑。

## 依赖规则

```
components → hooks + stores + types + lib/utils
```

- ✅ 组件可以调用 `hooks/`, `stores/`, `types/`, `lib/utils/`
- ✅ 组件可以 import 其他组件
- ❌ 组件不能 import `lib/services/`（服务层是服务端）
- ❌ 组件不能 import `app/api/`

## 目录结构

```
components/
├── *.tsx              # 顶层核心组件（~45 个）
├── tutor/             # AITutor 拆分子模块（类型/工具函数/小组件）
├── recorder/          # Recorder 拆分子模块（类型/工具函数）
├── apps/              # 应用系统（矩阵/浮窗/插件执行）
│   ├── windows/       # 浮窗组件
│   ├── evidence/      # 证据标签
│   └── hooks/         # 应用执行 hook
├── mobile/            # 移动端专用组件（13 个）
├── parent/            # 家长端（5 个）
├── teacher/           # 教师端（3 个）
├── business/          # 业务展示组件（5 个）
├── layout/            # 布局组件（2 个）
├── ui/                # shadcn/ui 基础组件（25 个）
└── ConversationHistory/ # 对话历史（3 个）
```

## 核心组件

### 录音 / 转录

| 文件 | 行数 | 职责 |
|------|------|------|
| `Recorder.tsx` | 1694 | 录音主组件（采集/实时转录/暂停/恢复），子模块在 `recorder/` |
| `TranscriptFlowView.tsx` | 778 | 转录内容流式视图 |
| `WaveformPlayer.tsx` | 638 | 波形音频播放器 |
| `VoiceMicButton.tsx` | ~200 | 语音麦克风按钮 |

### AI 交互

| 文件 | 行数 | 职责 |
|------|------|------|
| `AITutor.tsx` | 1940 | AI 家教（解释/追问/引导/联网/思维可视化），子模块在 `tutor/` |
| `AIChat.tsx` | 691 | AI 对话组件 |
| `AISearchPanel.tsx` | 720 | AI 全局搜索面板 |
| `WordExplainer.tsx` | 562 | 术语解释器 |
| `StreamingMarkdown.tsx` | ~300 | 流式 Markdown 渲染 |
| `ThinkingVisualizer.tsx` | ~300 | AI 思维过程可视化 |
| `ThinkingGuideRenderer.tsx` | ~260 | 思维引导渲染 |
| `GuidanceQuestion.tsx` | ~180 | 引导问题 |
| `IntentBubbleExplorer.tsx` | ~80 | 意图气泡探索器 |

### Echo 回声

| 文件 | 行数 | 职责 |
|------|------|------|
| `EchoCard.tsx` | ~180 | 回声卡片（设计系统原住民：无渐变/无阴影） |
| `EchoShareCard.tsx` | ~300 | 分享图（纯 Canvas 绘制，微信兼容） |

### 内容管理

| 文件 | 行数 | 职责 |
|------|------|------|
| `WorkspaceCaptureList.tsx` | ~900 | 工作空间 capture 列表 |
| `VideoReviewPlayer.tsx` | 529 | 视频复习播放器 |
| `HighlightsPanel.tsx` | ~400 | 精选片段面板 |
| `NotesPanel.tsx` | ~370 | 笔记面板 |
| `SummaryPanel.tsx` | ~280 | 摘要面板 |
| `ImageUpload.tsx` | ~220 | 图片上传 |
| `Citations.tsx` | ~140 | 引用标签 |
| `CitationReferenceSheet.tsx` | ~260 | 引用参考弹窗 |

### 导航 / 布局

| 文件 | 行数 | 职责 |
|------|------|------|
| `Header.tsx` | ~280 | 顶部导航栏 |
| `ModelSelector.tsx` | ~260 | AI 模型选择器 |
| `WechatBindForm.tsx` | ~280 | 微信绑定表单 |
| `AgreementModal.tsx` | ~600 | 用户协议弹窗 |

### apps/ — 应用系统

| 文件 | 行数 | 职责 |
|------|------|------|
| `AppMatrixPanel.tsx` | 1579 | 应用矩阵主面板 |
| `WorkshopYellowPage.tsx` | 900 | Workshop 黄页导航 |
| `windows/WorkshopWindowManager.tsx` | ~580 | 浮窗管理器 |
| `windows/InfographicWindow.tsx` | ~1100 | 信息图浮窗 |
| `windows/MindmapWindow.tsx` | ~950 | 思维导图浮窗 |
| `windows/QuizWindow.tsx` | ~720 | 测验浮窗 |
| `windows/FlashcardsWindow.tsx` | ~470 | 闪卡浮窗 |
| `windows/PodcastWindow.tsx` | ~470 | 播客浮窗 |
| `hooks/useAppExecution.ts` | ~370 | 应用执行 hook |

## ⚠️ 超标文件（>500 行）

- `AITutor.tsx` (1940) — 最大组件，子模块已拆到 `tutor/`
- `Recorder.tsx` (1694) — 录音逻辑 + UI 混合，子模块已拆到 `recorder/`
- `AppMatrixPanel.tsx` (1579) — 应用矩阵
- `WorkshopYellowPage.tsx` (900) — 黄页
- `TranscriptFlowView.tsx` (778) — 转录流
- `AISearchPanel.tsx` (720) — 搜索面板
- `AIChat.tsx` (691) — 对话
- `WaveformPlayer.tsx` (638) — 波形播放器
- `WordExplainer.tsx` (562) — 术语解释
- `VideoReviewPlayer.tsx` (529) — 视频复习

## 设计系统约束

改动任何组件必须遵守：

- **零渐变、零阴影、纯平涂**
- 只用系统 token：`canvas(#F7F7F5)`, `card(#fff)`, `ink(#232322)`, `ink-secondary(#787774)`, `ink-muted(#A3A39E)`, `divider(#E9E9E7)`
- 禁止：`bg-gradient-*`, `shadow-*`, `ring-*` 装饰
