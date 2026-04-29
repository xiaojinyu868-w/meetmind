# Education Service OS V0 Product Spine

> 状态：Agent Native Infra 的第一个 reference implementation。
> 最近修订：2026-04-29（上移顶层抽象：本文不再是最终产品总纲，而是 `../agent-native-infra-spine.md` 下的学术服务数字员工样板。）
> 本文描述 Education Service OS / Academic Service V0 如何验证 Agent Native Infra。旧 `academic-engine-pilot`、`academic-service-in`、`academic-service-after` specs 已删除，避免继续误导开发方向。
> 阅读顺序：`../agent-native-infra-spine.md`（顶层总纲）→ 本文 → `multi-tenant-contract.md`（多租户 / 场景数据化 / 三端路由 / Prisma 新增模型）→ `openclaw-integration-decision.md`（OpenClaw 机构级 sidecar 协议）。

## 本文定位

Education Service OS 是 MeetMind Agent Native Infra 的第一条验证链路，不是平台本体。

它要证明：

- 机构可以定义自己的数字员工场景。
- agent 可以组合 tool atom、skill、生成式 UI 和语音完成连续服务。
- 服务过程可以被 trace 记录。
- Eval Agent 可以评测并推动数字员工持续变好。

它不应该证明：

- 申博/留学是唯一行业。
- Stanford / Percy / CV / 套磁 / 面试是平台写死的 workflow。
- 平台的价值来自预置更多场景卡片。

后续所有本目录开发都要能回到 `Agent Native Infra Spine` 的五个一等公民：Tool Atom Registry / Skill Contract / Artifact Runtime / Trace System / Eval Agent。

## 一句话

MeetMind Education Service OS 是一套面向高客单价教育/学术服务机构的 **多租户 AI 交付系统**。

它以 **机构自助接入 + 场景数据化** 为产品骨架，以 **OpenClaw 独立智能执行层** 和 **机构经验 / 老师辅导视频生成 Coaching Twin** 为核心能力，把非标服务流程、历史案例、导师经验和学生上下文，沉淀成可持续调用的 AI 服务能力。

机构在 `/console` 里：选行业模板 → 接入机构经验 → 定义自己的场景 → 邀请老师 → 发给学生。
服务前用真实帮助换取学生上下文；服务中用机构经验和老师辅导视频生成 AI 陪练分身完成交付放大；服务后用长期资产和成长陪伴把学生留在 MeetMind。

## 适用机构

V0 的第一个强模板是 **申博/学术服务**（seed 客户），但系统不只卖给申博机构。

目标客户是同类高客单价教育与成长服务机构：

- 保研机构
- 申博机构（V0 seed）
- 留学申请机构
- 论文/开题/答辩辅导机构
- 科研训练与竞赛培训机构
- 职业发展、作品集、面试训练等非标辅导机构

这些机构的共同点不是“都做申请”，而是：

- 服务依赖顾问、导师、主讲老师的经验
- 交付过程高度非标
- 学生愿意为结果付高客单价
- 重复劳动多，但真正高价值判断稀缺
- 有大量历史案例和服务经验，却没有产品化技术团队

### V0 行业模板策略

V0 不把"保研/申博/留学/论文/竞赛"写死为代码 enum，而是作为 **机构接入时可选的起点模板**（详见 `multi-tenant-contract.md` 的 `OrgIndustryTemplate` 模型）。

- **5 预置模板 + "空白" 共 6 个起点**：机构选一个作为初始化的 playbook/scenario 种子
- **模板 = 数据**：每个模板带推荐场景清单、seed playbook 骨架、默认 persona 偏好，**不是硬编码逻辑**
- **场景是机构自定义的**：机构在 `/console/scenarios` 里可以基于模板修改、删除、新增自己的场景
- **V0 seed 是申博机构**：我们自己走完 `/console/onboarding` 把申博机构配起来，这个流程本身就是产品验收（不允许 DB seed 硬塞）
- **长期方向**：机构可以把自己的成熟模板发布到公开市场供其他机构 fork（Phase 5 再开）

## 为什么不是普通论文工具 / 面试工具

普通论文工具和面试工具解决的是一次性任务：

- 给一段论文，返回修改建议
- 给一个面试场景，返回几个问题
- 给一个申请目标，生成模板化材料

