# 知乎线：用知乎登录 → 选一个收藏夹 → 开成一节课（2026-09-12 起）

> 写给产品负责人与接手的 agent。契约事实在 `src/lib/services/zhihu/DOMAIN.md`；本文写目标、边界、分组、部署形态与进度。
> 起因是知乎黑客松 2026 校园新锐季（9/13 10:00–9/15 10:00 开发冲刺，赛道「知识炼金场」），但每一组都按"赛后留在产品里"的标准做。

## 一句话

**用知乎登录，选一个收藏夹，同学把它开成一节课；讲完就考，考完告诉你哪没稳，再把你送回知乎上讲得最清楚的那条。**
比赛交的是这条旅程；赛后留在产品里的是三样东西：知乎登录（降低登录墙）、收藏夹进收集流（零动作的第二条收集入口）、知乎搜索进今日情报（有权威分级的中文经验型证据）。

## 为什么借知乎（产品层判断，详见 09-08 新生方案 §2.5 与本线讨论）

1. 收藏是学生本来就在做的"收下"动作，只是收进了坟场——OAuth 一次，收集线多一条持续的、带学习意图的输入，用户零动作。
2. 创作 + 收藏夹（夹子名就是主题）+ 关注 = 一份由真实行为产生的学习者画像，解决"第一次它不懂我"（78% 首会话一分钟内离开）的冷启动。
3. 一个收藏夹就是一节课：不录课的学生也有课可上（"录课是小众心智"）。这是应用输入来源无关化（09-08 §2.5 步骤 1）的第一块样板。
4. 知乎搜索给中文、有作者、有权威分级、有赞同数、有精选评论（天然反方）的亲历者经验，正好补今日情报"不同视角"那一格。
5. 知乎登录是当前 4 访客/天量级下最便宜的获客；黑客松的曝光与产研对接是一次性的但真实的门。

**不借**：直答当模型智能（100 次/天、不可控）；做知乎阅读器；把知乎做成频道 / tab（它是来源证据，进同一条流同一套记忆）；代发内容。

## 旅程七步 = 分层（每步：现成的 / 要写的）

| 步 | 用户看到 | 现成 | 要写 |
|---|---|---|---|
| 1 用知乎登录 | 一个按钮，跳知乎授权页，回来已登录 / 已绑定 | `AuthProvider(provider, providerId, accessToken, expiresAt)`；微信登录的会话绑定模式 | `/api/auth/zhihu/start` `callback`；`zhihu-auth-service`（cookie HMAC nonce 补知乎不回传 state 的缺口；已登录 = 绑定，未登录 = 登录；`/user` 给不出稳定身份就先只做绑定） |
| 2 选一个收藏夹 | 收藏夹列表（名字 / 条数 / 公开与否） | — | `zhihu-open-client`；`GET /api/zhihu/favlists` |
| 3 同学读一遍 | "已收下 N 条，正在读" | `WorkspaceCapture`（`sourceKey` 唯一键 / `sourceUrl` / `metadataJson`）；`web-article-extract-service`（Firecrawl，知乎实测 4/4） | `zhihu-import-service`：canonical URL 去 utm 作 `sourceKey`；摘要先进、正文状态标「只有摘要」；正文按需抽 + `zhihu-page-clean` |
| 4 开课 | Live 舞台：板书 + 口播 + 可打断；讲到分歧点名出处 | teach-live（三代引擎；codex / engine 两线将废弃）；线程创建时存 `learnerJson`、会话建立时拼「关于这位学生」 | `POST /api/teach/threads` 可选 `materials`（物化到 `data/teach-materials/<threadId>.json`）；teach-live 拼 learnerFacts 的同一处多拼「材料」段（每条 `[A1]` 标题 / 作者 / 权威 / 赞同 / 正文节选；从材料讲、点名分歧、引用 `[A1]`） |
| 5 讲完就考 | 测验 / 闪卡 | `/api/apps/execute` 直接吃 `input.transcript` | 伪转录适配器：材料 → 带 `sourceId` 的段落；"回到原话"映射为"回到知乎原文"。真正的 `LearningSource[]` 赛后与 product-polish 线对齐再做 |
| 6 哪没稳 | 一句话 | assessment 双写 + `LearnerContext` 读槽 | 零 |
| 7 继续看 | 2–3 条知乎原文卡，带"为什么是它" | `feed-retrieval-service` provider 结构 | `zhihu` provider（`zhihu_search`，`sourceScore` 吃权威 / 赞同）；考后按"没稳"概念出「继续看」 |

