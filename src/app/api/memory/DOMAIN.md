# API: memory — 学习记忆事件入口（P0 事件化）

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
