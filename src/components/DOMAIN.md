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
├── chat/DOMAIN.md     # M11：全局对话底座（ChatBubble/Composer/MessageList/Renderer + 3 hooks + 2 markers）
│                      # 任何新对话面板必须基于此底座做 adapter，禁止重新写输入条/气泡
├── tutor/DOMAIN.md    # AITutor 拆分子模块（TutorAgentPanel 已迁底座）
├── recorder/DOMAIN.md # Recorder 拆分子模块（类型/工具函数）
├── apps/DOMAIN.md     # 应用系统（黄页/浮窗/证据标签/执行 hook）
│   ├── windows/       # 浮窗组件 + 布局引擎
│   ├── evidence/      # 证据标签
│   └── hooks/         # 应用执行 hook
├── intent/DOMAIN.md   # M11：「聊聊你想要的」对话式目标共建（IntentDialog 沉浸式 + Container + SummaryCard）
├── realtime/DOMAIN.md # M11：实时语音通话视觉模板（RealtimeOrb 呼吸光晕 + IntentVoiceCallScreen）
├── admin/DOMAIN.md    # 管理员会话级管理视图、现场 AI 透镜与独立控制中心
├── mobile/DOMAIN.md   # 移动端专用组件（18 个）
├── business/DOMAIN.md # 业务展示组件（6 个）
├── layout/DOMAIN.md   # 布局组件（3 个）
├── ui/                # shadcn/ui 基础组件（25 个）
└── ConversationHistory/DOMAIN.md # 对话历史（3 个）
```

## 核心组件

### 官网 / 品牌入口

| 文件 | 职责 |
|------|------|
| `LandingPage.tsx` / `LandingPage.module.css` | 保留的真实产品影像版首页组件，当前不作为消费级主域默认交付。主域 `/` 暂时由 middleware 内部交付 `public/landing-concept-v1.html` 的无产品截图品牌叙事版本；待收集线与课堂线素材重新录制、成熟宣传片在 ChatCut 完成并验收后，再评估把真实影像版接回。不得使用截图轮播、`zoompan`、伪 UI、抖动或无意义缩放制造镜头 |
| `TechnologyPage.tsx` / `TechnologyPage.module.css` | 面向投资人、研究者和合作伙伴的独立技术介绍，承载上下文架构、ASR、评测与技术问答，并保留回到消费端产品的路径 |

### 录音 / 转录

| 文件 | 行数 | 职责 |
|------|------|------|
| `Recorder.tsx` | 1694 | 录音主组件（采集/实时转录/暂停/恢复；实时 final 进入 `recorder-utils.mergeRealtimeTranscriptSegment` 去重/修时间戳）；首屏静态挂载以保留首次录音的用户手势与冷启动 ASR，子模块在 `recorder/` |
| `TranscriptFlowView.tsx` | 778 | 转录内容流式视图 |
| `LessonDigestCard.tsx` | ~220 | 课堂结构化笔记纯展示组件（飞书妙记式分段总结 + 图片内联 + 时间戳跳转 + 原文折叠 + 长按标记困惑；桌面移动共用）；标题不再叠加“课堂总结”等重复说明，降级路径不向用户暴露 LLM 等内部术语 |
| `WaveformPlayer.tsx` | 638 | 波形音频播放器 |
| `VoiceMicButton.tsx` | ~200 | 语音麦克风按钮 |

### AI 交互

| 文件 | 行数 | 职责 |
|------|------|------|
| `AITutor.tsx` | 1940 | 旧 AI 家教 / legacy fallback（移动端文字和语音主链路已移出），子模块在 `tutor/` |
| `AIChat.tsx` | 691 | AI 对话组件 |
| `GlobalAskPanel.tsx` / `GlobalAskWelcome.tsx` / `GlobalAskContextDrawer.tsx` | ~650 | 全局 Ask MeetMind：基于 ChatBase 的多轮问答；空态把输入作为唯一主动作，在输入内轻量选择“直接回答 / 陪我学会”；参考范围按需从右侧打开，深度学习仅在答案会改变路线时逐题追问；管理员额外看到“查看本次 AI”轻入口，将当前真实上下文带到独立控制中心，普通用户完全不可见 |
| `LearningIntentConfirmationCard.tsx` / `learning-intent-confirmation-model.ts` | ~210 | 深度学习的轻确认：若学习路径确有歧义，逐步显现模型动态生成的 1-3 个选择问题；学习理解在回答结束后静默整理，不把内部记忆标记塞进消息流 |
| `LearningProgressMemoryCard.tsx` | ~50 | 旧学习进展 marker 的反馈卡，当前 `GlobalAskPanel` 不再使用；保留仅供迁移期兼容，勿在新链路继续扩展 |
| `LearningMemoryPanel.tsx` / `CourseContextSection.tsx` / `CourseAssessmentCard.tsx` / `CourseCheatsheetWorkspace.tsx` / `ContextRecoveryCard.tsx` | ~1100 | 「我的上下文」采用消费级总览→具体内容层级：总览只展开模型对用户的长期理解，并以两条安静入口进入“课程与考试”或“最近学习现场”，不再把三类内容一次性纵向铺满；从复习页进入考试速查表时直接打开范围选择，返回时也直接回到原应用矩阵，不绕经上下文总览。范围选择支持跨课程与课次级多选；桌面为课程侧栏 + 课次画布，手机为横向课程选择带 + 仅展开已选课次，避免表单长页。课程支持可信名称、用户标签与边界纠正，再进入可打印速查表 |
| `AISearchPanel.tsx` | ~740 | 旧单轮 Workspace AI 搜索面板；主入口已由 `GlobalAskPanel` 替代，保留作迁移参考 |
| `WordExplainer.tsx` | ~580 | 术语解释器；管理员透镜复用本次选区、附近语境和最近提问 |
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
| `DesktopVideoReviewLayout.tsx` | ~647 | 桌面端课后复习三栏布局：左=视频/音频证据 + 时间轴，中=转录/困惑点/学习工作区，右=同桌；接入可拖拽三栏并持有课后学习黑板。音频态默认让中间学习区最宽，视频态仍以可观看的原件为第一权重；矩阵和具体应用自带标题，不再叠加重复的“学习工作区”栏头 |
| `ReviewThreePaneLayout.tsx` | ~156 | 课后复习可拖拽三栏容器：两条边界都可拖拽；音频默认比例 27/49/24，视频默认 46/34/20；学习区 / 同桌被挤到阈值后折叠成窄 rail，左证据栏不自动折叠 |
| `ReviewLearningWorkspace.tsx` | ~165 | 课后中间学习工作区：用 `AppRenderSurface` 承载完整应用；应用生成结果与闪卡/测验交互同时写入课后黑板和“最近学习现场”，但不自动升级为长期记忆 |
| `review-learning-blackboard.ts` | ~131 | 课后学习黑板：轻结构自然语言便签；只记录当前中间应用和最近学习现场事实，不写“应该/提醒/建议”等模型指令，中间应用和右侧同桌通过它解耦 |
| `WorkspaceCaptureEditorModal.tsx` | ~105 | 工作空间 capture 编辑弹窗，从 page.tsx 提取 |
| `VideoReviewPlayer.tsx` | 823 | 视频复习播放器（pauseNonce/playNonce/seekNonce 命令式控制，点击画面暂停/播放+指示器动画，visibilitychange 倍速恢复，空格/箭头键盘快捷键，B站 Dash 双轨同步，B站封面代理） |
| `ClassCheckOverlay.tsx` | 430 | 随堂检验弹窗（greeting → quiz → result 三阶段，Backdrop 已提取为独立组件避免闪烁） |
| `ClassroomView.model.ts` | ~10 | 课堂页纯交互模型（demo 录课态停止按钮应退出 demo，不走真实录音/stale DB 清理） |
| `SharedWorkspacePanel.tsx` | ~78 | shared workspace 统一面板（仅 apps）；支持在中间工作区打开具体应用而不是只弹浮窗 |
| `ReviewWorkspacePanel.tsx` | ~193 | desktop review 左侧证据面板（timeline / anchor detail；M15 起移除单课 feed tab，信息流改走侧栏全局入口） |
| `ReviewTutorPanel.tsx` | ~268 | desktop review 右侧 Tutor 面板（历史对话、SafeAITutor / TutorAgentPanel 统一容器；音频波形已上移到左证据栏）；顶部只用“整节课 / 困惑点”表达当前对话范围，不再用重复说明文字挤压默认窄栏 |
| `CollectionSelectionBar.tsx` | 94 | 收集上下文多选操作条（问 Tutor / 引用 / 批量归档删除） |
| `CollectionComposerContextPreview.tsx` | 62 | composer 上方的引用与链接预览条 |
| `CollectionComposerBar.tsx` | 168 | collection composer 输入区容器（预览 / textarea / 发送 / 听写 / 上传） |
| `CollectionMessageActionSheet.tsx` | ~283 | 收集消息操作菜单（引用/问 Tutor/多选/复习/编辑/打开原件/归档/删除），从 page.tsx 提取 |
| `mobile/MobileCollectionSheet.tsx` | ~400 | 收集菜单 / 历史收集 / 今日情报面板；移动端底部或侧边 sheet，桌面端以具备 dialog 语义的右侧上下文抽屉呈现；情报空态可返回收集补充上下文 |
| `CrossCourseFeedPanel.tsx` | ~180 | 个人上下文与目标驱动的情报面板：合并“看见自己”与真实外部信息，对用户零配置；保留上次结果并在后台刷新，失败不清空旧内容 |
| `FeedStream.tsx` / `feed-stream-model.ts` | ~420 | 今日情报列表渲染器与纯排序模型：外部发现和个人线索从首屏起交替出现，不再用两组标题把信息流切成两个报告；外部卡展示作者、出版时间、来源、个人推荐理由与不同视角；支持反馈及外链打开 |
| `CollectionFeedMessageBubble.tsx` | ~340 | 收集 Feed 单条消息气泡（audio/video/image/document/text 五种类型），从 page.tsx 提取 |
| `CollectionEmptyState.tsx` | ~30 | 收集为空时的安静心智提示；所有真实动作统一留在底部输入栏，不重复列举来源能力 |
| `ImageUpload.tsx` | ~220 | 图片上传 |
| `Citations.tsx` | ~140 | 引用标签 |
| `CitationReferenceSheet.tsx` | ~260 | 引用参考弹窗 |

### 导航 / 布局

| 文件 | 行数 | 职责 |
|------|------|------|
| `Header.tsx` | ~280 | 顶部导航栏 |
| `DesktopSidebar.tsx` | ~374 | 桌面侧栏（默认 168px，折叠 52px；录课专注态强制 52px）；「今日情报」是常驻一级入口，可从任意工作区打开个人上下文与目标驱动的情报抽屉 |
| `AppLoading.tsx` | ~120 | 进入学习现场时的品牌过渡；只表达恢复状态和真实进度，不展示初始化、服务连接等工程阶段 |
| `ModelSelector.tsx` | ~260 | AI 模型选择器 |
| `WechatQrAuthDialog.tsx` | ~170 | 登录/设置复用的公众号原地扫码弹窗；状态由 `useWechatQrAuth` 驱动 |
| `WechatBindForm.tsx` | ~280 | 微信 Capture H5 的邮箱/密码兼容绑定表单 |
| `AgreementModal.tsx` | ~600 | 用户协议弹窗 |

### apps/ — 应用系统

| 文件 | 行数 | 职责 |
|------|------|------|
| `WorkshopYellowPage.tsx` | ~960 | 五项单课学习动作矩阵 + 一个显性的跨课考试速查表入口；首次点击后台完成，任务托盘仅承接进行中/失败，做好后进入统一学习工作区；分享贴着已完成成果出现 |
| `apps/WorkshopAppCard.tsx` | ~170 | 应用卡统一层级：首选完整卡 + 次要能力紧凑卡；学习动作、适用场景、状态与单一主操作 |
| `windows/WorkshopWindowManager.tsx` | ~580 | 浮窗管理器 |
| `windows/InfographicWindow.tsx` | ~700 | 信息图浮窗，类型/常量/工具已拆到 `infographic-window-data.ts` |
| `windows/infographic-window-data.ts` | 305 | 信息图类型/场景预设/风格预设/纯工具函数 |
| `windows/MindmapWindow.tsx` | ~691 | 思维导图浮窗，布局引擎已拆到 `mindmap-layout.ts` |
| `windows/mindmap-layout.ts` | 168 | 思维导图布局引擎（纯函数，有测试） |
| `windows/FlashcardsWindow.tsx` | ~470 | 主动回忆闪卡：按需提示、翻面自评、薄弱卡复习与原声证据回跳 |
| `windows/QuizWindow.tsx` | ~500 | 课堂测验：客观题反馈、主观题对照自评、薄弱题复练与原声证据回跳 |
| `windows/CheatsheetWindow.tsx` / `windows/cheatsheet-window-model.ts` | ~800 | 跨课考试速查表：纸面轻编辑、A4/Letter 与单双面约束、真实分页预览、浏览器打印 / PDF |
| `windows/PodcastWindow.tsx` | ~470 | 音频概览：播放优先、制作详情折叠、稳定错误兜底 |
| `windows/AppWindowPlaceholder.tsx` | ~100 | 六类应用共用的整理中 / 空结果 / 失败状态 |
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
- 只用系统 token：`canvas(#F6F8F6)`, `card(#fff)`, `ink(#20312A)`, `ink-secondary(#53645C)`, `ink-muted(#819087)`, `divider(#DCE5DF)`；大面积纯黑不属于“科技感”，主交互优先使用 `pine(#2F6B55)`。
- 禁止：`bg-gradient-*`, `shadow-*`, `ring-*` 装饰
