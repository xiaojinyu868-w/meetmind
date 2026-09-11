# TEACH_TUTOR_ENGINE — AI 家教课堂引擎设计

> 状态：设计定稿 + 垂直 spike 完成（2026-08-30，P0 验收见 §9 与 `out/tutor-engine-spike/REPORT.md`）
> 上游研究：`out/teach-harness-ab/REPORT.md`（harness A/B 实测）、`out/openmaic-study/`（OpenMAIC 源码，MIT）、`out/codex-spike/REPORT.md`（codex 调研）
> 一句话：**pi 做 loop 运行时 + vendor OpenMAIC 引擎栈（28 动作）+ 自研只留在教学大脑和交互层**——能站肩膀的站肩膀，自研的每一层都论证过必要性。

---

## 1. 定位

把 teach 线从"会说话的板书工具"升级为**AI 老师课堂引擎**：一位老师在一块活的黑板上**表演式讲课**——边说边写边画，公式/图表/代码逐行长出，关键处聚光灯压过去，学生随时插话，老师针对性回应后自然衔回进度。能力来自可插拔的 skill 集，记忆来自学生模型，记忆来自学生模型。

与 OpenMAIC 的分野不变：它的课是**预编排脚本**，我们的课是**活对话**；它解决"没有课可上"，我们解决"有人在认真上课"。引擎工艺对齐它，产品形态守住自己。

## 2. 选型结论与实测依据

### 2.1 harness 三选一：pi（实测 + 调研双重结论）

| 候选 | 实测/调研结论 |
|---|---|
| codex app-server | 教学轮 ~58-61k input 无缓存重放、一次板书=一次完整 roundtrip、coding 心智压不干净、版本跟进税三次实证（`out/codex-spike/REPORT.md`）。**退守 fenshen 蒸馏线**（那边真正需要进程隔离） |
| 自研薄 loop | bench 证明 B 形态协议赢，但只测了 3 场景×3 轮 happy path；compaction/断流恢复/子 agent 语义的 maturity 是自研付不起的账 |
| **pi（选定）** | `@earendil-works/pi-agent-core`，MIT，55k stars，Earendil 公司化全职运营（Mario Zechner），提交活跃；进程内 loop 零 spawn；原生 Agent Skills 标准；子 agent 带预算/超时（native-child 模式正好跑 skill）；OpenMAIC v1.0 生产级验证过 StreamFn 桥接模式 |

### 2.2 教学输出协议：结构化动作直出（bench 实测最优）

3 provider × 3 场景 × 3 轮实测（`out/teach-harness-ab/REPORT.md`）：单遍结构化直出 vs 工具 loop vs OpenMAIC 忠实移植，直出形态 judge 5.00 并列最高、input 587 tokens/轮（比 codex 低两个数量级）、板书密度最高（3.5 次落笔/轮）。**28 个动作是模型的输出词汇，不是工具**——这是节奏优势的根因，任何设计不得破坏它。

### 2.3 课堂引擎：vendor OpenMAIC，不自写

动作引擎、choreography 时间轴、playback 状态机、白板 op-log、TTS 工艺——人家迭代了两年（v0.1→v1.0，每 2-5 周一版），我们一行不自写。`@openmaic/dsl` 自述 "pure, dependency-free contract"，就是为可搬设计的。

## 3. 总体架构

```
学生消息 / 插话 / 拍板书补充
        │
        ▼
┌─ 教学 agent loop（pi，进程内）────────────────────────┐
│  system prompt = 教学人设 + 学生模型 + 板上状态摘要            │
│  每轮模型自主判断深度：                                     │
│    · 直接表演 → 输出 [speech, wb_*, spotlight, ...] 动作流   │
│    · 需要深想 → 调 skill（出题/实验/检索/费曼…）或子 agent      │
│  skill = Agent Skills 标准 SKILL.md（与 fenshen nuwa 同格式）│
└──────────┬─────────────────────────────────────────────┘
           │ 唯一事件流（教学动作协议）
           ▼
┌─ 课堂引擎（vendor OpenMAIC）───────────────────────────┐
│  动作引擎（blocking 二分契约）→ choreography 时间轴        │
│  → playback 状态机（idle→playing→live）→ 白板 op-log      │
│  节奏层：动作锚到前句语音、TTS 预取、StreamBuffer pacing    │
└──────────┬─────────────────────────────────────────────┘
           │
    ┌──────┼──────┐
    ▼      ▼      ▼
  板书   语音    交互件
  渲染   TTS    （iframe srcDoc + postMessage，
  执行         widget_* 动作的操纵对象）
```

