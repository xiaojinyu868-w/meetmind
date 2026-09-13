# zhihu/ —— 知乎开放平台接入（知乎登录 · 收藏夹进收集流 · 收藏夹开课 · 知乎搜索补货）

> 北极星：`docs/plans/2026-09-12-zhihu-line.md`。这条线独立部署在 `zhihu.meetmind.online`（分支 `feat/zhihu-hackathon`），
> 与生产同库同数据目录，`ZHIHU_ENABLED=false` 时对产品零影响。
> 本文件前半是「知乎到底给了什么」的事实清单（契约事实源：官方 zhihu skill v0.2.1 的 `references/{http-api,user-api,oauth}.md`，
> 2026-07 核验；线上形状以 `make smoke-zhihu` 实测为准），后半是本目录服务的边界。

## 一、知乎给了什么：全部只读

### 鉴权（所有 developer.zhihu.com 接口通用）

`Authorization: Bearer <Access Secret>` + `X-Request-Timestamp: <秒级 Unix 时间戳>`（+ GET 也带 `Content-Type: application/json`）。
Access Secret 在 developer.zhihu.com/profile 自助申请，一个账号最多 20 个、共享同一额度池、拥有完整权限、删除不可恢复。
业务错误经常包在 **HTTP 200** 里：外层 `{Code, Message, Data}`，`Code≠0` 即失败——`0` 成功 / `10001` 参数 / `20001` 鉴权 /
`30001` 频率 / 并发 / **当日额度耗尽**（官方 2026-09 资料三者都报它；停止重试，去免费的额度查询看剩多少）/ `30002` 当日配额耗尽（该能力全账号不可用）/ `90001` 内部错误。

**额度查询** `GET /api/v1/quota?APIIDs=zhihu_search,global_search,…`（不耗额度）。**我们这把 Secret 是低额度档（未实名 / 未提额）**，2026-09-13 实测每天：站内搜索 10 · 全网搜索 10 · 热榜 2 · 问题回答摘要 10 · 用户数据 1000 · 创作 10 · 直答 2 · 知识库 500 · 小工具 2。
所以：搜索结果进程内缓存 6 h、出网前先看预算（`zhihu-discovery-service` 的 `searchBudget`）、情报补货默认不占搜索额度（`ZHIHU_FEED_SEARCH=1` 才开）、smoke 默认不跑 continue（`SMOKE_WITH_SEARCH=1`）。提额要去 developer.zhihu.com 做实名 / 申请，代码里不能解决。

### 内容接口（额度 = 邀测免费额度 / 天）

| 接口 | 端点 | 入参约束 | 返回（原字段名） | 额度 |
|---|---|---|---|---|
| 站内搜索 | `GET /api/v1/content/zhihu_search` | `Query` 必填；`Count` 1–10（≤0 回默认 10，>10 截到 10） | `HasMore`（固定 false）/ `SearchHashId` / `EmptyReason?` / `Items[]`：`Title` `ContentType`（Answer / Article…首字母大写）`ContentID` `ContentText`（**摘要**，`<em>` 高亮）`Url`（带 utm）`CommentCount` `VoteUpCount` `AuthorName`（匿名 = 知乎用户）`AuthorAvatar` `AuthorBadge` `AuthorBadgeText` `EditTime`（秒）`CommentInfoList[{Content}]`（精选评论）`AuthorityLevel`（字符串 "1"–"4"：低 / 中 / 高 / 超高）`RankingScore` | 5,000 |
| 全网搜索 | `GET /api/v1/content/global_search` | `Count` 1–20；`Filter`（`host=="x.com"`、`publish_time>=<秒>`，`AND`/`OR` 大写，可加括号；**不能**用 host 限定 zhihu.com）；`SearchDB` all / realtime / static | 同上（无 RankingScore 保证） | 5,000 |
| 热榜 | `GET /api/v1/content/hot_list` | `Limit` 1–30（越界回 30） | `Total` / `Items[]`：`Title` `Url` `ThumbnailUrl`（可空串）`Summary`（可空串）；只有问题与文章两类 | 100 |
| 直答 | `POST /v1/chat/completions` | 只保证 `model` / `messages` / `stream` 三字段；`model` ∈ `zhida-fast-1p5` / `zhida-thinking-1p5` / `zhida-agent`；多轮 messages 只有前两档支持 | OpenAI Chat Completions 形状（含 `reasoning_content`）；流式 SSE 有 `: keep-alive` 心跳；错误是 `{error:{message,type,param,code}}` | 100 |

