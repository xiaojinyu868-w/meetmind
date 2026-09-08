# Context — 用户的跨应用上下文服务

目标与产品边界见 `docs/plans/LEARNING_MEMORY_V1_SPEC.md`。本目录已实现 M1 服务代码；独立远端 Hindsight 0.9.2 已参与本地应用真实联调。主应用生产集成和 V1 尚未完成。新鲜验收以服务器交接文档为准。

## 边界

- 核心只表达用户、应用、空间、内容、来源和用户控制；教育信息通过观察适配器进入内容/metadata。
- 通用记忆提取、检索、综合与后台处理复用 Hindsight。MeetMind 保存原始事件、授权及可靠投递状态，不另写认知状态机。
- API → 本目录 → db/config/types；不依赖组件、浏览器状态或 Tutor prompt。
- `ContextEvent` 是原始观察及投递记录，`ContextGrant` 是用户创建的受限应用凭证；所有读取先验证用户和空间范围。
- 幂等回执也验证原始事件的空间权限，包括被忘记的墓碑；不能通过重新授权到另一个空间读取旧回执。
- owner JWT 登录需要明确配置 JWT_SECRET，未配置时本服务拒绝认证（避免旧认证服务空签名配置）；受限应用凭证不依赖 JWT 外形。
- 暂停/忘记先停止本地读取，再同步清理上游；原始观察不能冒充模型理解。

## 契约

| 文件 | 职责 |
|---|---|
| `validation.ts` | v1 输入校验与机器可读错误；结构限制资源与权限，不规定记忆分类 |
| `access.ts` | MeetMind 登录身份适配、空间/读写授权、散列保存的第三方凭证、过期和撤销 |
| `events.ts` | 原始事件与投递意图原子落库；用户+应用内幂等、冲突返回 409、分页读取 |
| `hindsight.ts` | Hindsight 0.9.2 HTTP 契约；用户+空间独立 bank；上游操作 UUID 幂等；不重写提取算法 |
| `dispatcher.ts` | 数据库租约、投递重试与上游 operation 状态映射；重启可续接 |
| `controls.ts` | 原始经历暂停/恢复/忘记；本地立即停止参考，上游清理完成前保留 cleanupPending |
| `prepare.ts` | 按任务调用 recall，校验完整来源链与最新可见性；输出预算内 ContextBundle，原始观察单独标识 |
| `http.ts` | 框架无关 HTTP 转换、请求体大小限制、错误码；所有响应 no-store |
| `education-adapter.ts` | 旧学习事件到通用原始观察的适配；角色、来源与不确定性保留在内容中，开关启用后仅写新存储 |
| `tutor-adapter.ts` | 灰度开启时向登录用户的 global Tutor 追加本轮相关证据；将最近一条 active 经历作为 afterEventId 保留，避免明确纠正被相似旧记忆挤掉；尊重 current-only，shared/访客/其他模式不读取 |
| `worker.ts` | `make context-worker` 常驻入口，加载 .env 后恢复数据库投递，SIGTERM 停止；单独由进程管理器运行 |
| `context.test.ts` / `sqlite-fixture.ts` | 从 Prisma 元模型创建隔离内存 SQLite，验证真实持久化、授权、来源、投递故障与 HTTP；上游响应是显式测试替身，不代表模型效果 |

HTTP POST 通过现有限流服务按真实用户聚合，不把应用 token 当独立消费额度；Next 外层另有限流保护。

教育适配器可接收可选 observation(type/content/locator)，用于保留测验完整题面、实际答案和观察条件；仍只表达开放内容，核心不解释题型或掌握状态。旧 payload 摘要用于未提供完整证据的生产者及灰度回退。

prepare 的 owner 默认空间为 personal，外部应用默认其授权空间；可显式收窄。来源链缺失、成环、被暂停/忘记或不在对应空间的模型理解会被排除。后端不可用时只返回预算内的近期原始观察，并明确 degraded/reason；不会伪造模型理解。

afterEventId 在远端检索后重新检查可见性，并优先占用文本预算；不受近期 12 条读取窗口影响。原文大于预算时仍返回来源句柄，可用 source(id) 继续读取。此参数不等待后台模型完成，也不能恢复被暂停或忘记的内容。

超时后仍使用同一个上游 operation ID。忘记与整理并发时，等上游操作终止再删 document；如果上游未能确认操作存在，清理保持待确认，不能报告已彻底清除。恢复须等清理完成，并使用新的操作 ID。

清理进度 `cleanupStage` 单独持久化：pending 等待整理终止；document_removed 表示原文及关联记忆已移除，再删除可能保留输入 payload 的终态 operation。每一步重启可恢复，HTTP 回执丢失不能跳过清理或提前报告完成。管理员安排的数据库/上游备份保留周期仍属于部署责任。

未尝试投递且没有执行租约的原始经历可立即暂停/恢复，无需后端可用。显式 retry 与 dispatcher 共用租约，避免刚清理完的失败任务被另一路重新排队。

配置来自 `src/lib/config/context.ts`；应用接入默认关闭，后端未配置不能宣称完成记忆整理。

`src/types/context.ts` 为纯类型入口。空间 ID 在用户内部有效，同名空间不能穿透用户隔离。应用身份从验证后的凭证派生，不能从事件 body 指定。

## 验证

最新来源优先的 Tutor 回归覆盖：旧召回文本占满预算时，最近的已完成纠正仍保留原文与来源。它只保护最近一条经历，不是完整的矛盾消解或纠正覆盖机制。

`make db-push` 生成数据模型；每组变更 `make check`，相关服务与接口测试使用 `make test`。
