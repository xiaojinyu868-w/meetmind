# material-lessons — 「从材料开一节课」能力层（2026-09-13）

> 与来源无关：知乎收藏、B 站收藏、口袋收下的网页、PDF，先映射成 `MaterialCandidate` 再进来。本目录不 import 任何来源目录；来源目录只 import 这里的类型与函数。
> 契约与三层架构：`docs/plans/2026-09-13-material-lessons.md`。

## 文件

| 文件 | 职责 | 不变量 |
|---|---|---|
| `material-candidate.ts` | `MaterialCandidate`（id / 标题 / 作者 / url / 体裁 / 正文 / 摘要 / 有无全文 / 赞同 / 收藏时间 / 一行元信息）、`MaterialKind` 与标签、`isTeachableKind` | 视频 / 想法不可讲，只留在收集流；正文空串 = 连摘要都没有 |
| `material-lesson-planner.ts` | 课的单位 `LessonMode`（single 一篇 / theme 一条线 / collection 整组兜底）；`selectNamed`（保持点名顺序）/ `selectByRank`（按赞同 ≤8）；预算 `excerptFor`（single 全文 ≤12000 直接给、再长按结构取到 8000 并附 `outlineOf` 目录；theme 每篇 4000；collection 1800/1200/700；摘要 400）；`excerptOf` 按结构取（开头 + 各小节首段 + 结尾，预算有余轮着补后续段）；`buildPack` → `LiveMaterialPack` | 节选是给老师的材料不是给学生的正文，宁可每节短也要带骨架和结论；collection 在包里写作旧名 `favlist`（前端 / 已落盘的包都认） |
| `material-themes.ts` | 同学读一组材料：`themesForCollection(userId, collectionKey, title, candidates)` 一次 tutorQuick 调用 → 几条线（title / why / itemIds）+ misc + 最值得先讲的 `start`；`buildThemePrompt` 编号代替 id 防幻觉、`normalizeThemes` 对回真实 id（一篇只属一条线、未知编号丢、没归线的进 misc、start 必须可讲）；按条目集合 `themesHash` 落盘缓存 `data/material-themes/<uid>/<collectionKey>.json`（`MATERIAL_THEMES_DIR`，兼容旧 `ZHIHU_THEMES_DIR`） | 坏 JSON / 超时退回"一条线 = 全部可讲"+ 赞同最高的当起点；≤1 篇可讲不叫模型；不抓正文 |
| `next-reading-judge.ts` | 「接下来看哪一篇」的真判断：`judgeNextReading(groups, ctx, describe)` 让快模型读候选摘要，针对这个学生刚没稳的概念挑 1–2 条并写一句只落在摘要里的理由；来源用 `describe(candidate)` 把自己的信号翻成 kindLabel / signals / comments | 坏 JSON / 超时 / 候选 <2 → 退回元数据理由不阻断；一个概念一次调用几百 token；不改入参 |

## 来源怎么接（以知乎为例）

`services/zhihu/zhihu-material-candidate.ts`：capture → `MaterialCandidate`（轻模块，不 import 服务）；`zhihu-lesson-service.ts` / `zhihu-theme-service.ts` / `zhihu-continue-judge.ts` 只剩映射与转发。新来源照此写三个薄壳即可，第一屏与课堂 / 复习页不需要知道来源。

## 边界

- 依赖方向：`app/api/* → services/<来源> → services/material-lessons → teach-live/live-materials（类型）, llm-service, config, logger`。
- 上下文边界：能力层的每个函数只处理调用方**点名**的那组材料；不读收集流、不读别的课。跨课的信息只以 `LiveMaterialPack.priorLessons`（一行一节）进材料包。
- 不在这里：抓正文（来源方的 materialize）、课的物化（`teach-live/lesson-record.ts`）、复习附件层（`lib/review/lesson-materials-context.ts`）。
