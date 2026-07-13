# Mobile — 移动端专用组件

> 手机端 UI 组件，基于 Tailwind 响应式，在桌面端不渲染。

## 依赖规则

同 `components/` 顶层：可用 hooks/stores/types/lib/utils，不可直接 import services。

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.ts` | barrel 导出 |
| `MobileLayout.tsx` | 移动端整体布局容器 |
| `MobileMenu.tsx` | 移动端菜单 |
| `MobileTabSwitch.tsx` | 底部 tab 切换 |
| `MobileTimeline.tsx` | 移动端收集流时间线 |
| `MobileAIFab.tsx` | 移动端 AI 浮动按钮 |
| `MiniPlayer.tsx` | 迷你音频播放器 |
| `MenuDrawer.tsx` | 侧边抽屉菜单 |
| `BottomPanel.tsx` | 底部面板 |
| `ConfusionCard.tsx` | 困惑点卡片 |
| `PodcastPlayer.tsx` | 播客播放器（导出 `ConfusionMarker` 类型） |
| `DedaoConfusionCard.tsx` | 得到风格困惑卡片 |
| `DedaoMenu.tsx` | 得到风格菜单（含游客/登录态统一设置入口） |
| `DedaoTimeline.tsx` | 得到风格时间线 |
| `MobileCollectionSheet.tsx` | 收集列表底部抽屉（全量 feed） |
| `MobileReviewSheet.tsx` | 复习态底部可拖拽 Sheet（收起/半展/全展三档） |
| `MobileAppNavigator.tsx` | 移动端统一导航栈（push/pop/replace/reset，screen 枚举：home/recording/processing/review/flashcards/quiz/cheatsheet/apps/classmate/empty） |
| `MobileAppShell.tsx` | **移动端统一页面壳**：接入真实数据，渲染各 screen。通过 render slots 接收 page.tsx 传入的真实组件（SafeAITutor / MobileAppRunner） |
| `MobileAppRunner.tsx` | 移动端应用执行器：封装 useAppExecution + AppRenderSurface，支持六类 catalog 应用；信息图复用课堂文本作为 contentContext |
| `MobileCollectionCard.tsx` | 移动端精简收集流卡片；速记直接显示正文，并展示微信/公众号/B站等可识别的来源标签 |
| `mobile-collection-utils.ts` | 移动收集区纯展示模型；以不可变方式生成最新优先的资料收件箱顺序 |

## 注意

- `PodcastPlayer.tsx` 导出的 `ConfusionMarker` 类型被 `session-store` 引用
- Dedao 系列组件是得到 App 风格的替代 UI 方案
- `MobileCollectionSheet.tsx`、`MobileTopBar.tsx`、`MobileRecordTopBar.tsx`、`MobileAIChatHeader.tsx`、`MobileAIChatPanel.tsx` 是 page 拆分模板：适合承接移动端大块条件渲染 UI；其中学习同桌文字对话/历史详情统一走 `SafeAITutor → TutorAgentPanel`，语音同桌走 `RealtimeTutorPanel → TutorRealtimeCallScreen`；语音转写会落 `conversationService` 并通过 conversationId 接回文字 agent，但不要把业务逻辑和数据获取塞回组件里
- `MobileAppShell.tsx` 是 M15 移动端重设计的统一壳：替代旧的 `viewMode + mobileSubPage` 双状态机，用 `MobileAppNavigator` 栈式导航。拍照不再依赖外部 `sourceFileInputRef`，内部创建带 `capture="environment"` 的独立 input。录课计时器内部 tick。复习态 AI 对话、应用矩阵通过 render slots 从 page.tsx 传入真实组件。处理中的“先回首页”必须真正离开处理页；超时未产生转录时不能进入永久 loading 的复习页，而应明确告知原声已保留并提供返回路径。「今日情报」同时读取服务端 workspace captures 和尚未同步完成的本地收集，首条本地笔记保存后即可生成。
- `MobileAppRunner.tsx` 是移动端应用执行器：六类应用共用 catalog 与 AppRenderSurface；移动端矩阵不再维护缺少播客/信息图的四项手写目录。
- 移动首页的收集区采用“资料收件箱”顺序（最新在上）；桌面收集流保留对话式时间正序，两者不要共享排序假设。
- `DedaoMenu.tsx` 现在承担移动端统一"设置"入口：游客和登录用户都能进 `settings`，个人资料不再单独挂在菜单里
