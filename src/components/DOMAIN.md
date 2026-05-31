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
├── tutor/DOMAIN.md    # AITutor 拆分子模块（类型/工具函数/小组件）
├── recorder/DOMAIN.md # Recorder 拆分子模块（类型/工具函数）
├── apps/DOMAIN.md     # 应用系统（黄页/浮窗/证据标签/执行 hook）
│   ├── windows/       # 浮窗组件 + 布局引擎
│   ├── evidence/      # 证据标签
│   └── hooks/         # 应用执行 hook
├── mobile/DOMAIN.md   # 移动端专用组件（18 个）
├── business/DOMAIN.md # 业务展示组件（6 个）
├── layout/DOMAIN.md   # 布局组件（3 个）
├── ui/                # shadcn/ui 基础组件（25 个）
└── ConversationHistory/DOMAIN.md # 对话历史（3 个）
```

## 核心组件

### 录音 / 转录

| 文件 | 行数 | 职责 |
|------|------|------|
| `Recorder.tsx` | 1694 | 录音主组件（采集/实时转录/暂停/恢复；实时 final 进入 `recorder-utils.mergeRealtimeTranscriptSegment` 去重/修时间戳），子模块在 `recorder/` |
| `TranscriptFlowView.tsx` | 778 | 转录内容流式视图 |
| `WaveformPlayer.tsx` | 638 | 波形音频播放器 |
| `VoiceMicButton.tsx` | ~200 | 语音麦克风按钮 |

### AI 交互

| 文件 | 行数 | 职责 |
|------|------|------|
| `AITutor.tsx` | 1940 | 旧 AI 家教 / legacy fallback（移动端文字和语音主链路已移出），子模块在 `tutor/` |
| `AIChat.tsx` | 691 | AI 对话组件 |
| `AISearchPanel.tsx` | ~740 | AI 全局搜索面板；桌面端以右侧上下文 sidecar 呈现，移动端全屏 |
| `WordExplainer.tsx` | 562 | 术语解释器 |
| `StreamingMarkdown.tsx` | 391 | 统一流式 Markdown 渲染（GFM 表格 / 数学公式 / [MM:SS] 与 [t=MM:SS] 时间戳 / [资料N]） |
| `ThinkingVisualizer.tsx` | ~300 | AI 思维过程可视化 |
| `ThinkingGuideRenderer.tsx` | ~260 | 思维引导渲染 |
| `GuidanceQuestion.tsx` | ~180 | 引导问题 |
| `IntentBubbleExplorer.tsx` | ~80 | 意图气泡探索器 |

### Echo 回声

| 文件 | 行数 | 职责 |
|------|------|------|
| `EchoCard.tsx` | ~180 | 回声卡片（设计系统原住民：无渐变/无阴影） |
| `EchoShareCard.tsx` | ~300 | 分享图（纯 Canvas 绘制，微信兼容；提供保存图片 / 系统分享 / 复制文案） |
| `echo-share-actions.ts` | ~60 | 分享图外传 helper（分享文案、文件名、data URL → File） |

### 内容管理

| 文件 | 行数 | 职责 |
|------|------|------|
| `WorkspaceCaptureList.tsx` | ~900 | 工作空间 capture 列表 |
| `DesktopVideoReviewLayout.tsx` | ~647 | 桌面端课后复习三栏布局：左=视频/音频证据 + 时间轴，中=转录/困惑点/学习工作区，右=同桌；接入可拖拽三栏，视频默认放大左证据栏，并持有课后学习黑板 |
| `ReviewThreePaneLayout.tsx` | ~156 | 课后复习可拖拽三栏容器：两条边界都可拖拽；学习区 / 同桌被挤到阈值后折叠成窄 rail；左证据栏不自动折叠 |
| `ReviewLearningWorkspace.tsx` | ~119 | 课后中间学习工作区：用 `AppRenderSurface` 承载闪卡 / 测验 / 思维导图等完整应用；闪卡切低亮度练习背景，并把测验/闪卡动态写入课后学习黑板 |
| `review-learning-blackboard.ts` | ~131 | 课后学习黑板：轻结构自然语言便签；只记录当前中间应用和最近学习现场事实，不写“应该/提醒/建议”等模型指令，中间应用和右侧同桌通过它解耦 |
| `WorkspaceCaptureEditorModal.tsx` | ~105 | 工作空间 capture 编辑弹窗，从 page.tsx 提取 |
| `VideoReviewPlayer.tsx` | 823 | 视频复习播放器（pauseNonce/playNonce/seekNonce 命令式控制，点击画面暂停/播放+指示器动画，visibilitychange 倍速恢复，空格/箭头键盘快捷键，B站 Dash 双轨同步，B站封面代理） |
| `ClassCheckOverlay.tsx` | 430 | 随堂检验弹窗（greeting → quiz → result 三阶段，Backdrop 已提取为独立组件避免闪烁） |
| `ClassroomView.model.ts` | ~10 | 课堂页纯交互模型（demo 录课态停止按钮应退出 demo，不走真实录音/stale DB 清理） |
| `SharedWorkspacePanel.tsx` | ~78 | shared workspace 统一面板（仅 apps）；支持在中间工作区打开具体应用而不是只弹浮窗 |
| `ReviewWorkspacePanel.tsx` | 127 | desktop review 左侧证据面板（timeline / anchor detail） |
| `ReviewTutorPanel.tsx` | ~268 | desktop review 右侧 Tutor 面板（历史对话、SafeAITutor / TutorAgentPanel 统一容器；音频波形已上移到左证据栏） |
| `CollectionSelectionBar.tsx` | 94 | 收集上下文多选操作条（问 Tutor / 引用 / 批量归档删除） |
| `CollectionComposerContextPreview.tsx` | 62 | composer 上方的引用与链接预览条 |
| `CollectionComposerBar.tsx` | 168 | collection composer 输入区容器（预览 / textarea / 发送 / 听写 / 上传） |
| `CollectionMessageActionSheet.tsx` | ~283 | 收集消息操作底部菜单（复习/编辑/打开原件/归档/删除），从 page.tsx 提取 |
| `mobile/MobileCollectionSheet.tsx` | ~430 | 收集菜单 / 历史收集 / 笔记总结面板；移动端底部或侧边 sheet，桌面端历史与笔记总结以右侧上下文抽屉呈现 |
| `CollectionFeedMessageBubble.tsx` | ~340 | 收集 Feed 单条消息气泡（audio/video/image/document/text 五种类型），从 page.tsx 提取 |
| `CollectionEmptyState.tsx` | ~82 | 收集为空时引导页（录音/图片/讲义快捷入口），从 page.tsx 提取 |
| `ImageUpload.tsx` | ~220 | 图片上传 |
| `Citations.tsx` | ~140 | 引用标签 |
| `CitationReferenceSheet.tsx` | ~260 | 引用参考弹窗 |

### 导航 / 布局

| 文件 | 行数 | 职责 |
|------|------|------|
| `Header.tsx` | ~280 | 顶部导航栏 |
| `DesktopSidebar.tsx` | ~350 | 桌面侧栏（默认 168px，折叠 52px；录课专注态强制 52px，主学习区优先） |
| `ModelSelector.tsx` | ~260 | AI 模型选择器 |
| `WechatBindForm.tsx` | ~280 | 微信绑定表单 |
| `AgreementModal.tsx` | ~600 | 用户协议弹窗 |

### apps/ — 应用系统

| 文件 | 行数 | 职责 |
|------|------|------|
| `WorkshopYellowPage.tsx` | 897 | Workshop 黄页导航 |
| `windows/WorkshopWindowManager.tsx` | ~580 | 浮窗管理器 |
| `windows/InfographicWindow.tsx` | ~700 | 信息图浮窗，类型/常量/工具已拆到 `infographic-window-data.ts` |
| `windows/infographic-window-data.ts` | 305 | 信息图类型/场景预设/风格预设/纯工具函数 |
| `windows/MindmapWindow.tsx` | ~691 | 思维导图浮窗，布局引擎已拆到 `mindmap-layout.ts` |
| `windows/mindmap-layout.ts` | 168 | 思维导图布局引擎（纯函数，有测试） |
| `windows/QuizWindow.tsx` | ~720 | 测验浮窗 |
| `windows/FlashcardsWindow.tsx` | ~470 | 闪卡浮窗 |
| `windows/PodcastWindow.tsx` | ~470 | 播客浮窗 |
| `windows/StudyReportWindow.tsx` | ~270 | 听课报告浮窗（家长视角） |
| `hooks/useAppExecution.ts` | ~370 | 应用执行 hook |

## ⚠️ 超标文件（>500 行）

- `AITutor.tsx` (1940) — 最大组件，子模块已拆到 `tutor/`
- `Recorder.tsx` (1694) — 录音逻辑 + UI 混合，子模块已拆到 `recorder/`
- `WorkshopYellowPage.tsx` (900) — 黄页
- `TranscriptFlowView.tsx` (778) — 转录流
- `AISearchPanel.tsx` (720) — 搜索面板
- `VideoReviewPlayer.tsx` (823) — 视频复习（点击画面控制 + visibilitychange 倍速恢复 + 键盘快捷键）
- `AIChat.tsx` (691) — 对话
- `WaveformPlayer.tsx` (638) — 波形播放器
- `WordExplainer.tsx` (562) — 术语解释
- `DesktopVideoReviewLayout.tsx` (537) — 桌面端复习布局
- `desktop-video-review-layout-model.ts` — 桌面视频复习布局纯 helper（播放时间 ms → agent 秒级 context）

## 设计系统约束

改动任何组件必须遵守：

- **v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）**
- 只用系统 token：`canvas(#FAF7F2)`, `card(#fff)`, `ink(#1C1B19)`, `ink-secondary(#5C5A55)`, `ink-muted(#8E8B82)`, `divider(#E8E2D5)`
- 禁止：`bg-gradient-*`, `shadow-*`, `ring-*` 装饰
