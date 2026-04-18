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
| `ClassroomLayout.tsx` | ~140 | 左右分栏容器（**v3 可召唤式右栏**：桌面默认收起 48px 窄条，点击展开到 360/380px；受控 prop `companionOpen` 由 View 驱动——录课态自动展开；移动端保留浮标 + 全屏 sheet） |
| `ClassroomLeftPanel.tsx` | ~300 | 视图管理器（list ↔ recording 淡入切换）+ **ActiveLessonPill 置顶活动条**（录音中的课抽出，视觉权重最高 · 暖黄底 + 脉动红点 + 计时器 + 停止键 + "点开看实时转录"）+ StickyStartBar 底部主 CTA（暖黄填充权重 > 白底） |
| `ClassroomCompanionPanel.tsx` | ~260 | 右侧 AI 同桌面板（header/气泡/流式气泡/thinking/输入栏） |
| `ClassroomLessonCard.tsx` | ~160 | 一张课的卡片（四种时态视觉差异：upcoming/recording/processing/ready） |
| `ClassroomRecordingView.tsx` | ~170 | 录课中视图（留白为主，AI 偶尔递概念卡） |
| `types.ts` | ~55 | Lesson / LessonStatus / ClassroomPaneState / CompanionMessage / CompanionCard |
| `demoData.ts` | ~90 | Demo 数据（暂未使用，保留供 storybook/演示） |
| `lessonAdapter.ts` | ~90 | `AudioSession + extras → Lesson` 纯函数适配器 |
| `composeFirstHello.ts` | ~130 | 同桌第一句话的动态生成（6 个情境分支，纯函数可测） |
| `index.ts` | — | Barrel export |

## 设计铁律

- **零渐变、零阴影、纯平涂**（全局设计系统）
- **卡片时态视觉重量不同**：`upcoming` opacity-85 / `recording` 左侧暖黄竖线 / `processing` ink-muted 弱化 / `ready` 实心
- **录课中不显示逐字转录**（同桌在"听"，不刷屏）
- **同桌消息无气泡背景**（像便签，只有用户消息才是 ink 胶囊）
- **开场白基于真实数据**：不播报、不穷举，随口一句最显眼的那个点
- **进行中的任务 > 历史**：录音中的课抽出列表，固定置顶（ActiveLessonPill），视觉权重最高
- **全局主 CTA 不允许被滚走**：底部 StickyStartBar 常驻；已在录音时变灰提示"正在录一节课"
- **AI 同桌是"可召唤"的，不是默认占地的**：桌面端默认 48px 窄条；录课态才自动展开到 360/380px（用户真的需要它的时候再出现——"收→酿→应"的"应"）

## 关键接入点

| 接入方 | 方式 |
|--------|------|
| `page.tsx` → `ClassroomView` | 通过 `onOpenLesson(lessonId)` 调 `restoreReviewSession` + `setViewMode('review')` 复用现有复习态 |
| `page.tsx` → `ClassroomView` | 通过 `isRecording` 驱动左侧切到 recording 态 |
| `useClassroomCompanion` → `/api/tutor` | 复用 `useSimpleSSEStream`，`globalMode: true` + stream SSE |
| `useClassroomLessons` → Dexie | `useLiveQuery` 三个表（audioSessions + transcripts + highlightTopics）+ adapter |

## 最近约定

- Lesson 不等于 AudioSession——是 UI 视图专用的折叠类型
- `reviewed` 通过 preferences 表 `classroom_reviewed_sessions` key 持久化（Set<sessionId> 的 JSON 数组）
- `hasEcho` 通过 `workspaceEchoes.sourceCaptureIds → workspaceCaptures.metadata.sessionId` 两跳判断
- `linkedMaterials` 松绑定：同日期创建的非 audio/video sourceItems 计数
- `composeFirstHello` 先静态枚举，未来可考虑接 LLM 生成但一定要保持 ≤30 字
- 同桌消息通过 preferences 表 `classroom_companion_messages` key 持久化，最多保留 50 条，debounced 500ms 写回
- 录课中关键概念用客户端启发式（2-6 字中文词 + 停用词过滤），不调用后端，追求"感知在场"而非语义精准
- 移动端（<lg）右侧同桌面板用底部"问同桌"按钮触发全屏 sheet，保留桌面常驻的产品心智

## 测试

- `composeFirstHello.test.ts`：12 个分支覆盖测试，vitest 跑过
