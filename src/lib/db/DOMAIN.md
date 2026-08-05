# DB — 客户端 IndexedDB 数据层

> 基于 Dexie.js 的本地数据库。所有客户端持久化数据都在这里。
> 服务端数据库用 Prisma + SQLite（schema 在 `prisma/schema.prisma`）。

## 依赖规则

```
hooks/services → lib/db → types
```

- ✅ `hooks/` 和 `services/` 可以调用 `lib/db/`
- ❌ `lib/db/` 不能 import `components/`, `hooks/`, `stores/`

## Schema（12 张表）

定义在 `schema.ts`：

| 表名 | 主键 | 用途 |
|------|------|------|
| `audioSessions` | `id` | 录音会话 |
| `anchors` | `id` | 课堂锚点：`confusion` 表示待解决困惑，`important` 表示课中主动记下的回看点；`sourceAnchorId/updatedAt/sourceMutationId` 为非索引跨设备合并字段，不要求 Dexie 升版 |
| `transcriptSegments` | `id` | 转录段落 |
| `highlightTopics` | `[sessionId+topicId]` | 精选片段 |
| `classSummaries` | `sessionId` | 课堂摘要 |
| `notes` | `id` | 个人笔记；`sourceMutationId` 是非索引跨设备 LWW 字段，不要求 Dexie 升版 |
| `conversationHistories` | `id` | 对话历史；课堂绑定记录用非索引 `sourceMutationId` 参与跨设备 LWW，不要求 Dexie 升版 |
| `conversationMessages` | `id` | 对话消息 |
| `preferences` | `key` | KV 偏好存储 |
| `transcriptLexicon` | `term` | 转录专用词库 |
| `tutorResponseCache` | `cacheKey` | Tutor 响应缓存 |

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `schema.ts` | 312 | Dexie DB 定义 + 表类型 + 版本迁移 |
| `sessions.ts` | 136 | 会话 CRUD |
| `conversations.ts` | ~195 | 对话历史 CRUD；创建方显式传入时间戳，保证本地记录与上行 mutation 使用同一版本 |
| `lexicon.ts` | 209 | 转录词库管理（种子/CRUD/编辑差分→自动晋升） |
| `notes.ts` | ~90 | 笔记 CRUD；允许服务层写入版本时间与 mutationId，保证本地与 outbox 使用同一版本 |
| `tutor-cache.ts` | 69 | Tutor 响应缓存 |
| `transcripts.ts` | 71 | 转录段落 CRUD；批量落库成功会把对应 audioSession 标记为转录完成 |
| `highlights.ts` | ~65 | 精选片段 CRUD；课后理解使用事务整批替换，同轮空结果也会清理过期精选 |
| `summaries.ts` | ~70 | 摘要 CRUD；按 sessionId 幂等更新最新摘要，并清理历史重复行，避免重跑课后理解后仍读到旧结果 |
| `anchors.ts` | ~45 | 锚点 CRUD；课中「记一下」复用 `important` 类型；新增时立即补稳定 `sourceAnchorId`，重载后不改变云端身份 |
| `keyframes.ts` | ~50 | 课中「截取这一页」关键帧 CRUD（v8 新表，timestampMs 与转录同轴，上传后回写 mediaUrl） |
| `preferences.ts` | 24 | 偏好 KV 存储 |
| `classroom-flows.ts` | ~40 | 按 sessionId 保存录课中已生成的课堂脉络，供课后应用矩阵直接复用，不在下课后重复生成 |
| `index.ts` | 98 | barrel 导出 |

## 登录归属合同

- 游客课堂先以 `anonymous` 保存在 IndexedDB，登录迁移由 `workspace-local-migration-client.ts` 发往当前账号 Workspace。
- 只有 `/api/workspace/local-migration` 将该 `sessionId` 返回在 `acceptedSessionIds` 后，客户端才在同一个 Dexie 事务中把 `audioSessions.userId`、`transcripts.userId`、`notes.studentId` 与课堂 `conversationHistory.userId` 认领给当前账号。
- `failed`、网络中断、结果缺失或计数矛盾都不改变本地归属；已经属于其他真实账号的行永不覆盖，从而避免同一浏览器后续登录另一个账号时重复迁移。
