# Classroom — 课堂子模块

> 课堂 Tab 的 UI 组件 + 数据适配 + 开场白生成。
> 围绕「一节课」心智：课前（upcoming）/ 课中（recording）/ 课后-酿造中（processing）/ 课后-已理解（ready）。

## 依赖规则

```
classroom/ → types + utils（内部）
classroom/ ← ClassroomView.tsx（唯一上层入口）
classroom/ ← hooks/useClassroomLessons.ts（数据适配消费 lessonAdapter）
classroom/ ← hooks/useClassroomCompanion.ts（对话 hook 消费 composeFirstHello）
```

- ✅ 可以 import `@/lib/db/schema` 的 `AudioSession` 类型
- ✅ 可以 import lucide-react 图标
- ❌ 不要 import 其他业务组件（应通过 props 解耦）
- ❌ 不要直接发 HTTP 请求（让 hook 处理）

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `ClassroomLayout.tsx` | ~270 | 左右分栏容器；同桌只在真实录课 / 示例课听课态可见，无课堂上下文时隐藏右栏、Octo Buddy 和移动端问同学入口；录课态右栏默认 340px，把宽度优先留给课堂脉络并保留拖拽放大；移动端「问同学」悬浮钮走 pine 主签名 |
| `ClassroomLeftPanel.tsx` | ~690 | 视图管理器（list ↔ recording 淡入切换）+ 首页能力旅程（听懂现场 / 连起资料 / 练成结果）+ **ActiveLessonPill 置顶活动条** + StickyStartBar 底部主 CTA；零存量态把录音来源选择传给 Hero；试听课完成态透传课后引导动作 |
| `ClassroomHomeCommandCenter.tsx` | ~105 | 有历史课堂时的桌面首页续学控制台：只保留日期、续学主叙事、真实恢复现场、问课堂与放材料入口；不再重复解释能力，让最近课堂进入首屏 |
| `ClassroomCompanionPanel.tsx` | ~590 | 右侧同桌面板（header/气泡/流式气泡/thinking/输入栏）；课中不写入自动寒暄消息，header + 轻量 Octo 在场信号承接第一次互动，问题快通道只在输入区保留一套，避免上下两组重复入口；管理员透镜读取与真实课中请求相同的转录、recentFocus、学习理解与最近问题；课后 starter 同样不做重功能卡；v7 按钮语义：InlineActionStrip 主 action / 发送钮 / 课后首 chip 走 pine，次 action 走 ghost 白边；AI 消息带 2px pine 左 rail 作为克制的“AI 在场”信号 |
| `InlineAppCard.tsx` | ~160 | 对话内应用承载卡（真实应用 UI 复用 `apps/windows/AppRenderSurface`，不再手写一套窄版）；inline quiz / flashcards 沉浸底统一 `var(--mm-immersive)` |
| `OctoBuddy.tsx` | ~660 | Octo Buddy 像素 IP（Sprite + 悬浮球）；Sprite 自带呼吸 / 听课 / 开心动画，右侧同桌内嵌也必须动起来 |
| `ClassroomHero.tsx` | ~280 | 课堂零存量首屏；左侧定位与录音入口，右侧展示真实示例；存在未完成学习线索时，主叙事上方显示 `ContextRecoveryCard`，可直接接回全局 Ask；proof 卡时间戳统一 `.cite-ts`（朱批 mono 胶囊） |
| `ClassroomLaunchpad.tsx` | ~100 | 课堂首页能力入口：让开始课堂、放入材料、搜索并继续问第一眼可见；只呈现三条学习路径，不做完整功能黄页 |
| `ClassroomLessonCard.tsx` | ~160 | 一张课的卡片（四种时态视觉差异：upcoming/recording/processing/ready）；时间只显示为元信息，不再伪装成课堂标题 |
| `ClassroomRecordingView.tsx` | ~640 | 录课中视图（宽桌面左侧实时文字 + 中间课堂脉络；移动端和中等宽度桌面在“脉络 / 原话”之间切换，避免三栏硬挤；含翻译与试听课音频控制）。试听课默认 EN→中，音频结束后只引导点击“结束这节课”，由上层切到课后复习页 / 应用矩阵；转录卡头部有呼吸球仪式（listening 时存在、试听完成即消散）和返回课程列表的退出入口（试听课先暂停音频，真实录音由活动条承接可回来），句首时间戳统一 `.cite-ts`；DemoAfterClassPanel 为 v7 收尾卡（纸感 + pine CTA + Octo happy + 一次柔光扫过） |
| `ClassroomFlowCanvas.tsx` | ~220 | 课中中间主画布：空态只显示真实听课状态，不用解释文案教育用户；内容出现后突出“正在讲”，以低权重时间线呈现已经走过的推进，并将真正值得回来的定义/公式/问题留到课后；画布可滚动查看较早节点，数据层不得只保留当前附近的少数几条；不画课中思维导图；新增脉络项用 `flow-grow` 生长进入（translate+opacity，近期推进逐条 stagger），「正在理解」用 `.thinking-strip`，时间锚点统一 `.cite-ts` |
| `ClassroomRecordingView.model.ts` | ~16 | 录课视图纯模型：翻译模式循环 + 会话级默认翻译模式解析 |
| `types.ts` | ~55 | Lesson / LessonStatus / ClassroomPaneState / CompanionMessage / CompanionCard |
| `demoData.ts` | ~90 | Demo 数据（暂未使用，保留供 storybook/演示） |
| `DemoLessonLoader.ts` | ~50 | 试听课 loader：把 demo segments / anchors / timeline / audioUrl 写入课堂现场 |
| `demo-classroom-flow.ts` | ~105 | 试听课课堂脉络：按真实音频秒数推进“正在讲 / 刚才经过 / 留到课后”，与实时转录同步生长 |
| `guest-demo-entry.ts` | ~110 | 访客试听入口模型：显式 `entry=demo`、默认闪卡产物、静态首屏 flashcards result + 稳定识别器 |
| `lessonAdapter.ts` | ~200 | `AudioSession + extras → Lesson` 纯函数适配器；课堂标题遵循“用户命名 → 重点 → 总结 → 转录 → 来源类型”的证据优先级，拒绝 URL / 时间 / 日期冒充标题；`transcriptionStatus=pending` 时忽略 realtime 草稿证据并保持 processing |
| `composeFirstHello.ts` | ~130 | 同桌第一句话的动态生成（6 个情境分支，纯函数可测） |
| `index.ts` | — | Barrel export |