第一屏：独立 `/apps/zhihu`（三步），文案 `copy-zhihu.ts`；三种失败态诚实：token 过期 → 「重新连接知乎」；正文没抽到 → 「按摘要讲」；收藏夹为空 → 说明。

## 接缝（多会话并行下最要紧的一节，`docs/RELEASE_FLOW.md`）

- **独占、零冲突**：`services/zhihu/`、`api/zhihu/`、`api/auth/zhihu/`、`app/apps/zhihu/`、`config/zhihu.config.ts`、`copy-zhihu.ts`、`tests/smoke/smoke-zhihu.ts`。
- **只追加**：`.env.example`、`AGENTS.md` §3/§4、`RELEASE_FLOW.md` 目录表、`CHANGELOG.md`、`Makefile`、`ecosystem.config.js`、`scripts/deploy.sh`（参数化 APP / PORT / 目录）。
- **零改动**：`schema.prisma`（nonce 走 cookie、材料走文件、token 存现有表）。
- **要对齐**：teach-live 的材料注入（settings-redesign 会话的活跃线；改动是加法：一个可选字段 + 一处拼接）；ai-native 来源无关化留赛后（product-polish 正在里面动刀）。

## 部署形态：独立子域名试用，再决定怎么合

`zhihu.meetmind.online` → nginx → `127.0.0.1:3012` → PM2 `meetmind-zhihu`（cwd `/mnt/meetmind-zhihu`，分支 `feat/zhihu-hackathon`）。
与生产**同库**（`DATABASE_URL` 绝对路径）**同数据目录**（`data/` `public/uploads` 等软链到主目录，同生产做法），所以用户用同一个账号在两个域名都能登录；
本线零 schema 改动，共库安全。旁路构建 + 原子切换复用 `scripts/deploy.sh`（`MEETMIND_PROD_DIR` / `MEETMIND_APP_NAME` / `MEETMIND_PORT` 参数化），`make deploy-zhihu`。
`ZHIHU_*` 只写在 `/mnt/meetmind-zhihu/.env`；生产 `.env` 不动。合并进 `release/prod` 与否由产品负责人试用后决定。

## 分组与验证门

| 组 | 内容 | 验证门 | 状态 |
|---|---|---|---|
| G1 接入 | 客户端 + 去杂质 + config + smoke | `make check`；`npx vitest run src/lib/services/zhihu`（35 例）；`make smoke-zhihu`（凭证到手后） | 代码完成，待凭证 live 验证 |
| G2 身份 | OAuth 路由 + auth service | 路由 / nonce 单测；部署后本人真实授权 | — |
| G3 导入 | 收藏夹 → capture；按需正文 | 单测；smoke 扩展：导入 → 二次导入零重复 → 抽三条 → 状态迁移 → 清理 | — |
| G5 开课 | 材料包 + teach-live 材料段 | teach-live 现有测试全绿 + 材料段单测；真实收藏夹开课彩排 | — |
| G6 考 + 补货 | 伪转录适配 + zhihu provider + 继续看 | 单测；一轮真实产物核对"回到知乎原文" | — |
| G7 第一屏 | `/apps/zhihu` + 文案 + 失败态 | 浏览器 smoke 截图 | — |
| 上线 | PM2 + nginx + 证书 + `make deploy-zhihu` | `/api/health` + 静态 chunk 抽样 + 子域名走通旅程 | 需 DNS A 记录 |

## 风险与兜底

凭证晚到 → 本人模式（Access Secret 所属账号即演示账号，产品逻辑不改）。teach-live 注入对不齐 → 材料作为线程首条上下文由本线路由直接调 service 注入。
正文抽不到 → 摘要 + 「正文未取到」；演示收藏夹提前预热。内存（15GB，dev 4–6GB，build 峰值 7GB）→ build 前 `free -m`，不与他人并发。
直答 / 热榜额度 → 不进主循环。规则不允许已有底座 → 一页 disclosure，git log 为证。token 一小时 → 登录即导入并缓存，过期如实提示。

## 决策记录

- 2026-09-12：讲课只走 teach-live（codex / engine 将废弃）；知乎线独立子域名上线试用后再决定合并；G1–G7 一路做完。
- 2026-09-12：赛前不改 ai-native 主干（另一会话正在动），用伪转录适配器保完成度，`LearningSource[]` 赛后做。
- 2026-09-12：零 schema 改动（cookie nonce / 文件材料 / 现有 AuthProvider），避开多会话对 `schema.prisma` 的串行约束。
