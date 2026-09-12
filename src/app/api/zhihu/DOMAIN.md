# api/zhihu/ —— 知乎线的薄壳路由（全部要 Bearer；middleware 默认鉴权）

> 逻辑在 `src/lib/services/zhihu/`（`DOMAIN.md` 有知乎接口的逐字段事实清单）。登录 / 绑定在 `api/auth/zhihu/`（公开路由）。
> 错误体固定 `{ success:false, error:<机器码>, message:<人话> }`：`zhihu_not_connected` 403 / `zhihu_reconnect` 401 /
> `zhihu_disabled` 503 / `zhihu_rate_limit` `zhihu_quota` 429 / `zhihu_upstream*` 502 / `*_not_found` 404 / `bad_request` 400。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/zhihu/status` | GET | `{ enabled, connected, mode: 'oauth'│'self'│null, expired, expiresAt }`——第一屏据此显示「连接知乎」还是「选一个收藏夹」；expired → 「重新连接知乎」 |
| `/api/zhihu/favlists` | GET | 当前用户的收藏夹（≤50，知乎无分页）+ `mode` |
| `/api/zhihu/import` | POST `{favlistUrlToken, limit?}` | 把一个收藏夹收进收集流：翻页拉全（≤100 条）→ 每条 `upsertCaptureForUser`（sourceType `zhihu-favorite`，sourceKey `zhihu:<uid>:<sha1(canonical)>`，摘要进正文位、provenance `partial`）；重复导入只更新。返回 `{ favlist, fetched, imported, captures[] }` |
| `/api/zhihu/materialize` | POST `{captureIds[≤30], force?}` | 按需抽正文（Firecrawl ≈1 credit / 条，并发 3）→ 去杂质 → 重新 upsert 成 `complete`；每条 `status: full│already-full│unsupported│failed`，失败留摘要并把原因写进 `metadata.zhihu` |
| `/api/zhihu/captures` | GET `?favlist=` | 已收进来的知乎收藏（含 `metadata.zhihu`：正文状态 / 作者 / 赞同 / 所在收藏夹 / 抽取失败原因） |

身份解析（`resolveZhihuIdentity`）：该用户绑定的 OAuth token 未过期 → 带 `X-OAuth-Token`；过期 → `zhihu_reconnect`（知乎无 refresh，只能重新授权）；
未绑定但在 `ZHIHU_SELF_MODE_USER_IDS` 白名单 → 「本人模式」读 Access Secret 所属账号（演示 / smoke 兜底）；其他 → `zhihu_not_connected`。

| `/api/zhihu/lesson` | POST `{favlistUrlToken? │ captureIds?, topic?, maxItems?}` | 把一个收藏夹开成一节 live 课：挑材料（按赞同，≤8 篇有正文可讲的）→ 只给进材料包的几篇抽正文 → 建 `engine=live` 的 TeachThread + 材料包落盘（`teach-live/live-materials.ts`）；learner 读槽与 `/api/teach/threads` 同款。返回 `{ thread:{id,title,topic}, pack, materialized }`；前端拿 thread.id 去 `/apps/zhihu/lesson/<id>` 开讲（首条学生消息「开始上课」由课堂页发，与 /teach/live 一致）。teach-live 未配置 503 `teach_live_unavailable` |
| `/api/zhihu/lesson/[threadId]` | GET | 这节课的材料包 + 线程元信息（课堂页右侧「这节课的材料」、课后出题 / 继续看用）；不是从收藏夹开的课 404 |

| `/api/zhihu/continue` | POST `{concepts[≤5], threadId?, topic?, perConcept?}` | 考后补货：还没稳的概念 → 站内搜索（每概念 1 次，≤3 次）→ 按权威 / 赞同 / 有反方评论排序，排除材料包里已有链接 → `{ groups:[{concept, candidates[]}] }`；检索失败返回空组不报错 |

讲完就考没有新路由：课堂页把材料包变成伪转录直接调既有 `/api/apps/execute`（quiz / flashcards），assessment 走既有 `/api/memory/events`。

## 页面（`src/app/apps/zhihu/`，逻辑在 `src/components/zhihu/`）

| 路径 | 组件 | 说明 |
|---|---|---|
| `/apps/zhihu` | `ZhihuEntry` | 桌宠 + 三步预期。未登录：知乎登录可用（`GET /api/auth/zhihu/status` 公开接口的 `oauthReady`）才给「用知乎登录」，否则只给「用 MeetMind 账号登录」（带 `?next=` 回跳）并说明原因——不给一颗点了会坏的按钮。已登录：连接 / 重新连接；已连接：收藏夹带状态（已收下几条 / 读了几篇全文 / 开过几节课 / 回到上次那节课）、「开课」三步进度真实可见（收下 → 同学读 → 开讲）；下面是「你开过的课」（`GET /api/zhihu/lessons`）。`isCheckingAuth` 期间不当未登录渲染，避免登录用户闪一下「去登录」 |
| `/apps/zhihu/lesson/[threadId]` | `ZhihuLesson` | 舞台原样复用 teach-live 的 `LiveStage` + `useLiveLesson`；进来先 `openLesson`，事件日志为空就替学生发「开始上课」。右侧可收起的**材料栏**（同学读了哪几篇 / 正文状态说人话 / 原文；「考一考 →」去课后页）。**老师讲完一轮那一刻**（`generating` 由真落假）右下长出小卡「讲完这一段了。考一考？／继续听」——机器 act，不让学生去找按钮 |
| `/apps/zhihu/lesson/[threadId]/review` | `ZhihuReview` | 课后三栏：左材料有根（每篇一段预览 + 原文）、中练习（`QuizWindow` / `FlashcardsWindow` 原组件，新增可选 `evidenceLabel` prop 把「回到课堂 mm:ss」换成「看这篇材料：A1《…》」，点开知乎原文）、右继续看（交卷 → assessment 进 `/api/memory/events` → 没稳的概念 → `/api/zhihu/continue`）。进来就自动出题（零提问）；手机按 练习 → 继续看 → 材料 竖排 |

共享：`useZhihuLesson`（材料包 / 伪转录 / 出题 / 交卷 / 继续看的状态，课堂页与课后页共用）、`ZhihuLessonPanels`（材料清单 / 继续看）、`zhihu-lesson-model`（纯函数）、`zhihu-api-client`（fetch 封装，错误统一 `ZhihuClientError`）。
文案 `src/lib/ui/copy-zhihu.ts`。验证：`make smoke-zhihu-lesson`（`SMOKE_BROWSER=chromium` 截第一屏 / 课堂 / 材料栏 / 课后 / 手机两张；`SMOKE_ZHIHU_SELF=1` 用白名单固定 id 让截图里出现真实收藏夹与「你开过的课」）。
