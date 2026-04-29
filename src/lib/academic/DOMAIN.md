# src/lib/academic — Education Service OS bounded context

> 这里承载 Education Service OS 的所有后端逻辑。它是一条 bounded context，跟 MeetMind 课堂主线（lib/services/ 原来的内容）解耦。
>
> 阅读顺序：先读 `specs/academic-service-v0/product-spine.md` 与 `multi-tenant-contract.md` 理解产品与数据契约，再回到这里看代码。

## 职责

- 多租户：`Organization` / `OrgMember` / `OrgInvite` / `OrgIndustryTemplate`
- 机构经验：`OrgPlaybookSection`
- 场景数据化：`OrgScenario` / `OrgScenarioVersion`
- 学生交付：`AcademicProfile` / `CoachingSource` / `CoachingTwin` / `PracticeSession` / `CheckpointPack` / `GrowthAsset`
- Context：`withOrgContext`（鉴权 + 解 activeOrgId + 角色守卫）
- Phase 2 追加：`openclaw-client.ts`（通过 HTTP 调 OpenClaw Gateway）

## 文件索引

| 文件 | 职责 |
|------|------|
| `context.ts` | 解 JWT + 读 activeOrgId + 角色守卫；所有 `/api/console/*` 与 `/api/academic/*` 都走它 |
| `errors.ts` | `AcademicError` 类 + `toHttpError()` 转换 |
| `index.ts` | barrel：`@/lib/academic` 对外入口 |
| `services/scenario-types.ts` | 场景数据模型类型（共享给前后端） |
| `services/org-service.ts` | Organization 生命周期（创建 / onboarding 推进 / 模板） |
| `services/org-playbook-service.ts` | Playbook 片段 CRUD |
| `services/org-scenario-service.ts` | Scenario 草稿/发布/归档 + 版本化快照 |
| `services/org-member-service.ts` | 成员 + 邀请链接 |
| `services/academic-profile-service.ts` | 学生画像最小 CRUD |
| `services/coaching-persona-service.ts` | 把 Scenario + Profile 拼成 Coaching Twin 的 system prompt |
| `services/practice-session-service.ts` | 学生陪练会话（纯 LLM 版，V0） |
| `services/checkpoint-service.ts` | CheckpointPack 读 + 手工创建（Phase 1 为空闭环） |

## 依赖方向

```
api/route.ts → @/lib/academic → @/lib/prisma, @/lib/services/auth-service, @/lib/services/llm-service
```

- ✅ 可以用 `@/lib/prisma` / `@/lib/services/llm-service` / `@/lib/services/auth-service`
- ✅ services 之间可以互相 import（低耦合时）
- ❌ 禁止 import `@/components/*` / `@/hooks/*` / `@/stores/*`
- ❌ 禁止 import `@/app/api/*`

## 多租户铁律

- **所有**写入 DB 的 query 必须带 `orgId`
- **所有**读取学生级 artifact 的 query 必须带 `orgId`
- 查询前先走 `resolveConsoleContext(req)` 解出 `orgId`，再把它透传到 service 函数
- 不要让前端传 `orgId`（它可伪造）；永远从 `context` 注入

## 运行

- seed 6 个预置模板：`npx tsx scripts/seed-industry-templates.ts`
- 同步 schema：`make db-push`