## 设计铁律

- **v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）**（全局设计系统）
- **卡片时态视觉重量不同**：`upcoming` opacity-85 / `recording` 左侧暖黄竖线 / `processing` ink-muted 弱化 / `failed` 稳定灰点 + 原声保留 / `ready` 实心
- **录课中显示“实时文字”卡，不再用大面积空白等待结构**；转录卡头部保持紧凑，完整文字按需展开；桌面侧栏进入 52px 专注态
- **同桌消息无气泡背景**（像便签，只有用户消息才是 ink 胶囊）
- **课中不提供时间回跳**：同桌只帮助用户跟上当前课堂；即使模型意外返回 `[MM:SS]` 也要从课中消息中清理。可点击时间引用只属于课后 `review`。
- **课堂脉络优先拿到横向空间**：宽桌面才同时展示原话 + 脉络 + 同学；中等宽度桌面把原话和脉络收成显式切换，同学栏默认保持 340px，不能让三栏硬挤到主标题逐字换行。
- **对话正文优先可读**：同桌 / 用户消息正文以 14px+、1.7+ 行高为基线，11px 只用于极少数 meta
- **开场白基于真实数据**：不播报、不穷举，随口一句最显眼的那个点
- **进行中的任务 > 历史**：录音中的课抽出列表，固定置顶（ActiveLessonPill），视觉权重最高
- **全局主 CTA 不允许被滚走**：底部 StickyStartBar 常驻；已在录音时变灰提示"正在录一节课"
- **AI 同桌是"有上下文才出现"的**：空课堂 / 未听课时不显示右栏、Octo Buddy 或问同学入口，避免无上下文拒答；真实录课或示例课听课态才自动展开到可拖拽右栏
- **电脑内录必须首屏可见**：零存量态不能只给一个“开始录课”按钮；录音来源 rail 要直接露出“电脑声音”，否则用户不会知道可以录网课 / 系统声音
- **听准优先于分人**：首页与录课中不让用户选择 ASR 供应商或“单人 / 多人”模式；实时字幕固定走高准确率 Qwen。说话人只在课后定稿后静默判断，至少两位稳定发言证据成立才显示匿名“发言者 A / B”，不自动猜老师或真实姓名。
- **首页入口不能互相重复**：有历史课堂时，顶部只展示“放入材料 / 搜索”两条补充上下文动作；录课与声音来源统一由底部常驻栏承接。顶部能力旅程解释输入之后会得到什么，不能再塞一个重复的录课卡。
- **试听课必须有生长感**：左侧音频和转录、中间课堂脉络、右侧同桌轻问题要同步出现；中间不能等后端或长期停在空态，示例课用本地脉络随音频秒数推进；音频结束后必须由 Octo Buddy 提醒用户点击“结束这节课”进入既有课后复习页 / 应用矩阵，而不是在课中页面承载完整课后学习，也不能回到“原声已保留”的失败卡片
- **Octo Buddy 是 IP，不是图标**：内嵌在右侧同桌里的章鱼也必须动起来（呼吸 / 听课 / 开心），不能只作为静态头像

