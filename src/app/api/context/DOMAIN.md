# Context v1 HTTP

独立的通用 Context API。路由仅限流和转交 `services/context/http.ts`，后者接收标准 Request/Response，不依赖 Next。

所有接口须 `Authorization: Bearer <MeetMind access token 或 mmctx_ 应用凭证>`，身份来自凭证。原文、检索结果与授权响应一律 no-store。写入/检索/授权复用 Tutor 速率限制；来源、任务状态和控制请求使用通用速率限制，避免后台轮询消耗模型预算；第三方凭证在外层按 IP 限流，部署多实例应配置现有 Redis 限流服务。

POST 写入/检索/授权还在认证后按真实 userId 聚合限流，多个应用 token 或变换 IP 不能扩大同一用户的模型调用额度；来源读取与控制仍受外层限流。429 为 rate_limited。配额和支付尚未产品化为开发者收费方案。

middleware 对 `/api/context/v1/*` 仅跳过 JWT 外形检查，实际认证仍由服务强制执行；不能扩大为整个 `/api/context/*` 的匿名访问。

| 路径（前缀 /api/context/v1） | 方法 | 契约 |
|---|---|---|
| `/events` | POST | ContextEventInput → 202 `{ eventId, jobId, status, duplicate }`；重复但内容不同 409 |
| `/events?cursor=&spaceId=` | GET | `{ events, nextCursor }`，每页最多 50 条；owner 可见暂停记录和遗忘墓碑 |
| `/prepare` | POST | ContextPrepareInput → UserContextBundle；无后端时 degraded=true，仅返回原始观察 |
| `/sources/:id` | GET | `{ event }`，读取权限内原始经历 |
| `/sources/:id` | PATCH | owner 专用 `{ action: pause/resume/forget }` → `{ event, cleanupPending }` |
| `/jobs/:id` | GET | `{ jobId, eventId, status, visibility, cleanupPending, errorCode }` |
| `/jobs/:id/retry` | POST | owner 重试终止失败的上游 operation → 202 `{ jobId }` |
| `/grants` | POST | owner 创建 ContextGrantInput → 201 `{ grant, token }`；token 仅本次返回 |
| `/grants` | GET | owner 列出 `{ grants }`，永不返回 token 或散列 |
| `/grants/:id` | DELETE | owner 撤销 → `{ revoked: true }` |

prepare.afterEventId 优先返回该次写入的可见原始经历；超过文本预算时保留 sources 句柄。不等待整理完成，也不绕过暂停、忘记或授权范围。

类型真相源 `src/types/context.ts`，输入校验 `services/context/validation.ts`。错误为 `{ error: { code } }`；401 未认证/过期/已撤销，403 超范围，404 不存在或无权查看的资源，409 幂等冲突/清理中，413 请求体超过 192KB。第三方不可创建授权、控制记忆、访问上游 bank/密钥。

接入不代表已完成 V1：当前是原始经历、记忆检索、授权与来源控制的服务闭环，尚未替换旧「我的上下文」界面。运行后台投递使用 `make context-worker`；上游 Hindsight 部署与模型配置单独维护。

`/api/context/v1/learner-context`（POST，静态段，优先于 catch-all）是「这个学习者」读契约事实半的参考接口（LearningEvent assessment → 掌握状态 + 画像；
Bearer = MeetMind JWT，learnerId 以 token 为准），不属于上表的通用 Context v1 契约；理解半（Hindsight 召回）由服务端 `resolveLearnerContext` 经
`services/context/learner-understanding` 补齐，原文仍走上表 `/sources/:id`。