Education Service OS 要解决的是机构真实交付里的连续问题：

- 顾问和导师时间昂贵，服务难规模化
- 材料生成、匹配、复盘、练习等重复劳动占比高
- 历史案例、服务 SOP、导师经验没有被结构化
- 机构有服务经验，但缺少技术团队完成产品化落地
- 一次辅导结束后，学生很难继续高质量推进
- 老师的方法、判断标准和反馈习惯没有被复用
- 学生材料、练习、反馈和成长轨迹散落在不同地方
- 服务结束后，学生关系容易断掉

因此主产品不是 `Writing Copilot` 或 `Interview Simulator`，而是：

**基于机构经验、历史案例、真实老师辅导视频和学生上下文生成的场景化 AI 陪练分身。**

论文陪练、博士面试、研究计划打磨、套磁表达练习，都是 Coaching Twin 的使用场景。

## TO B 核心价值

机构买的不是一个通用 AI 工具，而是一套把非标服务变成可复制系统能力的 OS。

核心价值：

- 将非标服务流程标准化
- 将历史案例与导师经验结构化
- 将单次服务转化为持续可调用的系统能力
- 帮助机构提升人效、扩大覆盖范围、沉淀自有数据资产
- 让没有技术团队的机构也能拥有自己的 AI 交付系统

对机构来说，系统最终沉淀的是三类资产：

- **学生上下文资产**：每个学生的目标、材料、困惑、练习和成长轨迹
- **机构经验资产**：案例库、服务流程、话术、导师反馈、优秀样本
- **AI 交付资产**：Coaching Twin、Practice Session、Checkpoint、长期成长路径

## 全周期产品图

```text
服务前：用价值换上下文
  学生目标 / 背景 / 材料 / 困惑
  -> 申请路线、项目匹配、导师匹配、材料诊断、下一步建议
  -> 学生愿意把真实上下文沉到 MeetMind

服务中：用老师视频生成 Coaching Twin
  学生上下文 + 机构经验 + 老师辅导视频 + 服务意图
  -> OpenClaw 理解老师怎么教、怎么问、怎么反馈
  -> Coaching Persona Pack
  -> 语音同桌 / 文本对话持续陪练
  -> checkpoint 给老师把关

服务后：用资产和成长陪伴留住学生
  辅导视频 / 陪练记录 / 老师反馈 / 材料版本 / 成长轨迹
  -> 可回看、可提问、可测验、可复习、可继续规划
  -> 长期学术资产和下一轮服务入口
```

## 服务前：上下文沉淀引擎

服务前不是简单获客，也不是免费咨询机器人。

它的核心逻辑是：

**先真的帮到学生，让学生愿意把目标、背景、材料、困惑和偏好沉到 MeetMind。**

### 学生得到什么

- 申请/成长路线图
- 项目、导师、方向或机会初筛
- 材料缺口诊断
- 文书、套磁、作品集、研究计划或训练方向建议
- 下一步行动建议

### 系统获得什么

- 服务目标
- 学术背景
- 研究兴趣 / 申请方向 / 能力短板 / 训练目标
- 材料状态
- 学生表达习惯
- 困惑和风险点
- 后续老师辅导与 Coaching Twin 所需的上下文

### 关键原则

- 不用营销话术换线索，要用真实推进换上下文。
- 不要求学生一次性填完所有信息，允许边获得价值边补充。
- 服务前的每个产物都要能进入服务中，成为老师和 OpenClaw 的上下文。

### 行业模板

服务前能力按行业模板变化，但底层逻辑相同：

- 保研：背景评估、项目匹配、材料诊断、面试准备路线
- 申博：导师匹配、套磁方向、研究计划梳理、面试路线
- 留学：选校定位、PS/CV 诊断、申请节奏、面试准备
- 论文辅导：选题诊断、开题路线、结构问题、修改优先级
- 竞赛培训：能力诊断、训练计划、样例拆解、复盘任务

## 服务中：老师视频生成 AI 陪练分身

服务中是 Education Service OS 的主心脏。

核心闭环：

