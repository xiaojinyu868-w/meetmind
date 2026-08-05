# Account Conversations API

> 账号级全局问答历史。它不属于某一节课堂，因此禁止写入 `WorkspaceCaptureArtifact`。

## 路由

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/conversations/sync` | GET | Bearer 鉴权后返回当前账号最近 20 个 `global-ask` 会话（含删除墓碑），每个 active 会话最多返回最近 500 条消息并按时间正序输出；可用 `conversationId` 额外钉住 active learning thread，服务端仍按 JWT 校验归属 |
| `/api/conversations/sync` | POST | Bearer 鉴权后批量合并会话与消息 mutation；单批总数最多 100 |

## 合并合同

- 会话 ID 和消息 ID 由客户端生成并跨设备稳定；服务端始终把写入绑定到 JWT 的 `sub`，客户端不能指定归属账号。
- 会话元数据使用 `clientUpdatedAt + sourceMutationId` 做确定性 last-write-wins；服务端到达时间不参与冲突决胜。
- 删除保留父级 tombstone 并清理消息，防止旧设备把已删会话重新写活。
- 消息按稳定 ID 不可变去重；父会话不存在、已删除或不属于当前账号时拒绝写入。
- route 只负责鉴权、默认 API 限流和响应转换；数据验证与事务逻辑在 `account-conversation-service.ts`。

## 客户端

`account-conversation-sync-client.ts` 使用独立、带 `userId` 的持久 outbox。首次启用会把现有 IndexedDB `sessionId='global-ask'` 历史分批补传；挂载、重新联网和新 mutation 时先排空本账号 outbox，再拉取云端并按版本合入 IndexedDB。恢复 active learning thread 时通过 `conversationId` 查询参数额外钉住旧会话；若该会话不在首次最近 20 条，客户端用 `userId + conversationId` 的 pinned bootstrap marker 单独补传本地父会话与消息，服务端明确接受后才标记完成；若基础同步已在进行，客户端等待其结束后执行补传再补拉，并对同用户/同 ID 去重。登录后匿名 `global-ask` 历史走独立认领通道，不受 recent-20 marker 短路影响；匿名批次只有在服务端完整接受后才更新本地 `userId`，失败会在下一次同步重试。课堂对话继续走 Workspace evidence 链路。
