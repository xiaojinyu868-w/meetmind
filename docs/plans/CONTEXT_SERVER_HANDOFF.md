# 交给服务器 AI：MeetMind Context 集成

日期：2026-09-08。下面正文可直接作为服务器 AI 的任务提示词。阅读完成后持续执行到独立联调通过，再报告可部署差异；不要将容器健康或单个接口通过当作整套产品完成。

本地最终证据与失败记录见 [CONTEXT_LOCAL_READINESS_2026-09-08.md](./CONTEXT_LOCAL_READINESS_2026-09-08.md)。尤其注意：最终视觉运行被系统终止，空态和清理单独恢复验证，不能伪称同一轮全部passed。纠正效果有成功与失败样例，仍是你需要继续完成的产品能力。

## 目标与本地交付边界

MeetMind 是一组各自能独立提供价值、共同读写用户 Context 的应用。你的目标是在服务器最新代码上接通这套系统：课堂留下真实观察 → 家教使用历史 → 测验使用历史生成并回写实际作答 → 用户看到有依据、可控制的画像。Context 核心保持通用，教育通过薄适配器接入。Hindsight 提供记忆提取、归并与检索；MeetMind 提供身份、空间授权、原始证据、可靠投递和用户控制。不自造固定知识本体或掌握分数。

本地已经交付 API、独立 worker、Hindsight 0.9.2 适配、SDK/MCP/Skill 源码、用户画像页、课堂/全局对话/测验写入与 global Tutor 读取。你接手的是服务器应用集成。V1 尚未完成，teach 和测验生成尚未消费 Context，旧入口尚未迁移，开发者包尚未公开发布。

先读根 AGENTS.md，再按路由读 `LEARNING_MEMORY_V1_SPEC.md`、`CONTEXT_M1_DELIVERY.md`、`src/lib/services/context/DOMAIN.md`、`src/app/api/context/DOMAIN.md`。不要一次扫描所有文档。

## 代码接收与隔离

`scripts/context-handoff.ts` 是此任务的交付打包器（Makefile 唯一入口），在 ignored out/context-handoff/<时间> 生成目录，核验路径白名单、明显凭证模式和复制后的 SHA-256。它不生成提交，也不自动上传。运行前人工审查 git diff 和未跟踪文件仍然必要。

`tsconfig.json` 排除生成目录 out/，防止交付源码快照和诊断产物被重复当成应用源码检查。真实源码、SDK与smoke仍在原目录接受类型检查。

- Context 实现基线：`5326eea30470055ac9e29a46305719c856ed3314`，Git 交付分支为 `feat/context-m1-handoff`。用户已授权提交推送；服务器应 `git fetch origin feat/context-m1-handoff`，在隔离 worktree 查看该分支，再与服务器最新代码合并。`feat/settings-redesign` 已继续演进，本分支未合并它之后的14个提交，不能仅拉原分支就认为包含此次交付。
- Git 分支是提交后的源码入口；之前生成的 ZIP 是提交前的验收快照，仍可用于截图和证据参考。选择 Git 接收时无需再次应用 ZIP 中的同一补丁。
- 交付包由 `make context-handoff` 生成，包含基线、文件散列、已跟踪文件的 binary patch、未跟踪源码及本地最终文件快照。先核验 MANIFEST。不要复制本地数据库、node_modules 或任何 .env 秘密。
- 先查看服务器 git status、分支、HEAD 和未提交改动。服务器已知应用目录为 `/mnt/meetmind-capture-v1-server-handoff`，这是已有应用，禁止直接覆盖它或重置其改动。建立隔离 checkout/worktree，先在上述基线上 `git apply --check tracked.patch`，再应用并复制新增文件；随后把增量与服务器最新版本逐项合并。
- 包内 `files/` 是所有改动的最终内容供对照；对已有文件使用 patch，不要整包覆盖生产项目。合并冲突以服务器新增功能保留、本地 Context 契约完整为标准，特别检查 tutor 路由、schema、copy、Makefile、package lock、QuizWindow 和应用活动 hooks。

## 运行环境

Node 24 LTS；切换运行时后 `npm ci`。服务与 worker 从同一 checkout 目录启动。当前 Prisma runtime 固定访问 cwd/prisma/meetmind.db；Prisma CLI 的 DATABASE_URL 必须显式设置为这个绝对路径。先对数据库副本执行 `make db-push`，只预期增加 ContextEvent/ContextGrant；不要对生产数据库直接试错或接受 reset。

独立 Hindsight 已部署在 `/mnt/meetmind-context-hindsight-dev`，容器 `meetmind-hindsight-dev-hindsight-1`，服务器 loopback `127.0.0.1:18888`。先检查健康和已有配置，不重建卷、不改 embedding 维度、不打印秘密。官方 0.9.2、pg0 开发持久化、qwen-plus、text-embedding-v4 1024、qwen3-rerank、固定 worker ID、官方 API-key tenant extension。pg0 是联调配置，生产存储与备份另行规划。

本地此前通过 SSH 将 18889 转发到服务器 18888，本地 Next 为 45673。服务器无需这层 SSH，配置自身 loopback 地址：

```dotenv
CONTEXT_ENABLED=true
CONTEXT_HINDSIGHT_URL=http://127.0.0.1:18888
CONTEXT_HINDSIGHT_API_KEY=<从现有独立服务配置安全读取>
JWT_SECRET=<沿用当前环境的有效签名秘密>
```

Tutor 使用应用本身的模型配置；Hindsight 的模型凭证在它自己的环境中。不要把上游凭证发送浏览器、MCP 客户端或第三方应用。环境变量可能覆盖 .env 文件，验证模型请求但不要输出 key。