**没有人工划分的快慢通道**。"快"与"好"是模型每轮的自主决策（thinking budget + skill 调用），等待被叙事覆盖（"我先画个框架，稍等我构造个实验"）。快慢只是涌现结果。

## 4. 组件来源总表

| 组件 | 来源 | 说明 |
|---|---|---|
| loop 运行时 | **npm 依赖 pi-agent-core**（钉版本） | 会话协议、compaction、子 agent、thinking budget |
| 28 动作执行引擎 | vendor OpenMAIC `lib/action/engine.ts` | blocking 二分契约：fire-and-forget（spotlight/laser）vs synchronous（speech/wb_*） |
| 时间轴/时长 | vendor `lib/choreography/` | 动画时长唯一真相源；导出与回放共用 |
| 播放状态机 | vendor `lib/playback/` | generation 计数器失效、先置 mode 再停音频、讨论打断存-恢复闭环 |
| 白板状态 | vendor `lib/whiteboard/runtime/`（op-log） | 事件溯源；换写者账本（多 agent 共板时）从 summarizers 补 |
| 流式动作解析 | vendor+修 bug | **修 `endsWith(']')` 吞口播 bug**（深度计数），提 PR 回上游 |
| 存储 | vendor `@openmaic/storage` 的 IndexedDB 后端 | 砍 PG 后端；validator 注入写边界 |
| TTS | vendor 预生成/降级链思路 + 适配器 | 按句合成、时长估算、三级降级 |
| LLM 路由 | **自研接缝**：StreamFn → 我们的 provider 注册表 | 复用 `app.config.ts` + `llm-service.ts` |
| 教学 prompt | **自研** | 人设有根、学生冷场即事故、动作词汇契约 |
| 学生模型消费 | **自研** | 每轮注入 LearnerProfile（已掌握/误区/前序表现） |
| 插话/续讲语义 | **自研** | OpenMAIC 没有的东西，交互优势核心 |
| 学生产出进课堂 | **自研** | 学生拍题/作业照片插入课堂，AI 讲学生自己的东西（真课证据不进，见 §1 边界） |
| UI 交互层 | **vendor 基座 + 重设计** | OpenMAIC classroom UI 组件（stage/whiteboard-canvas/scene-renderers，React+Tailwind+shadcn 同栈）作实现基座，交互形态按 §5.5 重设计、Taste 宪法把关。不自研也不原样照搬——我们 UI 弱，承认并站肩膀 |
| skill 内容 | **拿为主** | 三个开源来源（见 §5.2）：OpenMAIC 23 个内置教学法 skill（MIT，feynman/curriculum/UbD…直接可用）+ pi-skills 生态 + ClawHub；自研只补 lab-sim/quiz-maker 等我们特有形态 |

自研必要性论证：上表"自研"各项全部是 OpenMAIC 不存在的能力（学生模型、插话语义、学生产出进课堂）或宿主必须握有的接缝（LLM 路由、教学人设）；UI 与 skill 内容改为"vendor/拿为主 + 设计把关"，不自写。

## 5. 关键设计

### 5.1 教学动作协议 v1（首批 ~12 个）

vendor 全量 22 类，v1 启用：

`speech · wb_open/wb_close · wb_draw_text · wb_draw_shape · wb_draw_line · wb_draw_latex · wb_draw_table · wb_draw_code + wb_edit_code · spotlight/laser · discussion · widget_show`（交互件随 v2）

三条硬约定：
- **一切元素带稳定 `elementId`**——单写者今天用不上账本，但 id 约定零成本，是分身×家教合流的前置
- **动作即输出**：模型一轮输出 `[{type:"action"...},{type:"text"...}]` 交织 JSON 数组，流式增量解析（partial-json + jsonrepair，已 vendor）
- **skill 产物也走动作协议回来**（如 `widget_show`）——对外只有一种事件流，前端不感知"老师这轮想没想"

### 5.2 skill 运行时