### 用户数据接口（同一组接口两种身份）

不带 `X-OAuth-Token` = **Access Secret 所属账号本人**（演示与 smoke 的「本人模式」）；带 `X-OAuth-Token: <用户 OAuth access_token>` = 该授权用户。
全部 `GET`；分页接口用 `Offset` / `Limit`，响应 `Paging{IsEnd, NextOffset(字符串!), Totals}`，下一页把 `NextOffset` **原样**回传为 `Offset`；
`NextOffset` 不是十进制数字串按协议错误处理，不静默截断。用户接口额度**未公布**。

| 接口 | 端点 | 入参 | `Items[]` 字段 |
|---|---|---|---|
| 我的创作 | `/api/v1/user/contents` | `ContentType` **必填** all / answer / article / zvideo / pin / question；`SortField` like_count / ts；`SortOrder`；`Limit` ≤50 | `ContentType`（**小写**）`Url` `CreatedAt` `LikeCount` `CommentCount` `FavoriteCount` `Title` `Summary`（摘要） |
| 我的关注 | `/api/v1/user/followees` | `Offset` / `Limit` ≤50 | `Fullname` `UrlToken` `Url` `AvatarUrl` `Headline` `Gender`（0 未知 / 1 女 / 2 男）`FollowerCount` |
| 收藏夹列表 | `/api/v1/user/favlists` | `Limit` ≤50；**无分页，服务端忽略 Offset** | `UrlToken`（Int64，查内容时回传）`Url` `Title` `Description` `IsPublic` |
| 收藏夹内容 | `/api/v1/user/favlist_contents` | `FavlistUrlToken` 必填；分页 | 创作字段 + `FavTime`（收藏时间）+ `Favlists[{UrlToken,Title,Url}]` + `Author?{Name,UrlToken,Url,Gender,Headline}`（下游没给就没有） |
| 近期收藏 | `/api/v1/user/collections` | `Limit` ≤50；**无 Offset 无 Paging**，只是最近一批 | 同收藏夹内容 |

### OAuth（`openapi.zhihu.com`；黑客松版 2026-09-13 定稿）

官方定位：**OAuth 只为"知乎作第三方登录 + 读授权用户的信息"**；只调通用接口、只看自己的数据，用 Access Secret 即可——这正是「本人模式」成立的官方依据。

**凭证从哪来（黑客松）**：活动页 <https://www.zhihu.com/hackathon?activity_code=zhihu_hackathon_2026_p2> → 我的项目 → 队伍详情 → **创建项目**（作品提交入口 9-13 10:00 开放后可建），填项目名 / 赛道 / 介绍 / Demo 地址 / 产品说明 / icon / 封面 /（选）仓库 / 视频 / **知乎登录回调地址** → 赛事页面分配 **App ID + App Key**，**不走通用邮件申请**。回调地址填 `https://zhihu.meetmind.online/api/auth/zhihu/callback`，协议 / 域名 / 路径 / 尾斜杠要与代码里的 `ZHIHU_OAUTH_REDIRECT_URI` 逐字一致。App Key 只在服务端 `.env`。