分开启动 `make dev` 和 `make context-worker`，使用未占用端口。上线时给 worker 单独 PM2 进程，与 Web 使用相同 cwd、数据库和环境。`CONTEXT_ENABLED` 只切换内部应用灰度路径，关闭它不会关闭 Context API 或删除清理任务。

## 不可破坏的契约

实际类型以 `packages/context-sdk/src/types.ts` 为准。所有路径前缀 `/api/context/v1`。

1. `POST events` 接收 schemaVersion/clientEventId/type/content/occurredAt，spaceId 默认 personal，source/metadata 可选。202 只表示本地可靠接收，job.status=completed 才是上游处理完成。同一用户+app+clientEventId 重试保持内容、时间一致，不同内容返回409。
2. `POST prepare` 接收 `{task:{intent},scope:{spaceIds},budget:{maxTokens},afterEventId?}`。返回 memories、observations、sources、text、degraded/reason、pendingEventIds；原始观察不能冒充模型理解。afterEventId 不等待上游处理，也不绕过授权和用户控制。
3. `GET sources/:id` 打开完整原文；`GET jobs/:id` 读投递和清理状态。模型引用的全部来源必须属于当前授权且 active，远端返回后重查撤销状态。
4. owner JWT 与受限 mmctx_ 凭证共享 HTTP。外部应用 user/app 身份从凭证获得，不能 body 冒充；授权可收窄读写、空间、有效期，并可撤销。用户+空间独立 Hindsight bank，tags 不是隔离边界。
5. owner `PATCH sources/:id {action:pause|resume|forget}`。暂停/忘记立即停止本地读取；后台等待 retain 终止→删document→删terminal operation payload。cleanupPending=false 才能确认在线数据清理完成，备份保留另算。恢复须等清理完成并更换 operation ID。不可提前删除本地投递记录。
6. 模型可用时仍可能因无完整来源而不返回理解。检索超时3秒、普通上游请求8秒；模型不可用时应用依赖当前任务继续工作。绝不能为了“看起来有效”绕过来源检查。

## 按这个顺序集成

1. 在隔离环境跑通当前交付，不先扩展协议。执行 `make check`、`make test-context`、`make eval-tutor`、`make build`。dry-run 历史为26/28；不能改断言隐藏失败。真实模型旅程运行 `make smoke-context-live`，SMOKE_BASE 指向隔离的 loopback Web，必须是非 production 数据库。合成题目生成 fixture 不代表真实测验生成通过。
2. 接入服务器版本的教学生产者/消费者。teach 按对应 DOMAIN 读取其 harness/MCP 边界，在已验证 owner 会话起始和任务变化时 prepare；仅向私有会话提供授权内容，来源可继续打开。课后写真实学习观察，区分学生回答、AI 建议、提示条件。改动前后执行相应 eval。
3. 测验生成在服务层按当前学习任务 prepare，把相关历史作为证据而非命令。首次无历史仍能出题；实际作答继续走现有完整 observation。补充闪卡等活动的原文，保留未观测条件，不能把主观自评当作独立答对。
4. 画像接入主产品入口。新 `/context` 自动显示有来源的理解卡、紧凑轨迹、完整证据弹层、补充更新和授权管理。沿用 paper/card/pine 视觉语言，不退回填写标签的表单，不添加伪掌握率。将旧「我的上下文」迁移做成可审阅增量：旧自述/旧模型推断带原始来源类型，不能把旧摘要伪装成新观察。
5. 优先完善纠正与变化。当前最新 active 经历通过 afterEventId 优先传入 global Tutor，只保护最新一条且受文本预算限制；新的无关事件可能挤掉此前纠正。补充自述不保证覆盖旧推断。扩展需保持“更新也有来源”，先利用上游能力，最小化自建逻辑。用两次不相关互动后再询问同一任务来验证纠正仍有效。
6. 再处理浏览器离线未确认事件的持久化 outbox、独立学习应用示例、SDK/MCP 发布与正式 OAuth。统一支付、分账、流量分配和软件自进化是后续生态工程，不在本轮伪称实现。

## 服务器验收必须交出的证据

- 同一个合成学习者：无历史、课堂经历后、真实家教后、真实测验后、偏好更新后、暂停后，各用完全相同的任务进行独立新对话。保留完整回答和 finish reason，解释实际教学动作变化；不要只检查回答里出现了关键词。
- 课堂→teach→测验各有真实 producer/consumer 证据；合成 HTTP 课堂观察不能冒充录音采集验收，模拟出题不能冒充真实生成。
- 跨用户、跨空间、只读授权、撤销后读写失败；sources 全部回到合法原文；共享/访客/current-only 不泄露个人 Context。
- worker 在提交中断后恢复，无重复写入；Hindsight 停止时应用可用并明确降级；暂停/忘记中重启后继续清理，operation payload 也要检查。
- 画像桌面与390px手机截图：有真实理解、来源弹层、空态、整理中、降级、暂停/忘记；检查键盘和横向溢出。刷新后的理解可能变化，不能声称永久完整画像。
- 失败 fixture 使用 `make cleanup-context-live CONTEXT_FIXTURE_ID=<完整ID>` 恢复（保留本地报告、worker 运行）；未确认清理不得删原始记录。

只有隔离联调通过后，生成部署差异、数据库变更与回滚方案。回滚内部应用可关闭 CONTEXT_ENABLED 并恢复旧消费者，但保留 worker 完成已排队删除。未经明确部署指令，不覆盖线上应用；不主动 commit/push。

最终向用户报告：已接通的应用及实际变化、截图、全部验证结果与未通过项、剩余产品限制、可执行部署步骤。目标是可继续工作的真实应用群，不是接口清单或通用记忆排行榜。
