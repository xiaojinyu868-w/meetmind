# DB — 客户端 IndexedDB 数据层

> 基于 Dexie.js 的本地数据库。所有客户端持久化数据都在这里。
> 服务端数据库用 Prisma + SQLite（schema 在 `prisma/schema.prisma`）。

## 依赖规则

```
hooks/services → lib/db → types
```

- ✅ `hooks/` 和 `services/` 可以调用 `lib/db/`
- ❌ `lib/db/` 不能 import `components/`, `hooks/`, `stores/`

## Schema（14 张表）

定义在 `schema.ts`：

| 表名 | 主键 | 用途 |
|------|------|------|
| `audioSessions` | `id` | 录音会话 |
| `anchors` | `id` | 困惑锚点 |
| `transcriptSegments` | `id` | 转录段落 |
| `highlightTopics` | `[sessionId+topicId]` | 精选片段 |
| `classSummaries` | `sessionId` | 课堂摘要 |
| `notes` | `id` | 个人笔记 |
| `conversationHistories` | `id` | 对话历史 |
| `conversationMessages` | `id` | 对话消息 |
| `preferences` | `key` | KV 偏好存储 |
| `transcriptLexicon` | `term` | 转录专用词库 |
| `tutorResponseCache` | `cacheKey` | Tutor 响应缓存 |
| `lessonDigests` | `sessionId` | 课堂笔记缓存（v9 新表，signature = 段数+末段 endMs+图片 id 集合，签名一致时复用不打 LLM） |

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `schema.ts` | 312 | Dexie DB 定义 + 表类型 + 版本迁移 |
| `sessions.ts` | 136 | 会话 CRUD |
| `conversations.ts` | 240 | 对话历史 CRUD + `reassignConversationOwner`（anonymous → 登录用户的归属迁移） |
| `lexicon.ts` | 209 | 转录词库管理（种子/CRUD/编辑差分→自动晋升） |
| `notes.ts` | 87 | 笔记 CRUD |
| `tutor-cache.ts` | 69 | Tutor 响应缓存 |
| `transcripts.ts` | 71 | 转录段落 CRUD；批量落库成功会把对应 audioSession 标记为转录完成 |
| `highlights.ts` | 43 | 精选片段 CRUD |
| `summaries.ts` | 40 | 摘要 CRUD |
| `anchors.ts` | 39 | 锚点 CRUD |
| `keyframes.ts` | ~50 | 课中「截取这一页」关键帧 CRUD（v8 新表，timestampMs 与转录同轴，上传后回写 mediaUrl） |
| `preferences.ts` | 24 | 偏好 KV 存储 |
| `classroom-flows.ts` | ~40 | 按 sessionId 保存录课中已生成的课堂脉络，供课后应用矩阵直接复用，不在下课后重复生成 |
| `lesson-digests.ts` | ~45 | 课堂笔记缓存 CRUD：按 sessionId 一份，内容签名变化时覆盖；随 deleteSession 级联删除 |
| `index.ts` | 98 | barrel 导出 |
