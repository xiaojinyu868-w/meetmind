# Multi-Tenant Contract — Education Service OS

> 状态：V0 一等公民。Phase 1 就按这份契约落地。
> 最近修订：2026-04-24（初稿）
> 阅读顺序：先看 `product-spine.md` 了解产品方向，再看本文理解多租户与场景数据化边界，最后看 `openclaw-integration-decision.md` 对照 OpenClaw 侧的机构级隔离。

## 为什么这份契约必须 day-1 就有

Education Service OS 不是一套给一家机构用的定制工具，它是**面向一类机构的 SaaS 骨架**。如果多租户不是一等公民，我们会在第二家机构上钩时推倒重来。

更重要的是：

**"场景"不是代码里的 enum，而是机构在 `/console` 里自己定义的数据。**

所以这份文档要把三件事钉死：

1. 机构（Organization）是怎么接入、怎么配置、怎么计费隔离的
2. 学生 / 老师 / 顾问 / 机构主 的权限边界
3. 机构可以定义什么（Scenario、Playbook、CoachingSource）——以及系统消费这些定义的数据契约

## 产品形态一句话

> 机构在 `/console` 里：选行业模板 → 接入机构经验 → 定义自己的场景 → 邀请老师 → 发给学生
> 学生在 `/app` 里：用机构配好的场景练习、复盘、成长
> 老师在 `/teacher` 里：看 checkpoint、介入、上传视频
> MeetMind 侧：提供 SaaS 骨架与 AI 能力；OpenClaw 侧：每机构一个 workspace，跑 coaching-twin / practice / checkpoint workflow。

## 三端路由职责

| 路由 | 使用者 | 主要任务 |
|------|-------|---------|
| `/console` | 机构主（owner）、顾问（consultant） | 机构接入引导、Playbook 管理、Scenario 编辑、成员管理、资产与账单 |
| `/teacher` | 老师（teacher） | CheckpointPack 列表、PracticeSession 回放、材料 diff、一键介入、上传 CoachingSource |
| `/app` | 学生（student，默认角色） | 下一步工作台、Coaching Twin 练习、材料版本、成长回顾 |

登录后按角色+当前 org 自动路由。用户可同时拥有多个角色（例子：在 A 机构是 consultant，在 B 机构是 student）。

## 角色矩阵

| 角色 | 能做 | 不能做 |
|------|------|--------|
| `owner` | 一切 console 操作、账单、邀请/撤销任何成员 | — |
| `consultant` | 管理 Scenario / Playbook / 学生池、查看 checkpoint | 改计费、删除机构 |
| `teacher` | 上传 CoachingSource、处理自己负责学生的 checkpoint | 管理其他老师的学生 |
| `student` | 自己的 AcademicProfile、练习、材料、成长资产 | 看机构内部资产 / playbook 原文 |

一个 `User` 可以在多个 `Organization` 里，同一个 `User` 在不同 org 的角色可以不同。

## 机构接入流程（onboarding）

`/console/onboarding` 的 5 步向导，每一步都能回头改。**我们自己的 seed 申博机构也必须走完这个向导**，不允许 DB seed 硬塞。

```text
1. 创建机构
   - 机构名、联系邮箱、大致规模
   - 选择行业起点（5 预置模板 + "空白"）：
     shenbo / baoyan / liuxue / lunwen / jingsai / blank
   - 生成 orgId、创建 OpenClaw workspace（provision-org.sh orgId industry）

2. 导入机构经验
   - Playbook 文档粘贴 / 文件上传（PDF / MD / DOCX）
   - 历史案例摘要（可选，格式：目标 / 学生画像 / 交付路径 / 结果）
   - 常用话术 / 优秀样本

3. 邀请老师
   - 邮箱邀请（角色：teacher）
   - 老师进入后可上传自己的辅导视频样本，系统在 Phase 2 会基于此生成 Persona Pack

4. 定义第一个场景
   - 从模板起点带出推荐场景列表（可跳过 / 可修改 / 可新建）
   - 使用 Scenario 编辑器（见下方）配置第一个场景
   - 必填：场景名、期望产物类型、persona 种子、必需的学生输入字段

5. 生成学生邀请链接 / 嵌入代码
   - 机构把链接发给学生，学生注册后自动归属到该 org
   - V0 不做嵌入代码；只出邀请链接
```

