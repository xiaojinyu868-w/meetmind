# 从材料开一节课：来源 / 能力 / 体验三层，以及模型看什么的边界（契约，2026-09-13）

> 这份文档是契约，不是进度表。它回答三个问题：知乎（以及以后任何来源）在产品里是什么；哪些是产品能力、谁拥有；一次模型调用里到底允许放什么。
> 修 unit pack、问同学、teach-live 对话史时拿它对照。进度与实测在 `docs/plans/2026-09-12-zhihu-line.md`。

## 1. 定位：来源是接在两条线两端的适配器，不是第三条线

MeetMind 有两条线：收集线（随手收下一切）和课堂线（一节课 → 课中同桌 → 课后复习 → 应用矩阵）。知乎不是第三条线，是一组来源适配器加一扇薄的门：

| 来源要实现的接口 | 接到哪个既有接缝 | 知乎的实现 |
|---|---|---|
| 身份 | `AuthProvider(provider)` | `provider='zhihu'`，`services/zhihu/zhihu-auth-service` |
| 收集 | `upsertCaptureForUser`（`sourceType` + `metadata.<来源>`） | `sourceType='zhihu-favorite'`，`zhihu-import-service`（导入 + 最近收藏同步） |
| 材料 | `MaterialCandidate[]` → `services/material-lessons` | `zhihu-material-candidate.ts`（capture → candidate） |
| 发现 | 今日情报的并列 provider；「继续看」的候选 + `describe` | `zhihu-discovery-service` + `zhihu-continue-judge`（薄壳） |
| 画像 | `recordLearningObservation`（一条观察） | `zhihu-profile-service` |

"课的单位是一篇 / 一条线"、"同学把一组材料读成几条线"、"讲完成为我的一节课进复习页"、"模型看什么的边界"——没有一条是知乎特有的。它们是产品能力，知乎是第一个来源。

## 2. 三层

```
体验层   /app（收集流 · 课堂列表 · 复习页）   /apps/zhihu（来源浏览：收藏夹 → 分线 → 开课）   /teach/live（舞台）
能力层   收集流 │ 材料课 services/material-lessons（课的单位 / 分线 / 预算 / 接下来看哪篇）│ 课的物化 teach-live/lesson-record │ 复习附件层 lib/review │ 记忆
来源层   zhihu │ bilibili │ 网页 │ 口袋 │ 微信 │ PDF …   每个来源只实现上表五个接口
```

依赖只能向下：来源层 import 能力层的类型与函数；能力层不认识任何来源；体验层组装。`/apps/zhihu` 长远是收集流的"按来源浏览"视图，"让同学讲这篇"最终是收集流里任何一条都有的动作。

## 3. 课的物化（core，teach-live）

一节 live 课讲完，成为「我的一节课」，走和录音课 / 视频课同一个复习页：

- `teach-live/lesson-record.ts`：事件日志（每行带 ts）→ `LessonRecord`——老师 / 学生两个说话人的转录段（时间轴按语速铺，不用生成速度）、页与板书统计、轮次、材料（coverage：full-text / outline / summary；点到没点到；≤3500 字节选）、之前相关课一行、回舞台地址、digest 一行。`GET /api/teach/threads/[id]/record`。
- 客户端：`lib/db/lesson-records.ts` 幂等存成 `audioSessions`（`sourceType='teach-live'`，无媒体，`sourceRef=threadId`）+ `transcripts`（`speakerId` teacher / student，`sourceItemId` = 材料 ref）；`hooks/useLessonRecordSync` 在服务端讲完一轮时存；`/app?session=teach:<id>` 直达，本机没有时按 record 现存再进（跨设备）。
- 复习页：`hooks/useLessonRecord` → 材料卡（`components/review/LessonMaterialsCard`，时间轴顶部）+ 复习同桌附件层（`lib/review/lesson-materials-context`，走既有 `supportMaterials` 接缝）。来源特有动作（知乎「继续看」）以插槽塞进材料卡。
- 原文 vs 课：**课是主干，原文是附件**。测验考讲过的；没讲到的部分是「接着讲」，不是考题。

## 4. 边界：一次调用 = 一个场景 + 点名的依据 + 这个人 + 邻居的一句话

| 层 | 是什么 | 谁能进 | 预算 | 截法 |
|---|---|---|---|---|
| 场景（主干） | 此刻在对的那一个东西：这节课的转录 / 这篇文章 / 这组材料的条目单 | 永远只有一个 | ≤8K token | 按这一层自己的结构（转录留近舍远、文章按小节） |
| 依据（附件） | 场景所倚的材料：这节课点名的 1–4 篇（节选态，A1..） | 只有被这节课点名的 | ≤6K token（`LESSON_MATERIALS_CONTEXT_CAP` 9000 字） | 材料自己的节选预算；不够放从排后的只留标题 |
| 人 | 掌握轨迹 + Hindsight 召回 | 按场景过滤 / 按课题召回 top-k | ≤1.2K token | 条数上限 |
| 邻居 | 同一篇 / 同一组之前的课、同一门课别节 | 只进一行摘要（`priorLessons` / `lessonRecordDigestLine`） | ≤300 token | 条数上限 |
| 世界 | 搜索结果 | 只在「继续看」这一个动作里 | — | — |

硬规则：**不点名不进入**（能回答"谁把它放进来的"）；**每一层自己截自己**，层之间不互相挤；**跨场景只走物化摘要**；**每一块带标签**，模型引用时用标签（材料 A1 / 之前的课 / 你的记录）。

已按此实现的链：讲课（材料包 + 学生 + priorLessons 一行）、复习同桌（转录 + 材料附件 + 学生）、出题（只用转录）、继续看（只在这个动作里搜索，输入是这节课复习的交卷记录）。

### 现状里还在"混"的（赛后改造，按此契约）

1. 课程卡 unit ContextPack（`hooks/useCourseContextPack`）：≥2 节课有转录就全部展平喂应用——改为 digest 先行、按需拉一节。
2. 复习 Tutor 与应用矩阵按字数截（6 万 / 4.8 万字）——改为按层预算、按结构截。
3. teach-live 对话史逐轮累加（`trimHistory` 只按条数）——改为留近舍远 + 早轮 digest。
4. 问同学（global）跨课合并——改为检索一节再拉。

## 5. 治理：core 改动怎么落

- core 改动都是加法（新模块、可选 prop、一个 URL 参数、两个非索引字段），每个提交标 `[core]`，改到的共享文件 eslint warning 不新增（对比 HEAD 版本）。
- 合并前如需分开审，把 `[core]` 提交 cherry-pick 成独立分支 `feat/material-lessons-core`（从 `release/prod`），知乎分支叠在上面；合并顺序 core → 知乎。
- 归属：`teach-live/*` 与 `lib/db` 的物化归 teach-live 线；`lib/review` 与复习页插槽归复习线；`services/material-lessons` 是新目录，本线维护到合并。