1. 授权页 `GET /authorize?redirect_uri=&app_id=&response_type=code&state=`
2. 回调 `{redirect_uri}?authorization_code=…&state=…`（参数名是 `authorization_code`，兼容 `code`；**黑客松 OAuth 服务承诺 `state` 原样透传**——我们据此**没回传 state 就拒绝**（`state_not_returned`），回传了必须等于 cookie 里签过的 nonce；通用文档里"实测不回传 state"是老记录，不适用）
3. 换 token `POST /access_token`，表单 `app_id` / `app_key` / `grant_type=authorization_code` / `redirect_uri` / `code`（承载回调里的 authorization_code）→ `{access_token, token_type, expires_in: 3600}`，可能包在 `data` / `Data` 里，业务码 `20000` = 成功；无 refresh
4. `GET /user`，**只带 `Authorization: Bearer <OAuth access_token>`**（不带 Access Secret / X-OAuth-Token / 时间戳）→ `{uid(int64), hash_id, fullname, gender, headline, description, avatar_path, url: openapi.zhihu.com/users/<uid>, email, phone_no, phone}`；`uid` 可能超过 JS 安全整数，客户端读原文先把它加引号再 `JSON.parse`（`quoteBigIntFields`）。稳定身份 = `hash_id` → `uid:<uid>` → 主页链接。用户不存在的历史形态：HTTP 200 `{"code":404,"data":"User don't exist"}`
5. 授权用户的创作 / 关注 / 收藏仍走 developer.zhihu.com 用户数据接口（Bearer Access Secret + `X-OAuth-Token` + 时间戳）；本人全文 / 评论 / 统计只支持 Secret 本人，不能用 X-OAuth-Token 切身份
6. 缺：scope、PKCE、撤销 / 解绑、拒绝授权回调、过期错误协议

### 明确没有的（所有方案都得绕着走）

**正文**（三类接口都只有摘要 → 正文靠抓页面，Firecrawl 对回答 / 专栏实测 4/4 拿到全文）；**写接口**（不能代发回答 / 评论 / 收藏 / 关注）；
**他人数据**（只有本人或授权用户）；**问题详情 / 某问题下的回答列表 / 某用户公开主页**。CLI 只有 macOS / Windows 包，服务器直接打 HTTP。

### 页面结构（Firecrawl `onlyMainContent` Markdown，2026-09-09 实测）

回答页（短链 `/answer/<id>` 与规范链 `/question/<q>/answer/<a>` 同形）：logo → [话题链接]* → `# 问题标题` → 问题描述`显示全部` → 关注者 / 被浏览 / 登录墙（"登录后你可以 不限量看优质回答…"）→
`[查看全部 N 个回答](问题链接)` → 作者卡（`[![名](头像)](people)` → `[名](people)` → 签名 → `​关注`；匿名只有 `![匿名用户]` + `匿名用户`）→ **正文** →
`[编辑于 YYYY-MM-DD HH:MM](回答链接)・地区` / `阅读全文` → `​赞同 N​​M 条评论` → 分享 / 收起 / 查看全部。
专栏页：`![](专栏自链)`? → logo → `![标题](封面)`? → **正文** → [话题链接]* → `​赞同 N​​M 条评论` → 申请转载 → `关于作者` → 作者卡。
正文里两类链接要处理：直答实体链接 `[词](https://zhida.zhihu.com/search?…)` 只留词；外链 `https://link.zhihu.com/?target=<urlencoded>` 解包。

## 二、本目录