```text
真实老师辅导视频 / 会议录屏 / 论文讲解 / 面试模拟录像
  + 服务意图
  + 学生上下文
  + 机构案例与 playbook
  -> 视频理解与转录增强
  -> 提炼老师辅导方式
  -> 提炼学生当前问题
  -> 生成 Coaching Persona Pack
  -> 驱动语音同桌 / 文本对话模型
  -> 学生持续练习、修改、复盘
  -> OpenClaw 更新记忆并判断 checkpoint
  -> 老师关键节点把关
```

### 视频理解模型锁定（V0）

**主模型：`qwen3.6-plus`**（百炼 OpenAI 兼容接口，走 MeetMind 现有 `DASHSCOPE_API_KEY`）。

支持视频输入的调用方式：

```jsonc
// OpenAI 兼容格式：直接视频 URL
{
  "type": "video_url",
  "video_url": { "url": "https://<public-cdn>/teacher.mp4" },
  "fps": 2
}

// 或者：预抽帧图片数组（可控性更高）
{ "type": "video", "video": ["frame1.jpg", "frame2.jpg", ...], "fps": 2 }
```

官方硬约束：

- 视频 ≤ 50 MB（**关键**：老师长视频大概率超限）
- 抽帧 ≥ 4 帧 ≤ 2000 帧
- URL 必须公网可访问，不支持 base64
- fps 范围 0.1–10，OpenAI 兼容模式默认每 0.5 秒一帧

### 老师视频处理主链路（>50MB 场景）

因为真实老师辅导视频普遍超过 50MB，V0 默认走“转录 + 关键帧混合”策略，不直接把整段视频喂模型：

```text
CoachingSource 上传
  -> 复用 MeetMind /api/video/import 管线（yt-dlp / ffmpeg / DashScope ASR）
     -> 音频流走 ASR（支持 12 小时）
     -> 视频流走 ffmpeg 关键帧抽取（fps=0.5 起，按段落密度可变）
  -> 视频被切成「章节段」（每段 2-10 分钟，带 transcript + 代表帧）
  -> 把段转录 + 该段 ≤50MB 子片段或关键帧数组喂给 qwen3.6-plus 做段级理解
  -> 段级理解聚合 → CoachingSource.analysis（提问方式、反馈结构、边界判断样本）
```

**小片段场景**：demo / 短视频素材（如仓库里的 `public/videos/video1.mp4`，7.5MB）可直接 `video_url` 送模型，作为黄金样本路径打通。

### OpenClaw 需要理解什么

- 机构服务流程和 playbook
- 历史案例里相似学生是怎么推进的
- 老师如何提问
- 老师如何追问学生
- 老师如何判断一个回答或段落是否合格
- 老师常用的反馈结构
- 老师对这个学生的具体建议
- 学生反复卡住的地方
- 哪些判断必须回到人工老师

### Coaching Persona Pack

`CoachingPersonaPack` 是连接老师辅导视频和语音/对话模型的核心产物。

它至少包含：

- 场景：论文修改、研究计划、博士面试、套磁表达、保研面试、作品集讲解、竞赛复盘、老师反馈复盘
- 角色：启发式导师、严格导师、面试官、论文 reviewer、研究计划 coach、项目顾问、竞赛教练
- 语气：温和、直接、追问型、结构化
- 提问方式：先澄清、再追问、再反馈、最后给下一步
- 反馈标准：结构、逻辑、证据、表达、学术规范、创新性边界
- 禁区：最终定稿、重大策略、创新性取舍、正式提交前判断
- checkpoint 条件：什么时候必须提醒老师介入
- 语音同桌 system prompt / session config

### Coaching Twin 场景

论文陪练不再是独立主产品，而是 Coaching Twin 的一个场景。

V0 先支持这些场景语义：

- 论文段落修改
- 研究计划打磨
- 博士面试训练
- 套磁表达练习
- 保研面试训练
- 申请材料表达打磨
- 老师反馈复盘

每个场景共享同一个核心：读取学生上下文、读取老师辅导记忆、按老师的辅导方式继续陪练。

## 服务后：长期资产与成长陪伴

服务后不是售后资料库。

它的核心逻辑是：

**把服务中产生的老师视频、陪练记录、checkpoint 和学生材料版本沉淀成长期学术资产，让学生持续留在 MeetMind。**

### 学生为什么回来