- 格式：**Agent Skills 标准**（SKILL.md + 按需加载）——pi 原生实现，与 fenshen 的 nuwa skill、OpenClaw 生态同格式。**分身线产人物 skill，家教线产能力 skill，同一引擎消费。**
- 运行：skill 可跑成 pi 子 agent（带预算/超时/熔断，native-child 模式）；简单 skill 降级为"SKILL.md 注入 + 普通工具"
- **内容三个来源（拿为主，不自写教学法）**：
  1. **OpenMAIC 内置 skill ×23**（`out/openmaic-study/skills/agent-runtime/`，MIT）：feynman-learning（费曼循环，152 行成稿）、curriculum-planner、understanding-by-design、spiral-curriculum、social-emotional-learning、learning-to-learn、k12-core-literacy-planning、teacher-style-clone、lecture-style、workshop-style、deep-interactive、deep-research、fact-check 等——教学法直接可用，个别引用 stage-design/slide-dsl 的段落需裁掉
  2. **pi-skills 生态**：badlogic/pi-skills + ClawHub 市场（格式同标准）
  3. **自研补缺**：quiz-maker（vendor grading.ts 双轨判分）、lab-sim（自包含 HTML + iframe srcDoc + postMessage，含 selector grounding）、code-demo（驱动 wb_code 动作对）、人物分身（fenshen 蒸馏产物）
- 治理：拿来的 skill 进 eval 门禁（出题判分准确率、费曼循环完整度可自动检），不合格禁用——已接线 `tests/eval/teach/`（quiz-maker 出题闭环 e2e + 判分准确率入 regression-guard baseline，2026-09-05）

### 5.3 插话与续讲语义（自研核心）

打断不是"暂停续播"，是**理解→针对性讲→衔回**三拍：

1. 打断发生：playback 引擎存讲课游标（vendor 已有此能力）→ 进 live 模式
2. 插话作为新一轮输入进 agent loop，学生模型+板上状态一起进 prompt
3. 续讲：事件日志充当进度指针，prompt 要求模型自然衔回（"好，我们回到刚才的…"）；续讲质量进 eval 指标

### 5.4 学生模型

每轮 system prompt 注入：已掌握概念、常见误区、前序课表现（来自 LearnerProfile.memories，沿用既有入库纪律：只有用户表现出的学习事实才入库）。"一对一"与"通用讲课"的分水岭，OpenMAIC 完全没有这层。

### 5.5 交互形态（重设计，P3 核心交付）

承认现状：我们的 UI 弱，不从零自设计，也不原样照搬 OpenMAIC。做法是 **vendor 其 classroom UI 组件为基座（stage/whiteboard-canvas/scene-renderers，React+Tailwind+shadcn 同栈），交互形态按下述原则重设计，Taste 宪法把关**：

1. **板书即舞台**：画布是视觉中心；老师是声音不是头像（人格分身除外）；chrome 极简，95% 时间界面上只有板 + 声音
2. **语音优先的双向**：学生按住说话即插话（ASR 已有），也可点板书区域圈选提问（"这里为什么？"）；打断三拍见 §5.3；老师回应气泡**锚定到板上的具体元素**，不是聊天列表
3. **节奏可视化**：聚光灯/激光笔引导学生注意力（vendor 动作）；skill 深想时老师先开口铺垫（"我构造个实验，稍等"），等待永远在叙事里
4. **学生产出进课堂**：拍题/作业/草稿照片插入，AI 讲**学生自己的**东西——这是比"真课证据"更适合课堂的锚点（学生物件天然相关，不引入外部转录噪声）
5. **课后无缝沉淀**：课堂的板 + 对话自动成为复习材料回到 MeetMind 主线（课堂线闭环），这一拍 OpenMAIC 没有
6. **重设计流程**：先出交互形态设计稿（design-demo 惯例，HTML 可点），评审过后再进实现；禁止边写代码边想交互

## 6. 与现有线的关系

- **teach-codex 线**：本引擎是它的继任者。SSE 事件契约、事件日志（`data/teach-events/*.jsonl`）、11 个板书工具 schema、speech-pipeline/声画闸门、前端画布的**交互概念**保留评估，实现层随引擎替换。迁移期间旧线并行可回滚
- **codex harness**：不退仓，退守 fenshen 蒸馏线（那边需要进程隔离 + 原版 nuwa skill 运行环境），shim 资产继续服役
- **BoardEnv / board 线**：板书语义对齐动作协议（elementId、op-log），双轨收敛到 vendor 引擎
- **应用矩阵**：`widget_show` 动作 + iframe srcDoc 方案是应用矩阵"动手场景"的入口；「讲给同桌听」等 app skill 化

## 7. Fork 与依赖策略