| 文件 | 职责 | 不变量 |
|---|---|---|
| `zhihu-open-client.ts` | 上表全部端点 + OAuth 三步的类型化客户端；字段归一 camelCase、字符串数字转数字；`fetch` / 时间源可注入 | 直连 HTTP 不依赖 CLI；`Code≠0` 一律抛 `ZhihuApiError`（kind：param / auth / rate_limit / quota / server / network / timeout / protocol / oauth，`retryable` 只对 network / timeout / server 为 true）；日志只记 endpoint 与错误码，**不记 query、凭证、响应正文**；缺 Access Secret 不出网 |
| `zhihu-page-clean.ts` | 抓回来的回答页 / 专栏页 / 问题页去杂质，纯函数 | 找不到结构标记就走保守清洗并 `confident=false`，导入层据此标注"正文可能含页面杂质"，**不装干净**；正文以外的元数据（作者 / 编辑时间 / 赞同 / 评论）只从页脚取 |
| `zhihu-auth-service.ts` | 知乎 OAuth 登录 / 绑定：`beginZhihuOAuth`（nonce + 绑定用户 + 回跳路径 HMAC 签进 cookie）、`completeZhihuOAuth`（cookie 对账 → 换 token → `/user` → bound / logged_in / error 三种 outcome，路由层据此 302）、`getZhihuIdentityForUser`（导入层取该用户的 OAuth token 与过期状态）、`unlinkZhihu` | 知乎实测不回传 state → CSRF 靠 cookie 对账，回传了就顺带比对；稳定身份 = `/user` 主页链接的 url_token，**拿不到只允许绑定不允许登录**（否则每次授权长出一个新用户）；token 3600 s 无 refresh，过期如实说「重新连接知乎」不静默降级；零 schema 改动（token 存现有 `AuthProvider(provider='zhihu')`，types/user.ts 的 `AuthProvider` 联合类型加了 `'zhihu'`） |
| `zhihu-import-service.ts` | 收藏夹 → 收集流：`resolveZhihuIdentity`（oauth / 本人模式 / reconnect / not_connected）、`listFavlistsForUser`、`importFavlist`（翻页 ≤100 条 → 每条 `upsertCaptureForUser`）、**`syncRecentCollections`**（最近 50 条跨收藏夹只新增本地没有的，摘要级，进程内 15 分钟节流；零动作入口）、`listZhihuCaptures`、`materializeCaptures`（按需抽正文 + 去杂质 → 重新 upsert 成 complete；并发 ≤5） | sourceKey = `zhihu:<uid>:<sha1(canonical URL)>`（同一用户同一条收藏只一行；`upsertCaptureForUser` 还会按 canonical URL 合并用户以前手动贴过的同一条）；导入只有摘要 → `provenance.contentState='partial'` + `metadata.zhihu.body='summary'`，正文真用到才抽；同步**不覆盖**已物化全文的；抽不到留摘要并把失败写进 `metadata.zhihu.extractFailedAt/extractError`，不装满；视频 / 想法不抽（无可讲正文）；OAuth 过期报 reconnect 不静默切本人模式 |
| `zhihu-lesson-service.ts` | 收藏夹 → 一节 live 课：`selectLessonMaterials`（按赞同排序、只留回答 / 文章 / 问题、≤8 篇，其余进 skipped 并写明原因）→ 只给进包的几篇 `materializeCaptures` → `buildMaterialPack`（前 3 篇 ≤1800 字、接着 1200、其余 700；只有摘要的 ≤400 字并标 summary）→ `createThread(engine='live')` + `writeLiveMaterials`（记 `ownerUserId`）；`listLessonsForUser`（我开过的课）。**节选按结构取**（`excerptOf`）：有 ≥2 个小标题时 = 开头一段 + 每个小标题及首段 + 结尾一段，标「中间略」，预算剩得多再把各节第二段补上；否则从头切按句号收尾 | Firecrawl credit 只花在进材料包的几篇上；课题默认取收藏夹名（可显式指定）；本目录不 import teach-live 内部，只认识它的 `LiveMaterialPack` 通用形状；节选是给老师的材料不是给学生的正文，宁可每节短也要带骨架和结论 |
| `zhihu-discovery-service.ts` | 知乎搜索 → 「继续看」候选：`searchZhihuCandidates`（去 `<em>`、canonical 去重与排除、按分排序）、`continueReading`（考后每个没稳的概念搜一次 ≤3 次，`poolSize` 留候选池，跨概念不重复）、`scoreZhihuItem` / `reasonFor`（只用知乎给的信号：权威等级 ×1.5 + log10 赞同 + 有精选评论，人话理由）。消费方：`feed-retrieval-service` 的并列 provider（今日情报补"不同视角 / 亲历者"）、`/api/zhihu/continue` | 检索失败宁可少推（返回空不抛，产品论点 §5）；站内搜索 30001 / 30002 时退到全网搜索只留 zhihu.com 链接；未配置 Secret 零开销；query <2 字不出网 |
| `zhihu-continue-judge.ts` | 「继续看」的真判断：`judgeContinueReading` 让快模型（`ModelDefaults.tutorQuick`）读每组候选摘要，针对这位学生刚没稳的那个概念挑 1–2 条、写一句理由；`buildJudgePrompt` / `applyVerdict` 纯函数可测 | 理由只能落在摘要里有的内容上（prompt 明说，不复述标题）；坏 JSON / 超时（12 s）/ 候选 <2 → 退回元数据理由不阻断；一个概念一次调用几百 token；不改入参 |
| `zhihu-profile-service.ts` | 知乎画像 → 个人上下文冷启动：收藏夹名 / 最近收藏 / 关注的作者 / 自己写过的 → `buildZhihuProfileObservation` 一条事实清单（有来源、无判断、≤900 字）→ `recordLearningObservation` 双写 activity 事件（最近学习现场）+ `zhihu.profile` 观察（Hindsight，供 Tutor / teach / 应用矩阵 prepare 召回）；由 `/api/zhihu/sync` 未被节流那次 fire-and-forget | 24 h 一次（进程内）、幂等键按天；子接口失败只少一段，全空不写；永不 throw；只写本人授权数据，永不进分享态 |
| `*.test.ts` | 客户端夹具测试（官方文档响应示例）+ 去杂质夹具（实测页面结构逐行还原）+ OAuth 状态签名与四种 outcome 的注入测试 + 导入 / 物化的注入测试（翻页、去 utm、partial→complete、失败留痕）+ 开课的挑材料 / 预算 / 编排测试 + 发现服务的评分 / 去重 / 补货分组测试 | 夹具是文档与实测的快照；线上形状变了先改 DOMAIN.md 再改夹具 |