完成 5 步后，机构状态从 `onboarding` → `active`。

## Scenario 编辑器（核心产品面）

场景的数据结构采用 **方案 z：结构化主体 + 自由 prompt 补丁**。

### 结构化字段（系统稳定消费）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 机构内唯一，比如"文献综述打磨" |
| `description` | string | 一句话说明给学生看什么 |
| `productKind` | enum | `practice` / `review` / `qa` / `mock-interview` / `material-polish` |
| `studentInputSchema` | JSON | 学生开始前必须提交的材料字段（从预设库拖拽组合） |
| `personaSeed.tone` | enum | `gentle` / `direct` / `probing` / `structured` |
| `personaSeed.style` | enum | `socratic` / `mentor` / `interviewer` / `reviewer` |
| `personaSeed.feedbackAxes` | string[] | 反馈维度清单，比如 `["structure","logic","evidence","language","originality"]` |
| `personaSeed.forbiddenZones` | string[] | 禁区清单，比如 `["final-decision","strategic-pivot"]` |
| `checkpointTriggers` | JSON | 触发 checkpoint 的条件（关键词、重复卡住次数、材料风险类别） |
| `coachingSourceRefs` | string[] | 关联的老师辅导视频 id，Phase 2 用于生成 PersonaPack |
| `playbookSectionRefs` | string[] | 关联的 playbook 片段 id |
| `industryTemplate` | enum | 起点模板（可为 `blank`） |

### 自由 prompt 补丁（兜底灵活性）

| 字段 | 类型 | 说明 |
|------|------|------|
| `promptPatch.systemAppendix` | markdown | 追加到 system prompt 末尾的机构私货 |
| `promptPatch.userKickoff` | markdown | 第一轮用户消息模板（学生按钮点了"开始"后默认塞进去） |
| `promptPatch.reviewerRubric` | markdown | 老师特有的评分量表，AI 用来打分 |

### 编辑器 UX 原则

- 左侧结构化面板 + 右侧 live preview（显示系统最终拼出来的 prompt 预览）
- Preset 模板可一键"覆盖字段"或"合并追加"
- 保存时版本化（`OrgScenarioVersion`），练习会话固化到某个版本
- **发布前必须用"试跑"按钮跑一次 mock practice**（系统自动生成一个模拟学生上下文，Scenario 编辑者亲自对话验证）

## 数据模型（Prisma schema 新增）

> Phase 1 落地，所有 Artifact 都带 `orgId` 做行级隔离。