- pi：npm 依赖，**钉死版本**；只消费 loop 语义，模型层完全经 StreamFn 自控——将来即使换运行时，教学协议层不动
- OpenMAIC 栈：**vendor 一次、当自有代码维护**；上游每 2-5 周的迭代只选择性 cherry-pick（安全修复、解析器修复），功能分歧不追
- **LGPL 雷区**：`packages/mathml2omml`（PPTX 公式导出专用）永不引入；PPTX 需求将来用 MIT 替代方案
- 上游回馈：解析器 bug 修复提 PR 回 THU-MAIC

## 8. eval 闭环

- 效果维度：复用 `out/teach-harness-ab/` bench（TTFT/板书密度/judge 盲评），接入 CI 成为 teach 版 `eval-guard`
- 健壮性维度（pi maturity 的对价验证）：30+ 轮长会话 compaction、中途 abort、provider 5xx、skill 超时熔断、畸形输出恢复
- 插话维度：打断→回应→衔回的三拍质量单列评分

## 9. 分期计划

| 期 | 内容 | 验收 |
|---|---|---|
| P0 spike | vendor 引擎栈 + pi + 28 动作端到端（质数课） | `out/tutor-engine-spike/REPORT.md` 数字对齐 bench |
| P1 引擎落地 ✅（2026-09-05） | 主路接入：pi loop + 动作协议 + 播放引擎 + 渲染缝，替换 teach-session-service 编排层 | 已达标：check/test/build 绿、e2e 双引擎分发实测、bench 开场轮 input 1154 tok（≤门槛）、板书 7-11 次/轮 |
| P2 skill 体系 ✅（2026-09-05） | Agent Skills 运行时 + quiz-maker/lab-sim 首发 + fenshen 人物 skill 挂载 | 10 个首发 skill 落 assets/teach-skills/（8 vendor 教学法裁剪版 + quiz-maker + lab-sim 占位）+ 多源合并（fenshen 人物根）+ 加载单测 7 例 + 出题 e2e 与 eval 门禁落 tests/eval/teach（dry-run 门禁绿 6/6；real 已首测：判分 5/6 准，但判分轮不引用 quiz_qN 锚点（5 例）——锚点纪律待 prompt 收敛，列入 P3 缺口） |
| P3 交互闭环 🔶部分（2026-09-05） | 渲染器已补齐：shape/table/line/code 块渲染 + wb_edit_code 行级编辑 + laser 瞬态光圈（live 才落地）+ 词表默认放开全量；交互形态设计稿已出（`design-demo/teach-classroom-v1/` 六页可点，待 Taste 评审）；**未做：插话三拍 eval、学生模型消费、节奏层、finish/done 语义、设计稿评审后的换肤实现、quiz 锚点纪律 prompt 收敛（P2 real 首测暴露：判分轮不引用 quiz_qN）** | — |
| P4 迁移收尾 | teach-codex 退役评估、文档同步（本文件 + 各 DOMAIN.md）、eval-guard 常驻 | AGENTS.md 主线更新 |

## 10. 风险与开放问题

- **pi 与教学的错配残留**：pi 是 coding harness 出身，baseInstructions/内置工具需压掉（OpenMAIC 用 STUB_MODEL + 全量 StreamFn 桥的经验照抄）；残留程度 spike 实证
- **vendor 栈的 scripted DNA**：playback 假设动作流已知；活对话下动作流边生成边执行，靠其 live 模式 + generation 计数器适配，spike 必须验证这一点
- **skill 质量参差**：技能包需要评测门禁（出题为样例：判分准确率进 eval）——已建立（tests/eval/teach + regression-guard teach 段，2026-09-05）
- **多写者账本**（分身×家教共板）：协议 v1 只埋 elementId 约定，账本实现列为合流前置项，不提前做

---

## 11. 迁移决策记录（2026-09-04）

**决策：启动迁移，按 P1→P4 分期走，codex 线双线并存至 eval-guard 达标后切流，P4 再评估退役。**

背景：teach 线插图（image 工具）依赖课后卫士回填 dashscope 生图（`teach-codex/image-backfill.ts`，2026-09-03 补），分钟级、不可流式，曾出现插图永久卡「生成中」的用户可见事故。调研结论（流式 SVG / json-render / OpenGenerativeUI / 知识画家访谈 / OpenMAIC 源码）收敛于同一点：**教学视觉应代码驱动直出（动作即输出词汇），扩散生图降级为装饰性用途**——这正是本文件 §2/§3 已定的架构。

