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
| `MobileAppNavigator.tsx` | 移动端统一导航栈（push/pop/popTo/replace/reset，screen 枚举：home/recording/processing/review/flashcards/quiz/cheatsheet/apps/classmate/empty）；`useMobileNav` 暴露 `canPop`（栈长 > 1），`resetTo` 直入的页面（如试听课 recording）返回键须用 `canPop ? pop() : resetToHome()` 兜底；嵌套应用继续持有最近 reviewContext，证据引用可直接回到课后原文 |
| `mobile-navigation-model.ts` | 移动端导航类型与纯栈模型：保留最近 reviewContext、跨过应用目录返回课后证据时间；与 React Provider 解耦并可单测 |
| `MobileAppShell.tsx` | **移动端统一页面壳**：接入真实数据，渲染各 screen。零内容首屏直接展示“录课 / 放资料 / 问 MeetMind”三条路径；开始录课必须等待 Recorder 返回成功后才 push 录课页，避免权限失败时出现假的 `00:00` 或旧课转录。内置 90 秒试听用真实音频时钟驱动转录与课堂脉络渐进出现，英文试听默认 EN→中，结束后进入同一套课后笔记和应用门禁。官方试听在手机端也必须保留六类应用的完整能力预览，推荐只改变排序与强调；六类应用统一走 `CatalogAppScreen → MobileAppRunner`，共享标题、数据源和失败恢复体验；真实短材料继续由 readiness 控制可生成范围。是否为零内容同时读取收集、笔记总结、记忆、近期活动和活跃学习线程；录课页复用 `useClassroomFlow + ClassroomFlowCanvas`，默认展示课堂脉络并可切回原话；AI 对话通过 render slot 接收 page.tsx 传入的 SafeAITutor。首页把活跃学习线和“最近收下”的原件明确分层；无昵称时只显示中性个人图标，不伪造用户身份。管理员开启管理视图时只在头像上显示微小状态点，开关仍收在设置页，不新增悬浮工具栏压住手机内容。 |
| `MobileFirstLearningScreen.tsx` | 手机端真正零内容用户的首次学习页：一个主心智、一个录课主动作，加上放资料、问 MeetMind 和真实试听；不再堆能力清单与小字说明 |
| `MobileLearningCommandCenter.tsx` | 移动首页首屏学习控制台：用一个主表面统一录课、资料、拍照、全局“问同学”入口；首屏只保留一个主叙事、一个录课主动作和三个大号入口，不展示上下文计数、说明段落、按钮副标或能力承诺小字；次入口采用图标在上、短标签在下，禁止窄屏文字截断；朱批红只做动作记号 |
| `MobileAppRunner.tsx` | 移动端应用执行器：封装 useAppExecution + AppRenderSurface，支持六类 catalog 应用；透传真实 `dataSource`，避免官方试听在执行阶段再次被短内容门禁拦截；信息图复用课堂文本作为 contentContext；失败态保留“重试 / 看看其他方式”两条出口；可分享成果在结果上方直接出现“分享”；应用生成结果与闪卡/测验交互通过共用 hook 回写最近学习现场 |
| `MobileCollectionCard.tsx` | 移动端精简收集流卡片；速记直接显示正文，并展示微信/公众号/B站等可识别的来源标签 |
| `mobile-collection-utils.ts` | 移动收集区与课堂时间轴纯展示模型；以不可变方式生成最新优先的资料收件箱，并把实时转录与课中板书按同一课堂时钟排序；照片优先使用文件实际拍摄时刻 |

## 注意

- `PodcastPlayer.tsx` 导出的 `ConfusionMarker` 类型被 `session-store` 引用
- Dedao 系列组件是得到 App 风格的替代 UI 方案
- `MobileCollectionSheet.tsx`、`MobileTopBar.tsx`、`MobileRecordTopBar.tsx`、`MobileAIChatHeader.tsx`、`MobileAIChatPanel.tsx` 是 page 拆分模板：适合承接移动端大块条件渲染 UI；其中学习同桌文字对话/历史详情统一走 `SafeAITutor → TutorAgentPanel`，语音同桌走 `RealtimeTutorPanel → TutorRealtimeCallScreen`；语音转写会落 `conversationService` 并通过 conversationId 接回文字 agent，但不要把业务逻辑和数据获取塞回组件里
- `MobileAppShell.tsx` 是 M15 移动端重设计的统一壳：替代旧的 `viewMode + mobileSubPage` 双状态机，用 `MobileAppNavigator` 栈式导航。拍照不再依赖外部 `sourceFileInputRef`，内部创建带 `capture="environment"` 的独立 input。录课计时器内部 tick。首页输入条的交互合同是“左侧添加文件、右侧空态语音听写、有正文时切为发送”，听写必须复用 `useCollectionComposer` 的语音入口，不能降级成音频文件选择。复习态 AI 对话、应用矩阵通过 render slots 从 page.tsx 传入真实组件。处理中的“先回首页”必须真正离开处理页；超时未产生转录时不能进入永久 loading 的复习页。课后 `useLessonDigest` 对同一内容签名只发起一次自动请求，失败时显示降级而不循环重试。「今日情报」同时读取服务端 workspace captures、本地收集与活跃学习线，即使没有新收藏，也可以由用户已确认的学习目标启动。
- `MobileAppRunner.tsx` 是移动端应用执行器：六类应用共用 catalog 与 AppRenderSurface；移动端单课矩阵采用单列学习动作清单，五项单课产物全部可见，考试速查表以独立“跨课准备”入口出现并跳转课程范围选择，绝不能直接拿当前单课生成。非推荐项只保留“学习动作 + 应用名”，推荐项才补一行适用场景，正文最小 12px，避免两列卡片把说明压成不可读小字。服务端明确返回“无推荐”时，移动端不得用本地规则强推一项；未被推荐的课堂播客和桌面端一致稳定放在最后。
- 移动端独立学习屏的返回、播放、结束和收起等图标按钮都必须提供可读的 `aria-label`，不能在辅助技术和语义测试中变成“空按钮”。
- 移动端应用里的课堂证据不是无反馈 seek：点击后必须跨过应用目录直接回到课后“转录”，定位并轻高亮对应原话；导航栈需要保留最近的 `reviewContext`，不能在 `review → apps → app` 过程中丢失课次。
- 移动首页的收集区采用“资料收件箱”顺序（最新在上）；桌面收集流保留对话式时间正序，两者不要共享排序假设。
- 移动首页第一屏只允许一个主叙事：学习控制台。采集方式是入口层，AI 产物是能力层，今日发现和最近内容是上下文层；不要再让拍照、速记、情报卡和最近列表同时争夺主视觉。控制台使用明亮的 `pine-fog + card` 分层，深色只用于文字，主动作使用 `pine`，禁止恢复大面积纯黑面板。顶栏不重复日期等低价值小字；主叙事下也不再加一段解释，动作本身必须让用途可理解。
- 移动录课页和桌面必须共享同一套课堂脉络语义：默认先看“脉络”，需要核对时切回“原话”；不能在手机端退化为只有 ASR 卡片流，也不能重新放回课中思维导图。
- 课中板书是课堂证据，不是录音尾部附件：选择照片后必须立即写入当前 session 与 `capturedAtMs`，显示 `MM:SS`，并和转录段按同一课堂时钟排序；不能等待 OCR 完成后才补时间，也不能把无 session 的历史图片混进当前课堂。
- `DedaoMenu.tsx` 现在承担移动端统一"设置"入口：游客和登录用户都能进 `settings`，个人资料不再单独挂在菜单里