- 回看老师上次怎么讲
- 继续问当时没想明白的问题
- 复习 AI 提炼出的重点
- 做课后测验或面试复练
- 查看自己的长期薄弱点
- 准备下一阶段申请、论文、答辩、竞赛、科研计划或职业发展

### 机构为什么受益

- 一次服务不再一次性消耗
- 老师经验被持续复用
- 学生服务结束后仍留在机构体系内
- 更容易产生下一轮服务、专题训练或长期会员
- 机构拥有自己的学生数据资产、案例资产和 AI 交付资产

## OpenClaw 的四个核心能力

Education Service OS 直接使用 OpenClaw 作为解耦智能执行层，而不是把它塞进 Next.js 主进程。

MeetMind 负责产品体验、语音同桌、用户数据和服务资产；OpenClaw 负责长记忆、主动 agent、搜索和多步执行。

### 核心边界（V0 调整）

**OpenClaw 是“机构级 workflow runtime”，不是“每个学生一个 Gateway”。**

这是基于 OpenClaw 官方文档的现实约束（Gateway 是 full operator-access surface，默认单工作区）做的务实调整：

- **一个机构 = 一个 Gateway 实例**（独立端口、独立鉴权 token），由 MeetMind 主应用统一代理
- **学生/用户数据的 source of truth 留在 MeetMind**（Prisma + IndexedDB）——姓名、材料、音视频、转录、练习、反馈
- **OpenClaw memory 只承载机构级资产**：老师风格摘要、机构 playbook、历史案例摘要、workflow 执行上下文
- 学生之间的会话隔离通过 `sessionKey` 参数完成，而不是多 Gateway
- MeetMind 是唯一对外暴露面；OpenClaw Gateway 只监听内网，**不直接暴露给学生浏览器**

### 1. 长记忆

OpenClaw 负责 agentic memory，但只存**机构级**与**运行期**数据：

- 老师辅导风格（跨学生可复用的提炼）
- 老师判断标准
- 机构 playbook
- 历史案例摘要（脱敏）
- 当前 workflow 的执行上下文（一次 coaching-twin-build 的中间产物）
- 适合下一次主动触发的观察（机构视角，而不是学生隐私）

MeetMind 仍然是学生级 source of truth：

- 用户账号、学生画像、偏好、长期薄弱点
- Workspace
- 原始视频 / 音频 / 文档
- 转录文本
- Coaching Source
- Practice Session
- Checkpoint Pack
- 成长报告
- 机构案例库和服务资产索引

### 2. 主动 agent

OpenClaw 不只被动响应学生问题，还要主动推进服务。

V0 关注这些触发点：

- 老师视频处理完成，主动生成 Coaching Twin
- 新学生完成服务前诊断，主动补齐上下文
- 学生练习结束，主动总结反馈和下一步
- 学生多次卡在同一问题，主动生成补练任务
- deadline 临近，主动建议节奏
- 风险超过 AI 边界，主动生成老师 checkpoint

### 3. 搜索

搜索优先由 OpenClaw 的 tool/search 体系承接，用于端到端任务执行。

MeetMind 同时提供上下文和备用搜索能力：

- 内部资料搜索：学生材料、老师视频转录、历史反馈、陪练记录
- 机构资产搜索：案例库、SOP、话术、优秀样本、历史 checkpoint
- 外网搜索：`web-search-service`，支持 Bing / SerpAPI / DuckDuckGo / fallback
- 模型内置搜索：LLM provider 支持时可使用 web search / extractor

长期方向：

- 导师匹配和学术搜索应接入更专业的数据源，如 OpenAlex、Semantic Scholar、Crossref、学校官网和实验室页面。

### 4. 多步执行

OpenClaw 负责跨步骤完成端到端任务，而不是只生成一段回答。

核心 workflow：

```text
academic.delivery.coaching-twin-build
  输入老师辅导视频、服务意图、学生材料、机构 playbook
  -> 视频理解（qwen3.6-plus，段级）
  -> 提炼老师辅导方式
  -> 检索相似案例和机构经验
  -> 搜索/补全必要背景
  -> 生成 Coaching Persona Pack
  -> 生成 checkpoint 条件
  -> 推送给 MeetMind 语音同桌

academic.delivery.practice-session
  输入学生问题、当前材料、Coaching Twin 记忆
  -> 读取长期记忆
  -> 必要时搜索内部/外部资料
  -> 语音或文本陪练
  -> 生成反馈
  -> 更新记忆
  -> 判断是否触发老师 checkpoint
```