```prisma
model Organization {
  id                 String   @id @default(cuid())
  name               String
  contactEmail       String
  industry           String   // shenbo / baoyan / liuxue / lunwen / jingsai / blank
  status             String   // onboarding / active / suspended
  openclawWorkspace  String   // 物理路径：~/.openclaw/workspaces/<orgId>
  openclawTokenRef   String   // 环境变量名：OPENCLAW_GATEWAY_TOKEN_<orgId>
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  members            OrgMember[]
  scenarios          OrgScenario[]
  playbookSections   OrgPlaybookSection[]
  coachingSources    CoachingSource[]
  academicProfiles   AcademicProfile[]
}

model OrgMember {
  id             String   @id @default(cuid())
  orgId          String
  userId         String
  role           String   // owner / consultant / teacher / student
  invitedBy      String?
  joinedAt       DateTime @default(now())

  org            Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, userId])
  @@index([userId])
}

model OrgIndustryTemplate {
  id                  String @id // shenbo / baoyan / liuxue / lunwen / jingsai / blank
  displayName         String
  description         String
  recommendedScenarios Json   // [{name, productKind, personaSeed, ...}, ...]
  seedPlaybook        String  // markdown，系统默认 playbook 骨架
  createdAt           DateTime @default(now())
}

model OrgScenario {
  id                  String   @id @default(cuid())
  orgId               String
  name                String
  description         String
  productKind         String
  studentInputSchema  Json
  personaSeed         Json
  checkpointTriggers  Json
  coachingSourceRefs  Json     // string[]
  playbookSectionRefs Json     // string[]
  industryTemplate    String
  promptPatch         Json     // { systemAppendix, userKickoff, reviewerRubric }
  currentVersionId    String?
  status              String   // draft / published / archived
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  org                 Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  versions            OrgScenarioVersion[]

  @@index([orgId, status])
}

model OrgScenarioVersion {
  id           String   @id @default(cuid())
  scenarioId   String
  versionNumber Int
  snapshot     Json     // 当时 OrgScenario 的完整字段快照
  publishedAt  DateTime @default(now())

  scenario     OrgScenario @relation(fields: [scenarioId], references: [id], onDelete: Cascade)

  @@unique([scenarioId, versionNumber])
}

model OrgPlaybookSection {
  id           String   @id @default(cuid())
  orgId        String
  title        String
  sectionKind  String   // overview / sop / rubric / script / sample / case
  body         String   // markdown
  tags         Json     // string[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  org          Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, sectionKind])
}
```

原产品已有的 `AcademicProfile` / `CoachingSource` / `CoachingTwin` / `PracticeSession` / `CheckpointPack` / `GrowthAsset` 都加 `orgId String` 字段 + 索引，形成机构级行级隔离。

## 数据边界与权限

### 隔离原则

- **行级**：每次查询必须带 `orgId`，由统一的 `withOrgContext(req)` middleware 从 session/cookie/JWT 解出并注入
- **老师**：只能看自己 `teacher_student_assignment` 关联的学生
- **学生**：只能看自己 + 自己有权读的场景快照（发布版，不能看机构私 playbook 原文）
- **顾问/机构主**：可以看本 org 全部，但**不能**跨 org

### 跨 org 场景

一个 `User`：
- 在 org A 是 `student`
- 在 org B 是 `teacher`

登录后 MeetMind 按"当前 activeOrgId"切换视角（`/console` / `/teacher` / `/app` 顶部有 org 切换器）。数据互不可见。

### OpenClaw workspace 隔离

- 每个 `Organization.id` 对应一个 `~/.openclaw/workspaces/<orgId>/` 目录
- 每个 workspace 有独立 Gateway token（存在 MeetMind 环境变量，名字 `OPENCLAW_GATEWAY_TOKEN_<orgId>`）
- `provision-org.sh <orgId> <industry>`：
  - 创建 workspace 目录
  - 把 `openclaw/skills/*/SKILL.md` 复制/symlink 进去
  - 把 `openclaw/playbooks/<industry>/` 复制进去作 seed playbook
  - 生成 token 写 `.state/tokens/<orgId>.token`
- MeetMind 调用 OpenClaw 时 `Authorization: Bearer <对应 org 的 token>`

V0 Phase 1 不落 OpenClaw 调用，只把 Organization 创建时 `provisioning` 状态打在库里，等 Phase 2 真正接入。

## `/console` 页面地图（V0）

```
/console
├── /onboarding                  # 5 步向导
│   ├── 1. create-org
│   ├── 2. import-playbook
│   ├── 3. invite-teachers
│   ├── 4. define-first-scenario
│   └── 5. invite-students
├── /dashboard                   # 总览：onboarding 完成度、活跃学生数、近期 checkpoint
├── /scenarios                   # Scenario 列表
│   └── /scenarios/[id]          # Scenario 编辑器（结构化 + prompt 补丁 + 试跑）
├── /playbook                    # Playbook 片段列表 + 编辑
├── /sources                     # CoachingSource 资产（老师视频聚合）
├── /members                     # 成员 + 邀请链接
└── /settings                    # 机构基础信息、订阅（V0 不实现）
```

