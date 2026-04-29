/**
 * Academic Service OS bounded context
 *
 * 这个域承担 Education Service OS 的所有新代码：
 * - 多租户模型：Organization / OrgMember / OrgScenario / OrgPlaybookSection / OrgInvite
 * - 学生交付：AcademicProfile / CoachingSource / CoachingTwin / PracticeSession / CheckpointPack / GrowthAsset
 * - Context：withOrgContext（鉴权 + 解 activeOrgId + 角色守卫）
 *
 * 为什么放一个独立 domain：
 * - 这是一条 bounded context，跟 MeetMind 课堂主线解耦；方便未来独立演进
 * - API 路由 /api/console/* 与 /api/academic/* 都经此域调用业务逻辑
 * - OpenClaw 集成（Phase 2）也在此域内追加 `openclaw-client.ts`，不污染现有 services/
 *
 * 约束：
 * - 本域不 import components/、hooks/、stores/（这些是客户端）
 * - 本域可以 import `@/lib/prisma`、`@/lib/services/auth-service`（复用 JWT 验证）
 * - 本域所有导出走 `@/lib/academic/...`，不走 `@/lib/services/...`
 *
 * 详见 specs/academic-service-v0/multi-tenant-contract.md
 */

export * from './context';
export * from './errors';
export * from './route-helpers';
export * from './services';
