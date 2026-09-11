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
| `/apps/zhihu` | `ZhihuEntry` | 三种状态各一句人话：未登录（用知乎登录 / 用 MeetMind 账号登录）→ 已登录未连接 / 已过期 / 未开放 → 已连接（收藏夹列表，每个一颗「开课」= 导入 → 抽正文 → 跳课堂页，三行进度）。授权回来的 `?zhihu=` / `?zhihu_error=` 提示一次就从地址栏清掉 |
| `/apps/zhihu/lesson/[threadId]` | `ZhihuLesson` | 舞台原样复用 teach-live 的 `LiveStage` + `useLiveLesson`；进来先 `openLesson`，事件日志为空就替学生发「开始上课」；右侧可收起的栏三页：材料（同学读了哪几篇 / 正文状态 / 原文）、考一考（测验 / 闪卡：`zhihu-lesson-model` 把材料包变伪转录喂既有 `/api/apps/execute`，`QuizWindow` / `FlashcardsWindow` 原样复用，「回到原话」= 打开知乎原文）、继续看（交卷后 assessment 进 `/api/memory/events`，没稳的概念 → `/api/zhihu/continue`）|

文案 `src/lib/ui/copy-zhihu.ts`；浏览器端 fetch 封装 `components/zhihu/zhihu-api-client.ts`（错误统一 `ZhihuClientError{code,message,status}`）。
验证：`make smoke-zhihu-lesson`（不需知乎凭证：合成账户 → 3 条正文完整的收藏 → 开课 → 老师口播命中材料概念 → 伪转录出题 → continue → 清理；`SMOKE_BROWSER=chromium` 截三张图）。

