# `src/app/api/share/` — Domain

> v3.0 SharedAgent 的公开 / 创建 / 领取 / 埋点接口。
>
> 设计文档：`roadmap/v3.0-virality-agent.md`
> 业务逻辑：`src/lib/services/share-agent-service.ts`

## 目的

这是 MeetMind 的**裂变接口面**。一个学生录完课、想把这节课分享给班里其他人时，前端走这里创建一个 `SharedAgent`；班级里的其他人凭 token 落地 `/share/[token]`，可以读 / 对话 / 领取 / 再分享，全部背靠这层。

本目录下的所有路由都是**薄壳**——只做 zod parse、auth check、限流、转发到 `share-agent-service`。

## 路由清单

| 路由 | 鉴权 | 用途 |
|---|---|---|
| `POST /api/share/agent` | ✅ Bearer | 创建一个 SharedAgent（snapshot 在 body 里） |
| `GET /api/share/[token]` | ❌ 公开 | 读取 share 的公开形态（隐藏 owner 信息） |
| `DELETE /api/share/[token]` | ✅ Bearer (owner) | 撤销分享，幂等；非 owner 一律 404 |
| `POST /api/share/[token]/track` | ❌ 公开 | 写埋点（view / chat / reshare） |
| `POST /api/share/[token]/claim` | ✅ Bearer | 领取 share 到访问者 workspace |
| `GET /api/share/me` | ✅ Bearer | 列出当前用户创建的所有分享（含撤销，最近 50 条） |

## 请求 / 响应契约

### `POST /api/share/agent`

```ts
// 请求体
{
  snapshot: SharedAgentSnapshot, // 见 share-agent-service.ts SharedAgentSnapshotSchema
  sourceSessionId?: string,
  conversationEnabled?: boolean,  // 默认 true
  visibility?: 'public' | 'unlisted',
}

// 响应
{
  success: true,
  token: string,        // 12 字符 URL-safe
  shareUrl: string,     // 完整公网链接，已经走 resolvePublicBaseUrl()
  conversationEnabled: boolean,
}
```

**关键约束**：
- snapshot 永远不带原作者的 chat history / 学习者画像 / 个人层应用产物
- transcriptDigest.segments 限制 ≤ 80 段、单段 ≤ 2000 字（见 schema）
- artifactKind 受控集合，不能塞任意值

### `GET /api/share/[token]`

```ts
// 响应（404 当 share 不存在 / revoked / 过期；不区分以避免泄露存在性）
{
  success: true,
  share: PublicSharedAgent  // 隐藏 ownerId / workspaceId / interactions
}
```

副作用：自动写一条 `view` interaction（不阻塞响应）。

### `POST /api/share/[token]/claim`

```ts
// 响应
{
  success: true,
  captureId: string,         // 在 claimer workspace 里创建的 WorkspaceCapture id
  alreadyClaimed: boolean,   // 幂等：之前领过则返回 true
  workspaceId: string,
}
```

幂等：同一 (shareId, claimerUserId) 多次 claim 始终返回同一个 captureId。

## Tutor agent 集成

`/api/tutor/agent` 在 `mode === 'shared'` 时：
1. 必带 `shareToken` 字段
2. 走 `getSharedAgentInternal(token)` 加载 snapshot（会校验 conversationEnabled / status）
3. 用 `buildTutorSystemPrompt('shared', context)` 拼 prompt
4. **禁用 native tools**（防止泄露原作者的 sessionId / transcript）
5. 不读取 / 不写入访问者本地的 conversation 历史

## 隐私铁律

- **不暴露 ownerId / workspaceId**：`PublicSharedAgent` 类型故意不带这些字段
- **不暴露原作者对话历史**：snapshot 是 share-time 刻一份，原作者后续修改不影响
- **不注入访问者画像到分享态 prompt**：`buildTutorSystemPrompt` 在 shared 模式下显式跳过 `learnerProfile`
- **匿名访问允许**：view 和 chat 不要求登录；claim 才需要

## 文件清单

| 文件 | 行数 | 职责 |
|---|---|---|
| `agent/route.ts` | ~110 | POST 创建 SharedAgent |
| `[token]/route.ts` | ~110 | GET 公开读 + view 埋点；DELETE 撤销（仅 owner） |
| `[token]/track/route.ts` | ~75 | POST 显式埋点（chat / reshare） |
| `[token]/claim/route.ts` | ~75 | POST 领取到 claimer workspace |
| `me/route.ts` | ~45 | GET 列出当前用户创建的所有分享 |

## 依赖

- `@/lib/services/share-agent-service` — 核心业务逻辑
- `@/lib/services/auth-service` — Bearer token 校验
- `@/lib/services/workspace-service` — 默认 workspace 管理
- `@/lib/services/media-tooling#resolvePublicBaseUrl` — 构造分享 URL
- `@/lib/utils/rate-limit` — 共用 'tutor' bucket
- `@/lib/logger` — track + structured log

## 不在这里做

- **创建 snapshot 内容**：客户端组装，服务端只校验 + 存档
- **业务规则演化**：所有"什么能分享 / 怎么算 viral"的逻辑都在 `share-agent-service`
- **UI 渲染**：见 `src/app/share/[token]/`（落地页）和 `src/components/share/`（创建器 / 卡片）
