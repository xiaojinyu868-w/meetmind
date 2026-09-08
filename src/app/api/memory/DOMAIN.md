# API: memory — 学习记忆事件入口（P0 事件化）

Context 开启后复用新服务的 owner 认证，包括 JWT_SECRET 配置检查、账户有效性与拒绝第三方凭证；第三方仅使用 /api/context/v1，不能借此入口冒充内部应用。

应用矩阵 useAppLearningActivity 也提交 activity 事件：保留应用摘要、课堂 sessionId 与 appKey。测验通过 observation 附加完整作答证据，其他应用当前摘要最多 240 字；不能把摘要当成未经压缩的学习现场。

请求可附加 observation: `{ type, content, locator? }`。CONTEXT_ENABLED 开启时保存这份完整内容（最多 40000 字符）及定位，不走 240 字摘要截断；未提供时仍适配旧 payload。关闭时旧服务只消费 payload，忽略扩展。此扩展不能指定 userId/appId/space，身份及归属仍由服务决定。

2026-09 Context 接入：`CONTEXT_ENABLED=true` 时本路由同步调用教育观察适配器，将带角色的原始对话/学习活动落入通用 ContextEvent 后返回 202 `{ ok, eventId, jobId, status, duplicate, backend: 'context' }`，不再同时写旧 LearningEvent 或触发旧画像蒸馏。身份仍来自用户登录，服务另检查账户有效状态；后续由 `make context-worker` 投递上游。开关默认关闭。历史旧数据不自动迁移。

> 事件表（prisma `LearningEvent`）是学习者画像的唯一写入口。写入方只发事件；
> 蒸馏与合并由服务端 `src/lib/services/learning-event-service.ts` 完成，
> `learnerProfileJson` 是物化视图（仍保留 24 条上限）。事件全量留史，可回放重建。

## 文件索引

| 文件 | 职责 |
|------|------|
| `events/route.ts` | `POST /api/memory/events`：Bearer 鉴权（同 `/api/auth/learner-profile` 的 verifyToken 写法，未登录 401——访客一期不进服务端记忆）+ `applyRateLimit('tutor')`；落事件后 fire-and-forget 触发 `triggerLearningEventProcessing`，立即返回 `{ ok, eventId }` |

## 请求契约

```jsonc
{
  "appId": "global-ask",            // 来源应用：global-ask | classroom | wechat | teach...
  "type": "confusion",              // confusion | mastery | error | preference | progress | activity
  "payload": {                      // 契约见 src/types/learning-event.ts，含版本字段 v
    "v": 1,
    "userText": "…",                // 对话类事件（confusion/mastery/error/preference/progress）
    "assistantText": "…"
    // activity 事件：{ v:1, kind, title, detail?, sessionId?, appKey? }
  },
  "sourceId": "conv-1",             // 可选，业务对象ID（溯源）
  "idempotencyKey": "global-understanding:conv-1", // 可选，撞 unique 静默返回已有事件
  "occurredAt": "2026-09-05T08:00:00.000Z"         // 可选，缺省取服务端当前时间
}
```

响应：`{ ok: true, eventId }`；校验失败 400，未授权 401。

## 边界

- **不动** `/api/tutor/memory`（保留给访客蒸馏）与 `/api/auth/learner-profile`（用户本人操作的特权通道：IntentDialog bio/目标卡、设置页 stage）。
- 事件类型注册表在 `src/types/learning-event.ts`；新增类型先登记类型，再在 learning-event-service 实现处理。
- 服务端观察器范例：课后理解完成 → `activity` 事件（`lesson-understanding-service.ts`，`lesson-understanding:{captureId}` 幂等）。微信 / teach 观察器留 P0.5。
