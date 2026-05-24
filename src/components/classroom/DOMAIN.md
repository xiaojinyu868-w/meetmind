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
| `ClassroomLayout.tsx` | ~140 | 左右分栏容器（桌面端同学收起时显示 Octo Buddy 悬浮球；录课态右栏默认收窄为 400px，保留拖拽放大；移动端保留浮标 + 全屏 sheet） |
| `ClassroomLeftPanel.tsx` | ~300 | 视图管理器（list ↔ recording 淡入切换）+ **ActiveLessonPill 置顶活动条**（录音中的课抽出，视觉权重最高 · 暖黄底 + 脉动红点 + 计时器 + 停止键 + "点开看实时转录"）+ StickyStartBar 底部主 CTA（暖黄填充权重 > 白底） |
| `ClassroomCompanionPanel.tsx` | ~260 | 右侧同桌面板（header/气泡/流式气泡/thinking/输入栏；录课初始态把快捷整理能力前置到消息流内，避免底部孤岛） |
| `InlineAppCard.tsx` | ~160 | 对话内应用承载卡（真实应用 UI 复用 `apps/windows/AppRenderSurface`，不再手写一套窄版） |
| `OctoBuddy.tsx` | ~180 | Octo Buddy 像素 IP 悬浮球（纯透明章鱼、可拖动、位置记忆；支持 idle/listening/thinking/happy/surprised/love/angry/sleeping 状态） |
| `ClassroomLessonCard.tsx` | ~160 | 一张课的卡片（四种时态视觉差异：upcoming/recording/processing/ready） |
| `ClassroomRecordingView.tsx` | ~170 | 录课中视图（桌面端课堂 cockpit：左侧实时文字卡 + 右侧结构小树；压缩头部仪式感，把空间还给内容） |
| `types.ts` | ~55 | Lesson / LessonStatus / ClassroomPaneState / CompanionMessage / CompanionCard |
| `demoData.ts` | ~90 | Demo 数据（暂未使用，保留供 storybook/演示） |
| `DemoLessonLoader.ts` | ~50 | 试听课 loader：把 demo segments / anchors / timeline / audioUrl 写入课堂现场 |
| `guest-demo-entry.ts` | ~110 | 访客试听入口模型：显式 `entry=demo`、默认闪卡产物、静态首屏 flashcards result + 稳定识别器 |
| `lessonAdapter.ts` | ~90 | `AudioSession + extras → Lesson` 纯函数适配器 |
| `composeFirstHello.ts` | ~130 | 同桌第一句话的动态生成（6 个情境分支，纯函数可测） |
| `index.ts` | — | Barrel export |

## 设计铁律

- **零渐变、零阴影、纯平涂**（全局设计系统）
- **卡片时态视觉重量不同**：`upcoming` opacity-85 / `recording` 左侧暖黄竖线 / `processing` ink-muted 弱化 / `failed` 稳定灰点 + 原声保留 / `ready` 实心
- **录课中显示“实时文字”卡，不再用大面积空白等待结构**；转录卡头部保持紧凑，完整文字按需展开；桌面侧栏进入 52px 专注态
- **同桌消息无气泡背景**（像便签，只有用户消息才是 ink 胶囊）
- **对话正文优先可读**：同桌 / 用户消息正文以 14px+、1.7+ 行高为基线，11px 只用于极少数 meta
- **开场白基于真实数据**：不播报、不穷举，随口一句最显眼的那个点
- **进行中的任务 > 历史**：录音中的课抽出列表，固定置顶（ActiveLessonPill），视觉权重最高
- **全局主 CTA 不允许被滚走**：底部 StickyStartBar 常驻；已在录音时变灰提示"正在录一节课"
- **AI 同桌是"可召唤"的，不是默认占地的**：桌面端默认 Octo Buddy 悬浮球；录课态才自动展开到可拖拽右栏（用户真的需要它的时候再出现——"收→整理→应"的"应"）

## 关键接入点

| 接入方 | 方式 |
|--------|------|
| `page.tsx` → `ClassroomView` | 通过 `onOpenLesson(lessonId)` 调 `restoreReviewSession` + `setViewMode('review')` 复用现有复习态 |
| `page.tsx` → `ClassroomView` | 通过 `isRecording` 驱动左侧切到 recording 态 |
| `page.tsx` → `ClassroomView` | 访客 `entry=demo` 通过 `autoLoadDemo` 直接进入 demo 课堂现场；只有显式 `autoOpenDemoAppKey` 才打开应用 |
| `useClassroomCompanion` → `/api/tutor` | 复用 `useSimpleSSEStream`，`globalMode: true` + stream SSE |
| `useClassroomLessons` → Dexie | `useLiveQuery` 三个表（audioSessions + transcripts + highlightTopics）+ adapter |

## 最近约定

- Lesson 不等于 AudioSession——是 UI 视图专用的折叠类型
- `reviewed` 通过 preferences 表 `classroom_reviewed_sessions` key 持久化（Set<sessionId> 的 JSON 数组）
- `hasEcho` 通过 `workspaceEchoes.sourceCaptureIds → workspaceCaptures.metadata.sessionId` 两跳判断
- `linkedMaterials` 松绑定：同日期创建的非 audio/video sourceItems 计数
- `composeFirstHello` 先静态枚举，未来可考虑接 LLM 生成但一定要保持 ≤30 字
- 同桌消息通过 preferences 表 `classroom_companion_messages:<sessionId>` key 按课持久化，最多保留 50 条，debounced 500ms 写回
- 同桌内联应用保存完整 `AppExecutionResult`，通过 `AppRenderSurface` 复用课后应用矩阵 UI；`payload` 只做旧历史兼容；课中只开放 `mindmap / cheatsheet`，历史里已有的 `flashcards / quiz / study-report` 在 listening 态隐藏
- 课中同桌首 token 前不在主消息流造一句“像回答的话”；只在输入区给 `正在回答` 状态，真实内容到达后才进入消息流
- 预感是 ambient signal：只进入 header 轻入口，不进入主消息流、不影响空态和输入入口
- 录课中关键概念用客户端启发式（2-6 字中文词 + 停用词过滤），不调用后端，追求"感知在场"而非语义精准
- 移动端（<lg）右侧同桌面板用底部"问同桌"按钮触发全屏 sheet，保留桌面常驻的产品心智
- 课中目标是“跟上老师正在讲什么”；闪卡 / 测验 / 学习报告 / 主动回忆训练放在课后复习与应用矩阵，不抢课堂主叙事
- Demo 不能伪装成“完整课已经听完”的课中现场；如果进入 recording 视图，必须按 elapsedSeconds 渐进露出内容，停止按钮必须能退出 demo 现场

## 测试

- `composeFirstHello.test.ts`：12 个分支覆盖测试，vitest 跑过