配套：`src/lib/config/zhihu.config.ts`（五个 env，`redirectUri` 非 https 启动即报错）；`tests/smoke/smoke-zhihu.ts`（`make smoke-zhihu`，只读、不起服务、本人模式真实请求 + 抽一条正文）。

客户端纯模型 `src/components/zhihu/zhihu-lesson-model.ts`：材料包 → 伪转录（每段正文一个 segment，220ms/字铺时间轴，过 readiness 门；「回到原话」映射成回到知乎原文）、`/api/apps/execute` 请求体、考后「哪没稳」概念提取、`relabelTimeReferences`（应用矩阵 prompt 是课堂口吻，解析里的假时间「0:07-0:21 明确指出」渲染前换成「材料 1《…》明确指出」；只改字符串不碰 citations / actions）。prompt 层的来源无关化留给 ai-native 主干（`app-prompts-practice.ts` 是 product-polish 线热区）。
路由层：`src/app/api/zhihu/DOMAIN.md`（status / favlists / import / sync / materialize / captures / lesson / lessons / continue）。

## 三、边界

- 依赖方向：`app/api/zhihu | app/api/auth/zhihu → services/zhihu → lib/config, lib/logger, lib/db`；本目录**不 import** teach / ai-native / feed 的内部——材料包由 API 层组装后递给消费方，不让接入层反向依赖消费方。
- 隐私：知乎导入的收藏、创作、关注、画像全部是**个人上下文**——默认私有，永不进 `SharedAgent` 快照，分享态不带。
- 安静：同步 / 导入不弹通知，不催；同学读完以回声形式出现。
- 有根 + 诚实：每条材料带来源（平台 / 作者 / 发布时间 / 收藏时间 / 赞同 / 权威等级）；正文状态三档（只有摘要 / 正文完整 / 正文可能含杂质）如实标注；只有摘要时 AI 不猜原文。
- 成本：Firecrawl ≈1 credit / 页，一个用户几百条收藏，所以正文**按需**抽（开课 / 情报真用到才抽），不整夹全抽。
- 直答不进主循环（低额度档一天 2 次）；热榜一天 2 次，结果必须缓存；搜索一天 10 + 10 次——所有搜索走缓存 + 预算门，情报补货默认不占。
- OAuth token 1 小时且无 refresh：所有需要用户身份的同步都在用户在场时触发；过期如实提示「重新连接知乎」，不静默切到本人模式。
