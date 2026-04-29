# Specs Index

> 目标：降低文档入口熵。新开发先从这里判断应该读哪份文档。

## Canonical Reading Order

1. `agent-native-infra-spine.md`
   - 顶层总纲：MeetMind 是 Agent Native Infra，不是单一申请顾问产品。
   - 定义五个一等公民：Tool Atom Registry / Skill Contract / Artifact Runtime / Trace System / Eval Agent。

2. `agent-native-coding-agent-guide.md`
   - 给新空间 coding agent 的执行指南：读什么、改哪里、怎么避免把原 MeetMind 和新项目混在一起。
   - 明确新项目可以作为可独立部署的机构数字员工项目推进。

3. `academic-service-v0/product-spine.md`
   - 第一个 reference implementation：Education Service OS / 学术服务数字员工。
   - 描述多租户、服务前/中/后、Coaching Twin、三端体验。

4. `skill-platform-v0/overview.md`
   - Infra 子系统：机构如何上传、审核、运行 scenario skill。

5. `academic-service-v0/multi-tenant-contract.md`
   - 多租户、机构、角色、场景数据化和 API/Prisma 契约。

6. `academic-service-v0/openclaw-integration-decision.md`
   - OpenClaw 作为机构级 sidecar 的边界与协议。

7. `../项目开发文档/提示词设计哲学.md`
   - Prompt 与 agent 行为哲学：Less Structure, More Intelligence。

## Reference Implementation Docs

| 文档 | 当前定位 |
|------|----------|
| `agent-native-coding-agent-guide.md` | 新项目 coding agent 执行指南与部署边界 |
| `academic-service-v0/product-spine.md` | 学术服务数字员工 reference implementation |
| `academic-service-v0/multi-tenant-contract.md` | 机构/角色/场景数据化契约 |
| `academic-service-v0/openclaw-integration-decision.md` | OpenClaw sidecar 运行边界 |
| `skill-platform-v0/overview.md` | Skill authoring/review/runtime 子系统 |

## Removed Historical Docs

这些文档已经删除，不再作为历史线索或开发入口。需要理解旧脉络时请看 git history，但不要恢复到当前工作树：

| 文档 | 说明 |
|------|------|
| `academic-engine-pilot/*` | 早期学术引擎设想 |
| `academic-service-in/*` | 早期服务中设想 |
| `academic-service-after/*` | 早期服务后设想 |
| `archive/product-focus.md` | 早期功能列表 |
| `full-cycle-academic-service-overview.md` | 全周期学术服务旧概览 |

## New Work Rule

新需求必须先归属到以下一项：

- Tool Atom Registry
- Skill Contract
- Artifact Runtime
- Trace System
- Eval Agent
- Reference implementation polish

如果归属不清，先更新 `agent-native-infra-spine.md`，不要直接加功能。