V0 最小必须做：`onboarding`、`scenarios/list`、`scenarios/[id]`、`playbook`、`members`。
可缓后做：`dashboard`、`sources`、`settings`。

## API 契约（Phase 1 最小集）

全部挂在 `/api/console/*` 之下，统一 `withOrgContext` 鉴权。

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/console/orgs` | POST | 创建机构（onboarding step 1） |
| `/api/console/orgs/me` | GET | 当前用户所属机构列表 + 当前 activeOrgId |
| `/api/console/orgs/:id/switch` | POST | 切换 activeOrgId |
| `/api/console/playbook` | GET/POST | 列出 / 新增 Playbook section |
| `/api/console/playbook/:id` | PUT/DELETE | 改 / 删 |
| `/api/console/scenarios` | GET/POST | 列出 / 新建 Scenario |
| `/api/console/scenarios/:id` | PUT | 保存草稿 |
| `/api/console/scenarios/:id/publish` | POST | 发布（创建 version 快照） |
| `/api/console/scenarios/:id/try` | POST | 试跑（挂到 tutor LLM，走纯文本模拟） |
| `/api/console/members` | GET/POST | 成员列表 / 发邀请 |
| `/api/console/members/:id` | DELETE | 撤销成员 |
| `/api/console/invite/accept` | POST | 被邀请人接受（公开接口，走邀请 token） |
| `/api/console/industry-templates` | GET | 预置模板列表（给 onboarding 选） |

## 学生端和老师端如何消费 Scenario

### 学生 `/app` 入口

学生登录 → 拿到当前 org 的**已发布 Scenario 列表**（`status=published`）→ 第一屏展示"下一步工作台"（当前阶段推荐 + 可开始的 Scenario）。

点击开始 Scenario：
- 系统拉 Scenario 最新 published version（不是 draft）
- 按 `studentInputSchema` 提示学生补材料
- 调用 `/api/academic/practice-session/start`，固化 scenario 版本号到 PracticeSession
- Coaching Twin 按 `personaSeed` + `promptPatch` + 该学生的 `AcademicProfile` 组装 system prompt

### 老师 `/teacher` 入口

老师登录 → 看到自己负责学生的 CheckpointPack 列表 → 点进去看练习回放 + 材料 diff + 介入按钮。

老师也能在 `/teacher/sources` 看/传自己的 CoachingSource（但 Scenario 的编辑权在 consultant/owner，老师只做内容贡献）。

## V0 不做的事

- 不做跨机构模板市场（Phase 5 再说）
- 不做机构订阅/计费（V0 seed 机构免费跑）
- 不做全平台机构 directory / 公开页
- 不做 Scenario 间的依赖/编排（每个 Scenario 独立）
- 不做学生在机构间 data portability（跨 org 看不到彼此）
- 不做 OpenClaw workspace 的多机器分布式（V0 同机多 workspace 即可）

## 验收标准（Phase 1 完成的定义）

1. 我们自己以**机构主**身份从 `/console/onboarding` 走完 5 步，不碰数据库
2. 在 `/console/scenarios/new` 里创建一个 "博士面试训练" 场景（结构化 + prompt 补丁）
3. 点"试跑" → Scenario 编辑者能用文本模拟学生对话一轮，验证 persona 对不对
4. 发邀请链接邀请一个学生账号 → 学生登录自动进 `/app`
5. 学生看到这个场景 → 点击开始 → 能跟一个**纯 LLM 版 Coaching Twin**对话（Phase 2 才接 OpenClaw）
6. 整个过程中，`/teacher` 端能看到该学生属于自己的 CheckpointPack 列表（Phase 1 允许列表为空）
7. 在数据库里查：所有新写入的 `OrgScenario` / `OrgPlaybookSection` / `AcademicProfile` / `PracticeSession` 都有正确的 `orgId`
8. 用第二个机构账号跑一遍，数据互不可见

这 8 条全部通过 = Phase 1 过关。
