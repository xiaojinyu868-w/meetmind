# Agent Native Infra Spine

> 状态：新的顶层 canonical spine。
> 最近修订：2026-04-29
> 阅读顺序：本文 → `academic-service-v0/product-spine.md` → `skill-platform-v0/overview.md` → 具体实现文档。

## 一句话

MeetMind 要做的是 **面向 B 端机构的 Agent Native Infra**：让机构能定义数字员工、运行数字员工、评测数字员工、改进数字员工。

学术申请顾问不是产品本体，而是第一个 reference implementation。它存在的意义是验证这套 infra 能否支撑一个真实机构场景，而不是把 Stanford / Percy / CV / 套磁写死成固定 workflow。

## 为什么现在要重设总纲

项目已经产生了三类文档与实现：

- Education Service OS：多租户、机构接入、服务前/中/后、Coaching Twin。
- Skill Platform：机构通过 skill 定义场景，平台提供工具、UI、审核与运行时。
- Academic Consult Agent：申博/学术申请样板，包含 CV、导师、套磁、面试、材料等能力。

这些都对，但如果没有更高层抽象，它们会滑向功能堆叠：每个场景一个 skill，每个 skill 一张卡，每张卡一个 workflow。

新的总纲是：

> 智能不应该由平台提前写死，而应该从机构场景、服务原子、生成式 UI、运行轨迹和评测闭环中自然涌现。

## 核心信念

### 1. 未来软件是 Agent 原生软件

Agent 原生软件不是“传统页面 + 聊天框”。它的主交互是长程对话，agent 在对话中：

- 理解用户状态
- 调用服务工具
- 生成交互界面
- 读写业务系统
- 发起语音或其他媒介
- 产出可持续演化的服务 artifact

生成式 UI 是 agent native 的交互层，不是卡片装饰。

### 2. 评测是唯一重要的事情

大量机构和个人开发者可以做出 60-70 分 agent，但缺少一套系统判断它为什么不是 85 分。

MeetMind 的核心壁垒不是“又多几个 tool”，而是：

- 能复现用户旅程
- 能记录 agent 每一步
- 能评价 tool / skill / UI / memory / search 的质量
- 能把失败原因直接映射到改进动作

### 3. 模拟用户评测是 agent native 软件的仿真派

真实用户反馈重要，但成本高、样本少，并且测试场景本身也会产生偏差。

MeetMind 要把大模型模拟用户、传统测试用例、真实轨迹 few-shot、机构行业经验、审美与交互标准结合起来，把“纯 LLM 模拟用户”的 30 分，工程化推到 60-70 分。这个水平足够指导一个 70 分数字员工迭代到 80-85 分。

### 4. 先交付数字员工，再用评测把它变好

商业闭环：

```text
交付一个机构数字员工
  -> 在 MeetMind Agent Native Infra 上运行
  -> 产生真实 trace / artifact / 用户反应
  -> Eval Agent + 规则评测定位问题
  -> 改进 tool / skill / UI / memory / prompt / search
  -> 交付更好的数字员工
  -> 获得更多现金流与真实数据
  -> 继续提升评测系统
```

## 五个一等公民

### 1. Tool Atom Registry

Tool 不是技术函数，也不是媒介接口。Tool 是 agent 可选择、用户可感知、平台可评测的服务动作。

每个 tool atom 必须声明：

- 原子类型：感知 / 判断 / 交互 / 行动 / 评测
- 输入状态：它需要什么上下文
- 输出 artifact：它产生什么服务结果
- 状态影响：是否改变画像、session、lead、artifact
- 评测标准：怎样算调用得好

### 2. Skill Contract

Skill 不是固定流程。Skill 是机构的方法论包。

一个好 skill 应定义：

- 场景目标
- 用户常见状态
- 机构判断标准
- 可用服务原子
- 典型失败模式
- 高质量样例
- 什么时候必须转人工

Skill 不应该把“第一步做 A，第二步做 B”写死。agent 应根据当前状态选择动作。

### 3. Artifact Runtime

Agent 不应该反复吐新卡片，而应该维护持续演化的服务状态。

Artifact 可以是：

- 申请方案
- CV 诊断
- 导师探索短名单
- 套磁工作台
- 面试练习记录
- 材料版本
- 机构评测报告

原则：

- 一类服务对象尽量维护一个活 artifact
- 后续动作更新 artifact，而不是刷屏生成中间结果
- artifact 必须能被用户继续操作，也能被 Eval Agent 复盘

### 4. Trace System

没有 trace，就没有评测；没有评测，就没有飞轮。

每次服务都要记录：

- agent 看见了什么
- agent 判断了什么
- agent 问了什么
- agent 调用了什么 tool
- tool 输入输出是什么
- agent 生成了什么 UI
- 用户如何反应
- 哪些状态被写入
- 哪些失败或不确定性被暴露

Trace 是产品智能感、机构复盘、自动评测和持续改进的共同数据层。

### 5. Eval Agent

评测系统本身也应该是一个 agent。

Eval Agent 负责：