## 三个用户视角

### 学生

学生看到的是一个会持续推进自己申请、训练或成长目标的工作台。

他关心：

- 现在我该做什么
- 老师或顾问上次到底希望我怎么改
- 我能不能继续练
- 我哪里一直没改善
- 下一步怎么走

### 老师（V0 必须有最小工作台）

老师看到的是一个把自己辅导能力放大的系统。老师侧不做花哨的仪表盘，V0 只出一条最小入口：

- `/teacher` 独立路由（和学生端 `/app` 并列，登录后按角色自动路由）
- 默认视图：**待处理 CheckpointPack 列表**（按学生/场景/时间倒序）
- 点进一个 checkpoint 看：
  - 学生最近一次 PracticeSession 回放（文本/语音双栏）
  - 学生当前材料版本 diff
  - AI 发现的关键问题摘要
  - AI 不敢继续判断的风险点
  - 一键「介入」按钮（生成反馈文本或加段老师视频上传到 CoachingSource）
- 次视图：**我的 CoachingSource 列表**（老师上传过的辅导视频、每个视频生成的 PersonaPack 状态）

老师不需要一直重复低价值陪练，只在关键节点看到：

- 学生练了几轮
- AI 发现了什么问题
- 学生最新材料是什么
- 哪些问题 AI 不该继续判断
- 老师应该介入什么

### 机构

机构买到的是服务标准化、经验资产化、AI 交付能力和长期关系。

机构关心：

- 线索是否更有上下文
- 历史案例和导师经验是否被结构化
- 老师服务是否被放大
- 学生是否减少等待
- 交付是否更标准
- 服务结束后学生是否继续留存和复购

## 核心 Artifact 与数据流

### 核心 Artifact

机构与租户（**详见 `multi-tenant-contract.md`**）：

- `Organization`：机构实体。每个 Organization 对应一个独立的 OpenClaw workspace
- `OrgMember`：User↔Organization 多对多关系 + 角色（owner / consultant / teacher / student）
- `OrgIndustryTemplate`：系统预置起点模板（shenbo / baoyan / liuxue / lunwen / jingsai / blank）
- `OrgScenario` + `OrgScenarioVersion`：**机构自定义的场景**（结构化字段 + 自由 prompt 补丁 + 版本化）
- `OrgPlaybookSection`：机构 playbook 的结构化片段（SOP / 话术 / 案例 / 样本 / 量表）

学生与交付：

- `AcademicProfile`：学生目标、背景、研究兴趣、材料状态（带 `orgId`）
- `CoachingSource`：老师辅导视频及其转录、章节、关键片段、理解结果（带 `orgId`）
- `CoachingTwin`：某个学生 / 场景下生成的陪练分身（关联 `OrgScenario` 的某个 version）
- `CoachingPersonaPack`：语气、提问方式、反馈标准、禁区、下一步推进规则
- `PracticeSession`：学生与陪练分身的一次语音或文本练习（固化场景版本号）
- `CheckpointPack`：给老师看的阶段总结、风险点、学生最新材料和建议介入动作
- `GrowthAsset`：服务后可复习、可提问、可测验的长期资产

原有八个 artifact 都带 `orgId String` + 索引，形成机构级行级隔离。

### 数据流

```text
机构接入
  -> /console/onboarding
  -> Organization / OrgMember / OrgIndustryTemplate 选择
  -> OrgPlaybookSection 初始化
  -> provision-org.sh 创建 OpenClaw workspace

机构经验输入
  -> OrgPlaybookSection（结构化片段）
  -> OpenClaw memory / skills / workflows（脱敏摘要，详见 openclaw-integration-decision.md）

机构定义场景
  -> /console/scenarios/new
  -> OrgScenario（结构化 + prompt 补丁）
  -> 发布 → OrgScenarioVersion 快照

服务前输入（学生侧）
  -> AcademicProfile（带 orgId）
  -> Workspace / context

老师辅导视频
  -> CoachingSource（带 orgId）
  -> OpenClaw analysis
  -> CoachingPersonaPack
  -> CoachingTwin（引用某个 OrgScenarioVersion）

学生练习
  -> PracticeSession（固化 scenario version + orgId）
  -> OpenClaw memory update（机构级，脱敏）
  -> Feedback / Next Action
  -> optional CheckpointPack → /teacher

服务后沉淀
  -> GrowthAsset（带 orgId）
  -> Review / Quiz / Companion QA
  -> Next service signal
```

