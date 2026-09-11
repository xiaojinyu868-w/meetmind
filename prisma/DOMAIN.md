# prisma/ — 服务端数据模型（SQLite）

> `schema.prisma` 是服务端真相源；IndexedDB 是客户端真相源，服务端只是同步备份（`src/lib/db/DOMAIN.md`）。
> 改 schema：`make db-push`（同步到 SQLite + 生成 Client）。生产库是运行目录下的 `prisma/meetmind.db`，
> 特性分支 worktree 通过 `.env` 的 `DATABASE_URL` 指向同一个文件——改 schema 前先想清楚要不要动生产数据。

## 已知问题（记录，不在本轮修）

### PointAccount.userId 无外键 → 删用户留孤儿（2026-09-11 登记）

- `PointAccount.userId` / `PointTransaction.userId` 是裸字符串（`@unique` / `@@index`），没有到 `User` 的 `@relation`，
  所以 `User` 上的 `onDelete: Cascade` 管不到它们。删用户（后台删号、smoke 脚本 `prisma.user.delete` 清理合成账户）会留下
  `PointAccount` 与 `PointTransaction` 孤儿行。
- 2026-09-11 只读统计生产库：非 guest 的孤儿 `PointAccount` 8 行、对应 8 个已不存在的 userId 的 `PointTransaction`（多为验收脚本
  的合成账户）。
- **为什么不能直接加外键**：`userId` 有意承载非 User 主体——`guest_{ip}` 表示访客日成本闸、`anonymous` 表示未登录影子流水
  （`src/lib/services/point-account-service.ts`）。加 `@relation` 会让这些行违反约束；要修得先把访客计量拆到独立表或改成
  可空外键 + 单独的 guestKey 字段，涉及生产数据迁移与积分服务改写，需单独决定与排期。
- 过渡做法：删用户的路径（管理后台 / 合成账户清理脚本）应顺手 `deleteMany({ where: { userId } })` 清 `PointAccount` /
  `PointTransaction`；`tests/smoke/*` 清理时目前没有做，是孤儿的主要来源。
