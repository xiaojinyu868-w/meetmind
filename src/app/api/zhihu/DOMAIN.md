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

后续（G5–G7）：`/api/zhihu/lesson`（材料包 → teach-live 开课）、`/api/zhihu/continue`（考后弱概念 → 知乎搜索「继续看」）。