## 第一版产品体验

V0 第一屏按角色分三端，不是一个大通用页面（详见 `multi-tenant-contract.md` 的三端路由职责）。

**机构主 / 顾问** 进 `/console`：
- 还没 onboarding 完成 → 引导至 `/console/onboarding`（5 步向导）
- onboarding 完成 → 默认看 `/console/dashboard`（V0 简化为 scenarios 列表）

**老师** 进 `/teacher`：
- 默认看待处理的 CheckpointPack 列表（V0 Phase 1 允许列表为空）
- 可以上传 CoachingSource（老师自己的辅导视频）

**学生** 进 `/app`：
- 不做功能市场，做"下一步工作台"
- 当前阶段：申请准备 / 陪练交付 / 长期成长
- 现在最重要的一步
- 已沉淀的上下文
- **可开始的 Scenario 列表**（从所属机构的已发布场景里拉）
- 最近一次老师反馈或 AI 练习反馈
- 下一次建议动作

服务中第一条完整体验（黄金样本路径，Phase 2 打通）：

```text
老师在 /teacher 上传辅导视频（V0 黄金样本：public/videos/video1.mp4，7.5MB）
  -> MeetMind 转录 + 关键帧提取（复用 /api/video/import）
  -> qwen3.6-plus 段级视频理解 → CoachingSource.analysis
  -> 机构主在 /console/scenarios/:id 把这个 source 挂到某个场景
  -> OpenClaw coaching-twin-build skill 生成 PersonaPack
  -> 学生在 /app 里点击开始场景，跟 Coaching Twin 文本/语音对话
  -> 系统生成反馈和下一步
  -> 必要时生成 CheckpointPack，推送到 /teacher
```

## 与 MeetMind 的关系

Education Service OS 不是另起炉灶。

MeetMind 复用和承载：

- User / auth
- Workspace
- WorkspaceCapture
- WorkspaceEcho
- Tutor grounded QA
- conversation-service
- LLM service（包括 qwen3.6-plus 视频理解的调用层）
- web-search-service
- workspace-search-service
- ASR / video import pipeline
- 语音同桌 realtime 能力
- ai-native apps
- analytics-service

Academic Service 反哺 MeetMind：

- Coaching Source 改进课堂/辅导视频资产理解
- Coaching Twin 推动 Tutor 从答疑走向陪练
- 长记忆和主动 agent 让 MeetMind 更像长期学习伙伴
- 服务后资产化加强原有 Echo / 复习 / Workshop 能力
- 机构案例库和 playbook 能力让 MeetMind 从个人学习产品扩展到教育服务 OS

## OpenClaw 与 MeetMind 边界

详细协议见 `openclaw-integration-decision.md`，这里只列总则：

- MeetMind 是唯一对外暴露面；OpenClaw Gateway **只监听内网**。
- 一个机构一个 Gateway 实例（V0 第一阶段可以先只跑一个 seed 机构）。
- OpenClaw 从官方 npm / GitHub 重新安装和初始化，不恢复仓库历史里的旧 `openclaw/` 目录。
- MeetMind 通过 OpenClaw Gateway 的两个官方 HTTP 接口通信：
  - `POST /tools/invoke`（工具/技能调用，request-response）
  - `POST /v1/chat/completions`（OpenAI 兼容，支持 SSE 流）
- 会话隔离通过 `sessionKey`，而不是多 Gateway。
- MeetMind 向 OpenClaw 暴露 context、task、artifact、callback。
- OpenClaw 向 MeetMind 返回 persona pack、practice feedback、checkpoint pack、memory summary、next action。

仓库历史中的旧 `academic-search`、`mock-interview`、`thesis-review`、`taoci`、`essay-review` 只能作为历史线索阅读。新的 sidecar assets 要围绕 Education Service OS 重新写，升级为行业模板和 Coaching Twin 场景能力，而不是恢复成分散工具。