- 模拟目标用户跑场景
- 读取完整 trace
- 按平台规则和机构 rubric 评分
- 判断是否出现 workflow lock-in、过早转化、搜索幻觉、UI 信息过载、画像误写等问题
- 定位失败原子
- 输出可执行改进建议

它不是测试脚本的替代，而是把规则测试、模拟用户、审美判断、行业标准和真实轨迹合成一个评测员工。

## 服务动作原子

MeetMind 的 agent native 原子不是“文本 / 语音 / 图片 / 富文本”，而是：

```text
感知 -> 判断 -> 交互 -> 行动 -> 评测
```

| 原子 | 回答的问题 | 例子 |
|------|------------|------|
| 感知 | agent 如何看见发生了什么 | readProfile / fileUpload / webSearch / retrieveKnowledge |
| 判断 | agent 如何理解现在该做什么 | showConsultantMove / advisorDiscovery / assessReadiness |
| 交互 | 用户如何参与服务过程 | askOptions / requestUpload / startVoiceCall / requestConsent |
| 行动 | agent 如何改变状态或产生交付 | showDraft / writeProfile / createLead / updateArtifact |
| 评测 | 系统如何知道做得好不好 | evaluateTrace / checkCitation / detectLockIn / compareArtifact |

判断一个能力是否应该成为 tool atom，用三个问题：

1. agent 是否需要决定要不要做它？
2. 用户是否能感知它的结果？
3. 平台是否能评测它做得好不好？

同时满足，就应该成为服务动作原子。

## 反模式

这些方向会增加项目熵：

- 把某个具体申请流程写成主产品。
- 为每个场景加一张新卡，但没有 artifact 演化。
- skill 规定固定路径，agent 只能按步骤走。
- 用户随口提到的人名、学校、方向被直接写成长期画像。
- UI 只把 markdown 包成卡片，没有交互闭环。
- 搜索没有来源质量评测。
- 评测只打总分，不定位到 tool / skill / UI / memory。

## 当前 reference implementation

### 学术申请数字员工

当前申博/学术申请 agent 是第一条验证链路。

它应该验证：

- 机构可以定义场景方法论
- agent 能组合服务原子
- 生成式 UI 能让用户自然参与
- artifact 能持续演化
- trace 能被记录
- Eval Agent 能定位失败并提出改进

它不应该验证：

- Percy Liang 是否被写死
- Stanford NLP 是否成为默认路径
- CV / 套磁 / 面试是否各自变成独立 workflow

### Console 资产面板

`/console` 应逐步成为 infra 的可视化控制台：

- tool atoms
- scenario skills
- artifacts
- traces
- eval cases
- improvement suggestions

### Agent Arena

当前 Arena 是规则评测器雏形。下一步要升级为 Eval Agent：

- 先支持固定 flagship case
- 再支持机构自定义 eval case
- 再支持模拟用户多轮任务
- 最后支持从真实 session 自动生成回归案例

## 文档层级

```text
specs/agent-native-infra-spine.md
  顶层总纲：为什么做、做什么、不做什么、五个一等公民

specs/academic-service-v0/product-spine.md
  Reference implementation：Education Service OS / 学术服务数字员工

specs/skill-platform-v0/overview.md
  子系统：机构如何定义 skill、上传 skill、运行 skill

项目开发文档/提示词设计哲学.md
  Prompt 与 agent 行为哲学：Less Structure, More Intelligence

src/lib/consult/service-action-atoms.ts
  当前代码里的服务动作原子注册表

src/lib/consult/arena.ts
  当前代码里的规则评测器雏形
```

历史文档可以保留，但不能再作为开发入口。任何新开发如果不能挂到五个一等公民之一，默认不做。

## 下一步开发顺序

### Step 1：文档降熵

- 明确本文是顶层 spine。
- 把 Education Service OS 标注为 reference implementation。
- 把 Skill Platform 标注为 infra 子系统。
- 删除旧 academic-engine / service-in / service-after 等会误导方向的历史 spec。

### Step 2：Trace System v0

- 统一记录 tool trace、UI artifact、用户动作、状态写入。
- 为每个 trace 标注对应 atom。
- 在 console 能看一条 session 的 trace。

### Step 3：Eval Agent v0

- 从 Percy flagship case 起步，但不要把 case 写成产品逻辑。
- 输出 score、失败原子、证据、改进建议。
- 支持评测 UI 信息负荷、workflow lock-in、画像误写、搜索 grounding。

### Step 4：Artifact Runtime v0

- 让 CV 诊断、导师探索、申请方案等变成可更新 artifact。
- 按钮点击后由 agent 根据 artifact 状态决定下一步，而不是进入固定 workflow。

### Step 5：机构自定义评测

- 机构为自己的 skill 提供 rubric、样例、失败模式。
- Eval Agent 用这些约束评测机构数字员工。

## 开发决策检查

每次要新增功能，先问：

1. 它增强了哪个一等公民？
2. 它是否让机构更容易定义数字员工？
3. 它是否让 agent 更自由地组合服务原子？
4. 它是否产生了可评测 trace？
5. 它是否能被 Eval Agent 直接评价？

如果答案不清楚，先不做。
