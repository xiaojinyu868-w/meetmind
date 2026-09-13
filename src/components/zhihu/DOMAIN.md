# components/zhihu/ —— 知乎线前端（表现 + 交互）

> 页面壳在 `src/app/apps/zhihu/`；用户面文案 `src/lib/ui/copy-zhihu.ts`。
> API 契约与错误码以 `src/app/api/zhihu/DOMAIN.md` 为准；本目录不 import `lib/services/`（类型可从服务层 `import type`）。
> 后端 / OAuth / `material-lessons` 默认不动。改 UI 的会话读完本页再读源码。

## 旅程（用户看到的）

用知乎登录 → 选一个收藏夹 → 同学分成几条线 → 讲一篇或一条线 → live 舞台讲完一轮 → 去复习页考 / 看材料 / 继续看知乎原文。

课的单位是**一篇或一条线**，不是整个收藏夹。讲完物化成「我的一节课」，复习走 `/app?session=teach:<id>`（与录音课同一页）。

## 文件

| 文件 | 职责 |
|------|------|
| `ZhihuEntry.tsx` | `/apps/zhihu` 第一屏。三态：未登录 / 已登录未连接或过期 / 已连接（收藏夹入口 + 你开过的课）。`isCheckingAuth` 期间不当未登录渲染。打开已连接时静默 `sync` 最近收藏。 |
| `ZhihuFavlist.tsx` | `/apps/zhihu/favlist/[urlToken]`。先出条目（第一次打开顺手收进来），再出分线；分线未回时按时间平铺且**仍可「讲这篇」**。顶部「随手开一节」。视频 / 想法进「零散的」。 |
| `ZhihuLesson.tsx` | `/apps/zhihu/lesson/[threadId]`。复用 `teach-live` 的 `LiveStage` + `useLiveLesson`；空日志则代发「开始上课」。右侧可收起材料栏。讲完一轮：`useLessonRecordSync` 写入 IndexedDB，右下小卡「去复习 / 继续听」。 |
| `ZhihuLessonPanels.tsx` | 材料清单：预览、正文状态说人话、原文链接。 |
| `useLessonPack.ts` | `GET /api/zhihu/lesson/[threadId]`；20s 超时给人话 + 再试一次。 |
| `ZhihuContinueReading.tsx` | **复习页插槽**：按交卷记录推没稳的概念去知乎搜；没交过卷说「先做一套题」。不出现在课堂页主路径。 |
| `zhihu-api-client.ts` | 浏览器 fetch 封装；错误统一 `ZhihuClientError { code, message, status }`。 |

页面壳（勿把逻辑写回 page）：

- `src/app/apps/zhihu/page.tsx` → `ZhihuEntry`
- `src/app/apps/zhihu/favlist/[urlToken]/page.tsx` → `ZhihuFavlist`
- `src/app/apps/zhihu/lesson/[threadId]/page.tsx` → `ZhihuLesson`

迷你课后页 `/apps/zhihu/lesson/[threadId]/review` **已退役**（G11）。

## 本线相邻、动到才算范围

| 文件 | 何时动 |
|------|--------|
| `src/components/review/LessonMaterialsCard.tsx` | 复习页材料卡的视觉 / 交互 |
| 复习页宿主里挂 `extra={<ZhihuContinueReading />}` 的那一处 | 「继续看」出现时机与版式 |
| `src/lib/ui/copy-zhihu.ts` | 所有用户可见句；组件只 `import { ZHIHU_COPY as C }` |

舞台本体在 `src/components/teach-live/`——本线只包一层，不要顺手改 Director / 板书渲染，除非交互节奏必须从壳上传参。

## 交互不变量（破了用户会觉得「坏了」或「Demo」）

- 不给点了会坏的按钮（OAuth 没就绪就不要「用知乎登录」）。
- 失败态诚实：token 过期 / 只有摘要 / 空收藏夹 / 额度用完 / 上游忙，文案在 COPY 里已有。
- 分线加载是**增强**不是门闩：条目先可点「讲这篇」。忙碌态要看得出在忙，不要无反馈、也不要误禁用整页。
- 「考一考 / 去复习」在讲完一轮之后长出，不要进课堂就催。
- 用户面字符串不写死在 JSX。

## 视觉（v7）

纸感底、pine 主按钮、vermilion 只给「此刻」、`shadow-card`、少叠卡片。第一屏三种状态用层次说话，不要三种仪表盘。移动端 smoke 有手机截图，改布局时对照。