## V0 开发优先级

> **核心原则**：产品是一套 B 端 SaaS 骨架，**机构自助接入和场景定义必须 day-1 就有**，否则第二家机构上钩时就得推倒重来。Coaching Twin 的智能深度可以分阶段递进，但租户骨架不能"以后再改"。

### Phase 0：文档复位（已完成）

- [x] 更新 `product-spine.md`：视频理解模型、OpenClaw 多租户边界、老师侧工作台、黄金样本路径
- [x] 重写 `openclaw-integration-decision.md`：具体协议、多租户策略、目录结构
- [x] 新增 `multi-tenant-contract.md`：机构接入 / 场景数据化 / 权限 / Prisma 模型 / API 契约
- [ ] 等 Phase 2 再做：OpenClaw sidecar 安装与 provision-org.sh
- [ ] 等机构定义场景时自然出现：保研 / 申博 / 留学 / 论文 / 竞赛 的 `OrgIndustryTemplate` 种子数据

### Phase 1：多租户骨架 + `/console` 机构接入端（当前阶段）

> 让一个机构主能从 `/console/onboarding` 自助走完"创建机构 → 导 playbook → 邀请老师 → 定义场景 → 邀请学生"，学生能进 `/app` 跟一个**纯 LLM 版 Coaching Twin**练一轮，老师能进 `/teacher` 看到 CheckpointPack 列表。

- Prisma schema 新增：`Organization` / `OrgMember` / `OrgIndustryTemplate` / `OrgScenario` / `OrgScenarioVersion` / `OrgPlaybookSection`
- 所有学生级 artifact（`AcademicProfile` / `CoachingSource` / `CoachingTwin` / `PracticeSession` / `CheckpointPack` / `GrowthAsset`）加 `orgId` + 索引
- `withOrgContext` middleware：从 session 注入 activeOrgId，所有 `/api/console/*` 与 `/api/academic/*` 必走
- 新增 services 域：`org-service` / `org-scenario-service` / `org-playbook-service` / `academic-profile-service` / `coaching-source-service`（复用 `/api/video/import` 管线做 V0 基础视频处理）/ `coaching-persona-service`（纯 LLM 版）/ `practice-session-service` / `checkpoint-service`
- 新增 API：`/api/console/*`（见 `multi-tenant-contract.md`）+ `/api/academic/*`（学生端 / 老师端）
- `llm-service.ts` 扩 `VideoContentPart` 类型，支持 `type: 'video_url' + fps` —— Phase 1 先不激活视频理解，Phase 2 才真用，但类型和调用层 Phase 1 加好
- 三端新路由：
  - `/console`（机构主 / 顾问）：onboarding、scenarios 列表、scenario 编辑器（含试跑）、playbook、members
  - `/teacher`（老师）：CheckpointPack 列表、PracticeSession 回放入口、CoachingSource 上传入口
  - `/app`（学生）：下一步工作台 + 可开始的 Scenario 列表（复用现有 `/app/(main)/app`，不替换课堂主页面，新增独立路由段）
- 角色 + activeOrgId 路由守卫
- **Phase 1 验收点**（8 条，详见 `multi-tenant-contract.md`）：
  1. 以机构主身份走完 `/console/onboarding` 5 步
  2. 创建一个"博士面试训练"场景
  3. 用"试跑"按钮跟场景自己对话一轮
  4. 邀请学生接受邀请登录
  5. 学生能在 `/app` 看到并开始场景，跟纯 LLM Coaching Twin 对话
  6. 老师能在 `/teacher` 看到空的 CheckpointPack 列表（UI 存在即可）
  7. 数据库里所有新写入都有正确 orgId
  8. 用第二个机构账号跑一遍，数据互不可见

### Phase 2：Coaching Twin 最小闭环 + OpenClaw sidecar 接入

