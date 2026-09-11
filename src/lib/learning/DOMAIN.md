# lib/learning — 学习科学的纯模型（客户端与服务端共用）

> 这里只放**纯函数**：从检验结果到"这个人现在什么样、接下来该复习什么"的规则。没有 React、没有 Prisma、
> 没有 fetch；浏览器（hooks / 窗口）与服务端（learner-context-provider）import 同一份，学生在三处看到的是同一个自己。

## 不变量

- **事件是事实，状态是推导**：输入永远是 assessment 事件（`LearningAssessmentDraft` + 发生时刻），状态词只有三个（还没稳 / 刚记住 / 已经稳了），
  到期只有一个数（dueAt）。不在这里写"学习风格""能力水平"这类推断——那些是模型的事，或者根本不该有。
- **概念键按原文归一**（空白折叠 + 小写）：测验用题面、闪卡用正面、讲给同桌听用目标点。跨应用的同义匹配留给 Context 系统（Hindsight），这里不猜。
- **不做 gamification**：没有打卡、连胜、EF 难度系数（要用户四档评分）。产品明确不要。

## 文件

| 文件 | 职责 |
|---|---|
| `mastery-trail-model.ts` | 掌握轨迹：按概念聚 steps，最后一步负 → unstable；正且之前有负或只对过一次 → improving；最后两步都正 → stable；`mergeMasteryTrails` 本机 + 服务端合并（同概念服务端为准、本机更新的保留）；`trailFromLearnerMastery` 服务端切片 → 轨迹条目；`isPositiveOutcome` / `isNegativeOutcome` |
| `spaced-review-model.ts` | **跨会话间隔复习的到期模型（2026-09-11，SM-2 思路刻意轻）**：`scheduleFromSteps` 一张卡的历史 → 档（没记住 → 间隔回到 1 天；记住 → 第一次 1 天、之后翻倍，上限 60 天；同一坐 4 小时内再记住不算隔了一次——否则"没记住的再来一遍"补的那一次会把间隔翻倍）；`planReview` 一叠卡 + 历史 → 复习顺序：到期（没记住的在前、越过期越前）→ 上次没记住还没到期 → 新卡 → 记住了还没到期；`describeReviewEntry` 进入态那一句（到期全是没记住的 → 「上次没记住的 N 张先来」；有记住过又该复习的 → 「今天到期 N 张」；全新卡不说）。读侧编排在 `hooks/useFlashcardsReview`（登录用户以服务端事件为源、访客本机） |
| `device-outcomes.ts` | 浏览器专用只读：扫 localStorage `mm-review-outcomes:*`（review-session-outcomes 写）→ 带 `sessionId` 的 AssessmentRecord（2026-09-11 起从 key 取回，本机切片据此标概念"证据在哪节课"）；`OUTCOMES_UPDATED_EVENT` 写入后广播的 window 事件名（字符串契约） |
| `lesson-title-generic.ts` | 课堂标题是否只是占位（"新课堂 / 未命名"）的判定 |
| `moment-title.ts` | 课堂节点标题正规化 |

## 为什么到期模型放这里而不是窗口里

闪卡窗口只负责"翻、打分、飞出"；哪几张先来是学习科学的判断，要在 FlashcardsWindow、课后学习页的路径卡副题、
将来的手机路径页里给出同一个答案，所以是 lib 里的纯函数 + 一个 hook，不是某个组件的私有逻辑。单测：`spaced-review-model.test.ts`（7 例）、`mastery-trail-model` 的测试在 `components/mastery-trail.test.ts`。
