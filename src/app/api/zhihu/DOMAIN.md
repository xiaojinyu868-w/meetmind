# api/zhihu/ —— 知乎线的薄壳路由（全部要 Bearer；middleware 默认鉴权）

> 逻辑在 `src/lib/services/zhihu/`（`DOMAIN.md` 有知乎接口的逐字段事实清单）。登录 / 绑定在 `api/auth/zhihu/`（公开路由）。
> 错误体固定 `{ success:false, error:<机器码>, message:<人话> }`：`zhihu_not_connected` 403 / `zhihu_reconnect` 401 /
> `zhihu_disabled` 503 / `zhihu_rate_limit` `zhihu_quota` 429 / `zhihu_upstream*` 502 / `*_not_found` 404 / `bad_request` 400。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/zhihu/status` | GET | `{ enabled, connected, mode: 'oauth'│'self'│null, expired, expiresAt }`——第一屏据此显示「连接知乎」还是「选一个收藏夹」；expired → 「重新连接知乎」 |
| `/api/zhihu/favlists` | GET | 当前用户的收藏夹（≤50，知乎无分页）+ `mode` |
| `/api/zhihu/favlists/[urlToken]` | GET `?refresh=1` | **收藏夹页**的条目：每条标题 / 作者 / 类型 / 赞同 / 收藏时间 / 一行摘要（去 Markdown 杂质）/ 正文状态 / 开过的课；本地一条都没有或 `refresh=1` 时先 `importFavlist` 收进来 |
| `/api/zhihu/favlists/[urlToken]/themes` | GET `?force=1` | **同学读这个收藏夹**：按"放在一节课里讲得通"分成几条线（title / why / itemIds）+ 零散的 misc + 最值得先讲的 `start{itemId, why}`；一次 tutorQuick 调用，按条目集合 hash 缓存在 `data/zhihu-themes/<uid>/<token>.json`（`ZHIHU_THEMES_DIR`）；坏 JSON 退回一条线；≤1 篇可讲不叫模型 |
| `/api/zhihu/import` | POST `{favlistUrlToken, limit?}` | 把一个收藏夹收进收集流：翻页拉全（≤100 条）→ 每条 `upsertCaptureForUser`（sourceType `zhihu-favorite`，sourceKey `zhihu:<uid>:<sha1(canonical)>`，摘要进正文位、provenance `partial`）；重复导入只更新。返回 `{ favlist, fetched, imported, captures[] }` |
| `/api/zhihu/sync` | POST `{force?}` | 零动作入口：最近 50 条收藏（跨收藏夹）只新增本地没有的，摘要级；服务端 15 分钟节流 → `{ added, scanned, skipped:'throttled'│null }`。第一屏每次打开静默调，`added>0` 才说一句。没被节流的那次顺手把知乎画像写成一条学习观察（`zhihu-profile-service`，24 h 一次，fire-and-forget）；identity 不出服务端 |
| `/api/zhihu/materialize` | POST `{captureIds[≤30], force?}` | 按需抽正文（Firecrawl ≈1 credit / 条，并发 3）→ 去杂质 → 重新 upsert 成 `complete`；每条 `status: full│already-full│unsupported│failed`，失败留摘要并把原因写进 `metadata.zhihu` |
| `/api/zhihu/captures` | GET `?favlist=` | 已收进来的知乎收藏（含 `metadata.zhihu`：正文状态 / 作者 / 赞同 / 所在收藏夹 / 抽取失败原因） |

身份解析（`resolveZhihuIdentity`）：该用户绑定的 OAuth token 未过期 → 带 `X-OAuth-Token`；过期 → `zhihu_reconnect`（知乎无 refresh，只能重新授权）；
未绑定但在 `ZHIHU_SELF_MODE_USER_IDS` 白名单 → 「本人模式」读 Access Secret 所属账号（演示 / smoke 兜底）；其他 → `zhihu_not_connected`。

| `/api/zhihu/lesson` | POST | **课的单位（09-13 起）**：`{captureIds:[一条]}` 或 `mode:'single'` → 讲这一篇（全文 ≤12000 字直接给；再长按结构取到 8000 字并附小节目录）；`{captureIds:[2–4 条], topic, mode:'theme'}` → 一条线连着讲（每篇 ≤4000）；`{favlistUrlToken, auto:true}` → 随手开一节：用分线结果的 `start` 挑一篇，`pickReason` 进材料包与课堂页；`{favlistUrlToken}`（旧 favlist 模式，按赞同 ≤8 篇 1800/1200/700 节选）只作兜底 / smoke。都只给进材料包的几篇抽正文 → 建 `engine=live` 的 TeachThread + 材料包落盘（`pack.mode` / `pack.pickReason` / `pack.priorLessons`）；learner 读槽与 `/api/teach/threads` 同款。返回 `{ thread:{id,title,topic}, pack, materialized }`。teach-live 未配置 503 `teach_live_unavailable` |
| `/api/zhihu/lesson/[threadId]` | GET | 这节课的材料包 + 线程元信息（课堂页右侧「这节课的材料」、课后出题 / 继续看用）；不是从收藏夹开的课 404 |

| `/api/zhihu/continue` | POST `{concepts[≤5], threadId?, topic?, perConcept?}` | 考后补货：还没稳的概念 → 站内搜索（每概念 1 次，≤3 次）→ 按权威 / 赞同 / 有反方评论排序，排除材料包里已有链接，每组留 6 条候选池 → **快模型针对这个缺口挑 1–2 条并写一句只落在摘要里的理由**（`zhihu-continue-judge`；失败退回元数据理由）→ `{ groups:[{concept, candidates[]}] }`；检索失败返回空组不报错 |

讲完就考没有新路由：课堂页把材料包变成伪转录直接调既有 `/api/apps/execute`（quiz / flashcards），assessment 走既有 `/api/memory/events`。

## 页面（`src/app/apps/zhihu/`，逻辑在 `src/components/zhihu/`）

| 路径 | 组件 | 说明 |
|---|---|---|
| `/apps/zhihu` | `ZhihuEntry` | 桌宠 + 三步预期。未登录：知乎登录可用（`GET /api/auth/zhihu/status` 公开接口的 `oauthReady`）才给「用知乎登录」，否则只给「用 MeetMind 账号登录」（带 `?next=` 回跳）并说明原因——不给一颗点了会坏的按钮。已登录：连接 / 重新连接；已连接：收藏夹带状态（已收下几条 / 读了几篇全文 / 开过几节课），每行是**入口**（→ 收藏夹页；整夹一键开课已撤——一次讲 4 篇或 98 篇不成立）；下面是「你开过的课」（`GET /api/zhihu/lessons`）。`isCheckingAuth` 期间不当未登录渲染，避免登录用户闪一下「去登录」 |
| `/apps/zhihu/favlist/[urlToken]` | `ZhihuFavlist` | **收藏夹页**：先出条目（第一次打开顺手收进来），再出同学读出来的几条线（每条一句为什么 + 「按这条线开一节」），每篇一个「讲这篇 / 再讲一次」（正文状态、讲过几次、回到那节课），视频 / 想法归「零散的」并写明讲不了；顶部「随手开一节」= 同学挑最值得先讲的一篇并说为什么。分线没回来 / 失败时按收藏时间平铺，页面照样能用 |
| `/apps/zhihu/lesson/[threadId]` | `ZhihuLesson` | 舞台原样复用 teach-live 的 `LiveStage` + `useLiveLesson`；进来先 `openLesson`，事件日志为空就走 hook 的 `send('开始上课')`（generating 才真实）。右侧可收起的**材料栏**（同学读了哪几篇 / 正文状态说人话 / 原文）。**服务端讲完一轮**（generating 真→假）就把这节课存成「我的一节课」（`useLessonRecordSync` → IndexedDB）；**演完一轮**右下长出小卡「讲完这一段了。去复习 / 继续听」（演出卡住 90s 兜底出卡）；「去复习」= `/app?session=teach:<id>`，进 MeetMind 原来的复习页 |
| ~~`/apps/zhihu/lesson/[threadId]/review`~~ | — | **已退役（09-13）**：课后全部在复习页（材料卡 `components/review/LessonMaterialsCard` + 复习同桌附件层 + 知乎「继续看」`ZhihuContinueReading` 作插槽）。伪转录 / 假时间重标注一并删除 |

共享：`useLessonPack`（课堂页材料栏的材料包）、`ZhihuLessonPanels`（材料清单）、`ZhihuContinueReading`（复习页里的「继续看」：不传概念时服务端从这节课复习的交卷记录推）、`zhihu-api-client`（fetch 封装，错误统一 `ZhihuClientError`）。
文案 `src/lib/ui/copy-zhihu.ts`。验证：`make smoke-zhihu-lesson`（`SMOKE_BROWSER=chromium` 截第一屏 / 课堂 / 材料栏 / 讲完小卡 / 复习页 / 手机两张；`SMOKE_ZHIHU_SELF=1` 用白名单固定 id 让截图里出现真实收藏夹与「你开过的课」）。