迁移范围按 spike 实测修正（非全量搬 OpenMAIC）：
- **搬**：pi-agent-core loop + vendor 闭包 4 模块（action/engine、choreography/*、orchestration/stateless-generate、logger）+ 8 个 ≤60 行 UI shim（`out/tutor-engine-spike/REPORT.md` §TL;DR-4）
- **不搬**：LangGraph director + 重 prompt 栈（账本/冲突检测/代码预算）——B2 忠实移植实测无质量增益、input ×17（`out/teach-harness-ab/REPORT.md`）
- **自研不变**：教学 prompt、学生模型、插话语义、LLM 路由接缝
- **已知代价**：teach-codex 编排层退役时 image-backfill 随之废弃（dashscope 生图服务保留作装饰性用途）；fenshen 线继续用 codex（进程隔离需求不变），teach-codex 通用件照常维护
- **P3 交互形态重设计后置**：先吃 P1（引擎）+ P2（skill）收益，把课中体验修到可用；P3 启动前单独出设计稿过 Taste 评审
- **P1 验收门槛**：旧 teach 场景回归 + `make check` + bench 数字对齐 `out/teach-harness-ab/`（input/轮 ≤ B 形态 2 倍、板书密度 ≥3 次/轮、解析器无截断）

---

## 12. 第三代引擎决策记录：live stage（2026-09-10）

**决策：在 codex / engine 之外再开一条 `live` 线（`TeachThread.engine='live'`，前端 `/teach/live`），作为「AI 一对一上课表现上限」的探索主路；前两条线不拆，作为对照组并存，切流与退役留到 live 线 eval 达标后再议。**

用户原话（目标）：AI 做一对一，真人老师 1/4 的价格、相近甚至某些方面更好的效果——更好的表现形式、更好的多模态生成、基于代码的流式生成，给学生更生动的表现；对现有形态（前端表现、交互、延迟）都不满意；不造轮子、看开源（含 OpenMAIC）但要比它们做得更好；模型用 GLM 5.3 Flash。

### 12.1 重新审视了哪些前代决策

| 前代决策 | 重新判断 | 结果 |
|---|---|---|
| §2.2「28 个动作是模型的输出词汇，不是工具」 | **保留并推到底**：不仅动作是输出，图形本身（SVG / LaTeX / 代码 / HTML）也是输出词汇 | 标签流协议：块正文是原生文本 |
| §2.2 结构化 JSON 数组直出 | JSON 包装让 SVG 必须整个 action 闭合才能解析，无法逐笔上板；字符串转义放大 token；首 `say` 被包装稀释 TTFT | **换成标签流**（`<say>` `<svg>` … 交错），两态增量解析器 |
| §2.3 vendor OpenMAIC 动作引擎 / choreography / playback（服务端执行动作、估时 pacing） | 服务端模拟板书状态与节奏是为「预排脚本」设计的；活对话里真正的时钟是**前端的 TTS 播放**。服务端 pacing 等于对着估时演戏 | **服务端不再执行动作、不做节奏**：只解析 + 扇出；节奏在前端 Director 按真实语音出声时刻放行（到达 / 演出两条时间轴）。vendor 树保留给 engine 线，live 线零依赖 |
| §2.1 pi loop（compaction / 子 agent / skill read 工具） | 上课的一轮不需要工具 loop；skill 机制的价值在 P2 已被 prompt 直给取代大半 | live 线一轮 = 一次 streamText；历史用事件日志重建、重块压占位 |
| 词表：wb_draw_text / latex / shape / table / code…（前端每种一个渲染器） | 让模型画 shape/table 的坐标是低效的；真正拉开与真人差距的是**代码驱动的表现形式** | 词表按表现形式重划：svg（自由图形，逐笔长）/ plot（声明式函数图，代码排版永不重叠）/ diagram（mermaid）/ anim（SVG+CSS/SMIL 动画）/ widget（沙箱交互件）/ image（异步生图）/ math / note / code |
| 生图：teach-codex image-backfill 课后回填；§11「扩散生图降级为装饰性用途」 | 结论不变，但接法变了：块一闭合就开始生成（比 turn 收尾早半分钟），老师口播里顺口说「图稍后出现」照常往下讲 | `<image prompt>` + 占位卡 + image-ready 淡入 |
| 前端：备课本画布 + 右侧对话栏（`/teach`） | 对话栏把「上课」做成了聊天；板不是主角；字幕与声音不同步 | 暗色舞台 + 一块暖白板占满中间；字幕跟声音；输入退成底部一行胶囊；按住说话即打断 |
| 默认模型 Gemini 3.7 Flash 经 commonstack（TTFT 4–30s 抖动） | 实时课堂 TTFT 是体验的地板 | 百炼 GLM-5.3-Flash + `reasoning_effort=low`（该模型不可关思考，low 把推理压到 0）：TTFT 0.8–1.1s、~140 tok/s、无 400 |

### 12.2 站在什么肩膀上

- 复用本仓库：teach-codex 的 event-bus / thread-store / 事件日志（SSE 契约不破，只追加四种块事件）、`TeachSpeechPlayer`（按句 TTS、预取——本次改为预取两句）、`useVoiceInput`（流式 ASR）、`dashscope-image-service`、`ChatCodeBlock`（shiki）、learner 读槽。
- 开源轮子：KaTeX（公式）、mermaid（图示）、react-markdown + remark-math（要点）、shiki（代码）、Web Animations API + `getTotalLength`（描画，零库）；OpenMAIC 留下的是思想（动作即输出、blocking 二分、pacing 锚到语音），不是代码。
- 没拿的：Manim / Motion Canvas（重、不可流式）、GeoGebra（许可）、tldraw/Excalidraw（自由画板不是老师需要的）。

### 12.3 实测（2026-09-10，dev 服务器 + 真模型 + 真 TTS + Playwright）

- 一轮开场：input 2.5–2.7k tokens、output 1.1–2.4k、TTFT 0.78–1.05s、生成 8–18s，产出 3–8 张图（含 `into` 分步追加）+ 公式 + 要点，2–3 页。
- 三个课题都用到了 ≥3 种表现形式：勾股定理（svg 分步 + math + note）、导数（svg + plot 割线 + anim 割线转切线 + math）、浮力（svg + note + math + anim + **widget 滑块拉货物吨数看船吃水**）。
- 插话：「等一下，斜边是什么意思？」→ 老师闭嘴 → 针对回答并 `point` 回图里的 `tri#legs` / `tri#hyp` → 5.2s 生成完 → 自然衔回。
- 首句出声：生产链路估算 ~3s（建课 50ms + ack 100ms + TTFT 0.9s + 首句 0.4s + TTS 1–1.5s）；dev 下首次命中多 4–6s 路由编译。

### 12.4 第二轮（2026-09-11）：精确性的通用解法——代码即意图

用户追问两点：(1) 切线、圆、函数图像这类严谨内容出错不可接受，应该在代码层被定义而不是用坐标画；(2) 几个原语堵不住所有情形，要**通用**解法；(3) 任何方案都不能伤现在的低延迟与音画同步。

**判断**：模型是在预测 token 不是在计算，凡有计算真值的东西靠预测就会错。通用解法不是 DSL 原语，是「模型写程序、确定性运行时算并渲染」（Manim / GeoGebra / coding agent 同一结构）：通用的部分是**语言**，库只省力气。落地为 `<draw>` 块（`src/lib/teach-live-draw/`，Worker 沙箱执行，几何 / 分析 / 排版 / 动画 / 滑块全在库里，模型只写构造），同一原理顺手解决口播里的算术（`{{ }}` 内联计算）。对「上限」问题的回答：结构放在**渲染合同和工具**层不压上限（`<svg>` / `<anim>` / `<widget>` 三个通用逃生口始终开着），放进**规则**层才压——所以 prompt 说的是「要对的图用 draw 更稳」，不是「必须」。对「延迟」问题：脚本在浏览器本地毫秒级执行，不进关键路径；同步机制（Director 按 TTS 出声时刻放行）完全不动，而且代码生成的动画时长可控，能和那句话对齐。视觉自检（老师看一眼板）不确定有用，未做。

同轮收口：手绘感笔迹（rough.js，可切）、回看这节课（事件日志按当年节奏 + 声音重放）、指着板上的东西提问、语速 / 空格说话、Octo Buddy 头像、每节课成本行（刊例价：GLM-5.3-Flash 输入 0.8 / 输出 2.8 元每百万 token；一节开场 ≈ ¥0.008）。回滚基线 tag `teach-live-v1`。

实测（dev + 真模型）：「圆的切线有什么性质」——切线由 `tangentAt` 算出，直角标自动出现；插话「为什么切线一定垂直于半径」→ 新一页用 `foot` 构造圆心到直线的垂足证明；零控制台错误；首句 1.4s、首笔 8.9s（钩子两句后落笔）。

**上线后第一节真实课的反馈（阿波罗尼斯圆，2026-09-11 中午）**：模型 4 段脚本 2 段有变量笔误 → 整图消失；手绘模式下 trace 动点停在原点；几何本身正确。修法遵循同一原则——模型笔误由系统吸收而不是靠祈祷：运行期报错部分渲染；段闭合即预跑，报错让模型只修那一段（服务端复跑验证），藏在口播的时间里；mpath 重指到 rough 描边。模型能力反馈：GLM-5.3-Flash `reasoning_effort=low` 写 JS 有约 10–25% 的粗心率（忘 const、占位语句），几何与公式本身没错过。

### 12.6 前沿对照与第三轮（2026-09-11 下午）：画面本身的上限

用户把优先级钉在「画面本身」：一个陌生人随手问一个数学 / 物理问题，10 秒内看到的画面要达到专业教学动画的水准；交互层与舞台式外层布局都往后放（加上去只会让系统复杂，不符合 Bitter Lesson）。

先看了前沿：**OpenMAIC**（白板动作 = 模型写像素坐标 + 矩形 / 圆 / 三角形三种形状，无几何真值、无内容动画、预排脚本）；**TheoremExplainAgent**（ACL 2025 Oral：agent 写 Manim，o3-mini 成功率 93.8%、总分 0.77 ≈ 人做的 Manim 视频，但 Element Layout 只有 ~0.6——重叠是头号顽疾）；**Code2Video**（NUS 2025-10：Planner–Coder–Critic 写 Manim，代码中心比像素生成学习效果 +30%，加规划 +40%；Visual Anchor Prompting 6×6 格子让 EL 0.59→0.91；ScopeRefine 局部修复省 2.5×；VLM Critic 看图改布局；人对一瞬间遮挡极敏感，美观与学习效果相关 0.97；代价一条 3 分钟视频 15 分钟、3 万 token，离线、无交互）。共同结论：代码是正确底座；规划 + 反馈循环是质量来源；布局要给结构先验。共同局限：全是离线批处理，没有实时对话——那是我们独有的位置。

这一轮拿的三样：
1. **时间原语**（`time(t)`，`src/lib/teach-live-draw/timeline.ts`）= Manim 的 ValueTracker + updater：整张图写成 t 的函数，运行时采样每帧精确几何，编译成 SMIL 属性插值由浏览器原生播放。实测：P 在圆上转、切线永远相切地跟着转、直角标跟着、角度读数逐帧变；割线随 smooth(t) 滑成切线并回弹；圆带坐标系时自动保形（此前会被拉成椭圆）。模型第一次见到 prompt 就用对了。
2. **布局先验**：`<draw>` 加 `note('…', 'top-right')` 九区域批注（不算坐标、自动叠放换行）；自由 `<svg>` 的 prompt 给 6×6 锚点格（Code2Video 实测最优粒度）+ 一套语义 class 与预注入的箭头 / 发光 / 渐变 defs；draw 标签自带纸色晕边不压线。
3. **代码版 Critic**（`layout-critic.ts`）：渲染后文字框重叠自动挪开，毫秒级、零延迟；刻度轴名作障碍不动。VLM 版留给自由 svg 的事后修。
另加：公式逐行长出（`<math into>`）、颜色宏与图同色（`\pine{a^2}`）、`\htmlId` 项可被 point 指到。

没做（有意）：舞台式主画面 + 公式栏的外层布局；`<plan>` 分镜（先看 eval）。

### 12.5 已知缺口（下一步）

1. 自由 `<svg>` 示意图的重叠仍靠模型；若观察到高频，再试「事后修」的视觉自检（不进关键路径）。
2. 语音 barge-in（自由说话打断）与拍题进课堂。
3. 课后沉淀：事件日志 → 复习材料回主线。
4. eval：复用 `tests/eval/teach/` 结构给 live 线加「表现形式覆盖 / 首笔时刻 / 插话三拍 / draw 脚本报错率」grader，达标后评估切流与前两线退役。
5. prompt 里按今日模型与 TTS 写死的节奏数字（首句 ≤25 字、两句内落笔、一页 3–5 块）是有理由的默认值，下一个更强的模型来了先跑不带这些约束的对照，用数据决定留不留。