- 起 OpenClaw Gateway sidecar（独立进程，端口 18789，per-org workspace，token per-org）
- `provision-org.sh <orgId> <industry>`：创建 workspace、copy skills、copy industry playbook seed
- 定义 MeetMind ↔ OpenClaw 合同落地：`tools/invoke` + `chat/completions` 两条通路（详见 `openclaw-integration-decision.md`）
- 视频理解真正启用：`coaching-source-service` 调 `qwen3.6-plus` 做段级理解（优先打通 `public/videos/video1.mp4` 7.5MB 黄金样本）
- OpenClaw skill：`coaching-twin-build`（输入段级 analysis + scenario snapshot + playbook refs → 输出 `CoachingPersonaPack`）
- `/console/scenarios/:id` 的 "关联老师视频" 功能真正生效：上传 CoachingSource → 分析完成 → 可以挂到场景上
- Phase 2 验收点：
  - 上传 video1.mp4 → 段级 analysis 入库
  - 某 scenario 挂上这个 source 后，Coaching Twin 输出能体现这位老师的提问方式
  - 第二次、第三次练习 Coaching Twin 体现记忆（"你上次在 motivation 段卡住，这次重点打磨这里"）

### Phase 3：主动性 + checkpoint 自动化 + 老师工作台完整化

- PracticeSession 结束自动生成 NextAction（走 OpenClaw `proactive-tick` skill）
- 多次卡同点自动生成补练任务
- Scenario 的 `checkpointTriggers` 配置真实触发 CheckpointPack 并通知老师
- 老师端 `/teacher` 从"列表 + 回放"升级到"一键介入"（生成反馈文本 / 上传补拍视频）
- Phase 3 验收点：学生练完一轮 5 分钟内自动收到"下一次练什么"；checkpoint 触发时 `/teacher` 工作台顶端出现 + 邮件通知

### Phase 4：服务前漏斗 + 服务后资产

- 服务前：机构可在 `/console` 配置"服务前诊断场景"（路线图生成、材料诊断），对未注册学生开放体验链接；体验完沉淀 AcademicProfile 引导注册加入机构
- 服务后：CoachingSource / PracticeSession / CheckpointPack → 自动转 GrowthAsset（可复习 / 可测 / 可问），学生在 `/app/growth` 看到长期成长轨迹
- 系统预置 `OrgIndustryTemplate` 完善 5 行业 seed 数据（保研 / 申博 / 留学 / 论文 / 竞赛），每个带推荐场景清单和 playbook 骨架
- Phase 4 验收点：新机构 onboarding 后 10 分钟内能有第一个可发给学生的场景；一个完整服务结束后，学生 `/app/growth` 页能看到至少 3 类资产

### Phase 5：模板市场 + 多机构扩展（V0 不做，列在这里做方向锚点）

- 机构间模板 fork / 公开发布
- 机构订阅 / 计费
- 多机器分布式 OpenClaw workspace 编排
- 跨机构学生数据可移植性（opt-in）

## 成功标准

### 机构端（最重要，决定能不能卖）

- 机构主能自己在 `/console/onboarding` 走完 5 步接入，不需要我们上门
- 机构感觉自己的非标服务流程、导师经验和历史案例变成了持续可调用的 AI 交付资产
- 机构能在 `/console/scenarios` 自己定义独特场景，不被限制在我们给的 5 个模板里
- 新机构 onboarding 后 10 分钟内能有第一个可发给学生的场景
- 模板骨架能快速复用到其他同类机构（保研 / 申博 / 留学 / 论文 / 竞赛）

### 学生端

- 学生感觉"这个系统记得我、知道老师怎么教我，并且能继续陪我练"
- 学生不需要选"功能"，看到的是"下一步"

### 老师端

- 老师感觉自己的辅导能力被放大，而不是被 AI 替代
- 老师只在 checkpoint 出现时进系统，不需要主动捞练习记录

### 产品端（架构健康度）

- 多租户是一等公民：所有数据行级隔离，第二个机构接入不需要改代码
- 场景是数据不是代码：新增场景类型不需要上线，机构自己定义
- 服务前、服务中、服务后围绕同一个学生上下文、机构 playbook 和 Coaching Twin 体系增长，后续不需要推倒重来
- MeetMind 原能力被复用增强，而不是被绕过
- OpenClaw 承担真正 agentic 的能力（长记忆、主动、多步），而不是降级成普通脚本
- OpenClaw 与 MeetMind 解耦：OpenClaw 的 skill/workflow 升级不波及 MeetMind 产品迭代