## 关键接入点

| 接入方 | 方式 |
|--------|------|
| `page.tsx` → `ClassroomView` | 通过 `onOpenLesson(lessonId)` 调 `restoreReviewSession` + `setViewMode('review')` 复用现有复习态 |
| `page.tsx` → `ClassroomView` | 通过 `isRecording` 驱动左侧切到 recording 态 |
| `page.tsx` → `ClassroomView` | 访客 `entry=demo` 通过 `autoLoadDemo` 直接进入 demo 课堂现场；只有显式 `autoOpenDemoAppKey` 才打开应用 |
| `useClassroomCompanion` → `/api/tutor` | 复用 `useSimpleSSEStream`，`globalMode: true` + stream SSE |
| `useClassroomLessons` → Dexie | `useLiveQuery` 聚合 audioSessions / transcripts / highlightTopics / classSummaries，把已落地内容证据交给 adapter 形成可识别标题 |

## 最近约定

- Lesson 不等于 AudioSession——是 UI 视图专用的折叠类型
- `reviewed` 通过 preferences 表 `classroom_reviewed_sessions` key 持久化（Set<sessionId> 的 JSON 数组）
- `hasEcho` 通过 `workspaceEchoes.sourceCaptureIds → workspaceCaptures.metadata.sessionId` 两跳判断
- `linkedMaterials` 松绑定：同日期创建的非 audio/video sourceItems 计数
- `composeFirstHello` 先静态枚举，未来可考虑接 LLM 生成但一定要保持 ≤30 字；`lessons.length === 0` 必须返回 `null`，零存量态由 Hero 承接，不让同桌无上下文主动发言
- 同桌消息通过 preferences 表 `classroom_companion_messages:<sessionId>` key 按课持久化，最多保留 50 条，debounced 500ms 写回
- 同桌内联应用保存完整 `AppExecutionResult`，通过 `AppRenderSurface` 复用课后应用矩阵 UI；`payload` 只做旧历史兼容；课中只开放 `mindmap / cheatsheet`，历史里已有的 `flashcards / quiz` 在 listening 态隐藏
- 课中同桌首 token 前不在主消息流造一句“像回答的话”；只在输入区给 `正在回答` 状态，真实内容到达后才进入消息流
- 右侧同桌的引导要轻：优先用 Octo Buddy 像素章鱼 + 2-3 个自然问题 chip（点了就发送），不要用大面积能力介绍卡教育用户
- 预感是 ambient signal：只进入 header 轻入口，不进入主消息流、不影响空态和输入入口
- 录课中关键概念用客户端启发式（2-6 字中文词 + 停用词过滤），不调用后端，追求"感知在场"而非语义精准
- 移动端（<lg）右侧同桌面板只在录课 / 示例课听课态提供底部"问同学"按钮触发全屏 sheet；空课堂不展示该入口
- 课中目标是"跟上老师正在讲什么"；中间主画布是模型自主理解的课堂脉络，不是思维导图。思维导图 / 闪卡 / 测验 / 主动回忆训练放在课后复习与应用矩阵，不抢课堂主叙事
- 真实课堂脉络按“未消费的新转录 → delta upsert/remove → 服务端合并”增长；成功后才推进 segment 游标，禁止每 30 秒重喂近 180 段并整体改写既有纪要。较早推进作为课后复习材料保留，模型工作记忆只读取近期窗口；成功结果按 sessionId 保存，下课后在应用矩阵作为已生成成果直接打开
- 课中请求固定 `returnTimestamps: false`，不得重新接入 citation chip 或跳转 handler；时间引用与原声回跳只在课后复习态成立
- Demo 不能伪装成“完整课已经听完”的课中现场；如果进入 recording 视图，必须由真实 `/demo-audio.mp3` 播放驱动转录渐进露出，自动播放被浏览器拦截时必须提供“播放声音”按钮；用户主动点击“结束这节课”时，无论试听音频是否自然播完，都进入同一套课后复习页 / 应用矩阵，不能把课堂上下文丢回首页
- 英文试听课默认开启 EN→中翻译，但这是会话默认，不应强行覆盖用户手动切换后的选择

## 测试

- `composeFirstHello.test.ts`：12 个分支覆盖测试，vitest 跑过
