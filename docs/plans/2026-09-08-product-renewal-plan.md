# 产品全面优化与新生方案（2026-09-08）

> 写给产品负责人与下一个 coding agent。依据三份证据：生产库只读查询（`prisma/meetmind.db`，
> 2026-09-08 11:30）、应用矩阵与记忆链路的代码审计、线上真实旅程走查（附录 A）。
> 本文回答三个问题：产品现在在哪、"新生"该往哪个方向、什么现在就能做。

---

## 0. 一句话结论（v2，2026-09-08 下午按产品负责人的论点修订）

**产品论点**：今天所有 AI 学习工具的共同问题是"每一次都重新认识用户"。MeetMind 里每一个具体学习问题都是一个独立的
**Application**（课堂、论文、考试、答辩、AI 家教……），每个 Application 第一次使用就有价值，同时共同读写同一套学习记忆；
用得越多，系统对这个人的理解越完整，之后每一个 Application 都更好用。每增加一个 Application，既增加一个入口，也增加整套系统的价值。
**正在验证两件事：一个 Application 本身是否成立；历史 Context 能带来多大的体验提升。**

**数据怎么说**：近 30 天只有 3 个登录用户产生过课堂；9 个应用各被用过 2–30 次；`LearningEvent` 表 1 条。
v1 版本的我把它读成"收窄到录课循环"，这是错的——**录课是小众心智**，而今天所有 9 个应用都被锁在"录课 → 复习页 → 矩阵"这一条漏斗后面，
它们作为独立 Application 的价值从来没有被测过。9 个应用各 2–30 次使用，量的是漏斗，不是应用。

**所以新生 = 把产品拆成独立的 Application：每个有自己的入口、自己的输入（不依赖一节录好的课）、第一次用就有产物，
全部读写同一套学习记忆（context 系统在另一台服务器上做，新版本即将合并进来）。** 本文其余部分据此重写：
§2.5 说清"拆"在这个代码库里意味着什么、哪里已经有、哪个是真缺口；§5 说清两个假设怎么测；§6 说清与外部 context 系统的接缝。
v1 里"冻结 teach / fenshen"的建议撤回——它们正是最接近"独立 Application"形态的两条线。

---

## 1. 数据说了什么（生产库，只读）

> 口径提醒：服务端 SQLite 只看得到登录用户与埋点；纯访客在浏览器 IndexedDB 里的活动不在此。所以下面的数字是下界，但量级可信。

### 1.1 流量与留存

| 指标 | 数字 |
|---|---|
| 注册用户 | 73（3 月 19、4 月 18、5 月 10、6 月 11、7 月 2、8 月 9、9 月 4） |
| 近 90 天会话 | ~920；**78% 在 1 分钟内离开**（<10s 456、10–60s 259）；1–5 分钟 136；>5 分钟 69 |
| 新访客会话 | 每月 100–160（≈ 4/天，稳定的小流量） |
| 近 30 天有课堂产出的登录用户 | **3** |
| 课堂 capture 按月 | 164 → 186 → 44 → 102 → 141 → 73 → 6 |
| 近 90 天页面 | `/app` 1129、`/` 529、`/login` 200、`/settings` 86、`/technology` 66、`/app/matrix/infographic` 33、`/teach` 28 |

解读：顶部漏斗没断（每天都有新人来），但**第一次会话留不住，第二次几乎不发生**。`/login` 200 次说明登录墙是真实摩擦。

### 1.2 应用矩阵真实使用（积分账，2026-08 起）

| 应用 | 执行次数 | 用过的人 |
|---|---|---|
| 思维导图 | 30 | 4 |
| 课堂测验 | 29 | 6 |
| 课堂信息图 | 24 | 6 |
| 讲给同桌听 | 18 | 4 |
| 闪卡训练 | 15 | 3 |
| 课堂播客 | 13 | 2 |
| 板书精讲 | 11 | 3 |
| 考试速查表 | 2 | 1 |
| Tutor review 对话 | 38 轮 | 3 |

另有 2200 条 `spend/other`（1 个用户，≈9 元成本）——是 teach / fenshen 内测。模型 97% 是 `qwen3.7-plus`。

### 1.3 其他线

- **收集来源**：local-session 295、**wechat 204**、live-audio 97、video 42、manual-note 36、document 3。微信是第二大入口——"随手发给同学"的低摩擦收集是被验证的。
- **分享裂变**：45 个 SharedAgent、191 次访客互动、7 次领取（3.7%）。落地页有自然流量。
- **AI 家教 teach**：28 个线程（8–9 月），基本是内测。**分身 fenshen**：2 个。
- **学习记忆事件化**：`LearningEvent` 1 条（P0 半成品，只有全局问答在写）。

---

## 2. 应用矩阵：审计结论

### 2.1 底座是好的，不要推翻

插件系统（`registry` + 9 plugins）、`ContextPack` 三层上下文（class / unit / exam）、证据回锚（`evidence-grounding`：模型时间戳只是候选，必须与原文语义匹配）、
readiness 双重门（模型只能推荐不能剥夺能力）、结果缓存、积分、分享快照——这套底座是过去几个月最扎实的工程资产，**新生在它上面长，不重写**。

### 2.2 五个结构性问题

1. **产物不回流成理解**。测验错题、闪卡"没记住"、讲给同桌听的盲区，现在只以一行文本进 `recentLearningActivities`
   （客户端 merge → PATCH 整体回写，24 条滚动，legacy 路径），并写进复习页的会话态黑板（`useState`，刷新即失，桌面 only，12 条）。
   没有任何一条变成"这个学生对概念 X 仍不稳"这种可累积、可迁移的状态；`LearningEvent` 管线（P0）已经存在却没接应用。
2. **应用之间互不知道**。闪卡不知道你刚在测验里错了什么；讲给同桌听的目标点不是你最薄弱的；下一节课的课中同桌不知道上一节课的坑。
   每个应用的输入都是同一份"转录 + 困惑锚点 + 术语 + 目标"，输出各自为政。
3. **推荐是 if/else，不是同桌的判断**（`workshop-recommendation.ts`：有困惑点→测验，有难点→闪卡，≥24 段→导图）。
   结课时那一次 `lesson-understanding` LLM 调用（已产出标题 / 摘要 / 精选）本来最有资格说"你现在先做哪件事、为什么"。
4. **prompt 层部分退回了"否定式微管理"**（quiz system prompt 里的字数上限、禁语清单），与 `提示词设计哲学.md` 不一致；
   同时 8 个应用没有任何 eval 门禁（eval 只覆盖 asr / tutor / teach），改 prompt 全凭感觉。
5. **入口仍是选择题**。目录页把 8–10 张卡摆给用户选。v1.2 把"生成工具"改成"学习动作"是对的，但和"零提问产品"仍有张力：
   刚下课的学生不知道自己该"检验理解"还是"记住核心"，知道的人是听过这节课的同桌。

### 2.3 新生方向：从"应用矩阵"到"记忆驱动的下一步"

同一套底座，改变的是数据流向与入口心智：

```
现在：  转录 ──► 应用 A ──► 产物（看完即弃）
        转录 ──► 应用 B ──► 产物（看完即弃）

新生：  转录 + 记忆 ──► 同桌判断"现在最该做什么" ──► 一个默认动作（其余在"全部动作"里）
                          │
        应用 A 的交互 ──► LearningEvent（结构化：概念 × 结果 × 证据）──► 记忆（状态迁移："曾经不稳 → 现在稳"）
                          │                                                   │
        应用 B 读记忆 ◄───┘                                                   └──► 下一节课的课中同桌 / 全局问答 / 「我的上下文」
```

**写侧（P0，可直接做）**：`LearningEvent` 新增 `assessment` 载荷
`{ v:1, appKey, sessionId, items:[{ concept, outcome:'correct'|'wrong'|'known'|'again'|'blind-spot', evidence?:{startMs,endMs} }] }`；
测验提交、闪卡打分、讲给同桌听评估各发一条；服务端不走 LLM，确定性合并进画像的"掌握轨迹"（新字段，按概念聚合，保留时间序列而不是覆盖）。
访客一期仍走本地（IndexedDB）同构结构，登录后合并——否则 78% 的首会话用户什么都留不下。

**读侧（P1）**：`context-builder` 把本用户对本课 / 本课程的掌握轨迹注入 `AppExecutionContext.learnerSignals`；
闪卡优先"仍不稳"的概念；测验避开"连续 2 次稳"的；讲给同桌听默认选薄弱目标；同桌开场白与课中同桌读同一份。

**显侧（P1）**：「我的上下文」的"对我的理解"区展示状态迁移（曾经困惑 → 已掌握），这是用户第一次**看见**"它记得我"。

**入口（P2）**：`lesson-understanding` 一次调用多出 `nextStep { appKey, reason }`；复习页首屏是"同桌的一句话 + 一个默认动作"，
目录退成"全部动作"。这才是零提问。

**度量（P0 起步）**：`tests/eval/memory/`——Context Lift：同一节课、同一问题，有记忆 vs 无记忆的回答质量差（LLM rubric）+
应用产物的"薄弱概念覆盖率"。没有这个数字，"越用越懂你"永远是路演稿。

### 2.5 Application 化：在这个代码库里"拆"意味着什么

一个 Application = **入口 + 输入 + 产物/交互 + 记忆读写契约**。逐项对照现状：

| 构成 | 现状 | 缺口 |
|---|---|---|
| **入口** | `/app/matrix/[appKey]` 已是独立应用页；`/teach` 独立；fenshen 挂在矩阵里；答辩（清小搭「上场前」`/api/compat/*` + `skills/rehearsal-coach`）已有外部客户端 | 应用页仍要 `sessionId`（取不到就拿"最近一节课"）；没有一个 Application 有自己的落地文案与第一屏；首页 hero 仍是"录一节课" |
| **输入** | `InputLayerContext = { sessionId, dataSource: live/video/demo, transcript: TranscriptSegment[], anchors }`——**每个应用的输入都是一节课的转录** | **这是真缺口。** 独立 Application 需要来源无关的输入：粘贴文本 / 上传 PDF·PPT·docx / 拍照 OCR / 链接 / 一个题目或话题 / 一节课。收集线已经把这些都 ingest 成 `WorkspaceCapture.normalizedText`，`context-pack.ts` 只需学会从 capture 而不只从 lesson 建包；证据回锚要支持无时间戳来源（按段落 / 原句引用，速查表对大纲真题已经这么做） |
| **产物 / 交互** | 9 个应用的产物形态与窗口都成立（走查确认质量好） | 无需重做 |
| **记忆读** | `MemoryLayerSnapshot` 是**这节课**的摘要 / 难点 / 术语，不是**这个人**；只有 Tutor prompt 读画像文本 | 需要一个 `LearnerContext` 读槽：每个 Application 声明"为完成这个任务我需要知道这个学习者的什么"，由外部 context 系统供给（§6） |
| **记忆写** | 三个应用已发 `assessment` 事件（P0-1）；全局问答发对话事件；课后理解发 activity | 其余应用与新 Application 按同一契约发；事件是喂给外部 context 系统的原料 |

**拆的顺序**（每一步都能独立上线）：

1. **输入层来源无关化**：`InputLayerContext` 增加 `sources: LearningSource[]`（`{ kind: 'lesson'|'document'|'text'|'image'|'url'|'topic', text, segments?, title, sourceId }`），`transcript` 退化为 `kind:'lesson'` 的一种；`context-pack` 从 capture 建包；`evidence-grounding` 对无时间戳来源按原句锚定。这一步之后，**任何应用都能不靠录课就第一次有产物**。
2. **每个 Application 一个第一屏**：应用页去掉对 `sessionId` 的依赖，首屏是"把你的材料给我"（粘贴 / 上传 / 拍照 / 选一节课）+ 一句话说清它解决什么问题；`/app/matrix/[appKey]` 升格为 `/apps/[appKey]`（旧路径 301）。
3. **首页从"录一节课"改为"你现在遇到的学习问题是哪一种"**：课堂 / 论文 / 考试 / 答辩 / AI 家教 / 讲给同桌听 各一个入口；录课变成"课堂"这个 Application 的入口之一，不再是全站前提。
4. **记忆读槽接入**：等外部 context 系统合并后，每个 Application 的 `LearnerContext` 从它取。
5. **新 Application**：论文（PDF → 结构化理解 + 提问 + 讲给同桌听）、考试（课程级材料 → 速查表 + 测验 + 模拟）、答辩（把 compat 层的「上场前」做成一方入口）。

### 2.4 每个应用的打磨清单

见附录 A（线上走查）。代码侧已确认的：

- quiz：system prompt 收回到"角色 + 意图 + 质量判据"，模板干扰项的防线留在 `resolveTypeAndOptions` 代码里（那是正确的位置）；补 eval：干扰项非模板率、证据回锚率
- flashcards：读记忆（P1）；`difficulty` 字段已在契约里但前端未用作训练顺序
- mindmap：退化形态（PRD 5.4）——它的价值在单元层，单课层考虑降权或合并进"课堂脉络"
- infographic / podcast：使用最少、成本最高（信息图 6 人 24 次；播客 2 人 13 次）——保留能力，退出首屏推荐
- teach-back：产品上最独特的一个（费曼检验 + 语音），是记忆写侧最有价值的来源，优先接 `assessment`
- cheatsheet：只在 unit / exam 层成立（2 次使用），等课程级上下文起来再说
- explainer：技术上最重（板书 DSL + 播放器 + TTS），11 次使用；冻结新特性，只修 bug

---

## 3. 其他部分（按线：状态 · 最大缺口 · 杠杆）

| 线 | 状态 | 最大缺口 | 杠杆 |
|---|---|---|---|
| **收集线** | 网页收集流 + 微信 204 条（第二大入口）| 收下之后"回来的理由"弱；`page.tsx` 3149 行是所有改动的阻力 | 微信侧已被验证，把"收下 → 第二天一条有根的回声"做成默认，而不是更多入口 |
| **课堂线（课中同桌）** | 核心；ASR 单遍定稿；同桌基于最近转录 | 课中同桌不知道上一节课（读的是画像文本，不是掌握轨迹）| 记忆读侧接进 in-class segment |
| **复习 / Tutor** | 六模式单一入口；review 是用得最多的对话（38 轮 / 3 人）| 复习页首屏是"选择题"（见 2.2-5）| 同桌给下一步 |
| **学习记忆** | P0 半成品：事件表 + 服务端蒸馏管线已在，只有全局问答在写，1 条记录 | 这是整个论点的地基，却是最没做完的一块 | **本方案的中心**（§2.3） |
| **AI 家教 teach** | 双引擎并存（codex / pi+OpenMAIC P3 部分），28 线程内测 | 是最接近"独立 Application"形态的一条线（有自己的入口 `/teach`、输入是一个话题、第一次用就有产物），但没有独立落地与获客，也不读学习记忆 | 作为 Application 样板：补第一屏与独立入口文案，接记忆读槽；双引擎收敛到一个（engine 线 P3 完成后退役 codex） |
| **请一个分身 fenshen** | v1 完整，2 个分身 | 输入是"一个人的讲课语料"，与课堂弱耦合，天然独立 | 独立入口 + 记忆读槽；名人堂孔子作为零输入的第一次体验 |
| **分享裂变** | 45 agents / 191 互动 / 7 领取 | 领取后"落到同一条收集流"的回流已做，但领取者留不下（没有记忆就没有第二次）| 记忆闭环之后再推 |
| **桌面壳 / 桌宠** | v1.3.0，参数化桌宠、旁听、热键 | 无使用数据可查（没埋点到服务端）| 先埋点，再决定投入 |
| **移动端** | `MobileAppShell` 1566 行；单列矩阵 | 收集线在手机上最自然，但复习三栏不成立 | 手机只做"收 + 看一条回声 + 一个动作" |
| **基建** | check 绿、CI 刚修通、eval 三套；服务端 TTFB 4–9 ms、in-class TTFT p50 747 ms | lint 178 红；72 个超预算文件；双 lockfile；埋点 EventTrack 5 月后停更（`tutor_chat_start` 之外无事件）；`/app` 首屏 JS ≈675 KB gzip | **先把埋点接回来**——没有埋点，本文以后写不出来；首屏体积见 P1-9 |

---

## 4. 分级路线

### P0 —— 现在就能做，不需要拍板（本周）

1. **应用矩阵 → 记忆写侧** ✅ 2026-09-08 已做（写侧留史部分）：`assessment` 事件类型（`src/types/learning-event.ts`）+
   三个窗口（quiz 交卷 / flashcards 全部打分 / teach-back 评估完成）经 `assessment-events.ts` 纯函数整理成
   「概念 × 结果 × 证据」，由 `useAppLearningActivity.recordAssessment` POST `/api/memory/events`（登录用户，幂等）；
   服务端校验并留史，**不改画像**——掌握轨迹的物化形态与读侧一起设计（P1-6），事件随时可回放重建。
   不改任何产物形态，用户无感，但数据从此开始累积。剩余：访客本地同构结构（记忆线下一步）。
2. **埋点接回来**：`EventTrack` 自 5 月起只有 `tutor_chat_start/complete`。至少补：应用打开 / 生成成功 / 交互完成、结课、分享领取、登录转化。
   没有这层，§1 的表格以后没法更新。
3. **quiz / flashcards eval 骨架**（`tests/eval/apps/`，dry-run 用冻结 LLM 输出跑 grounding + 结构断言），先把当前数字定成 baseline，再动 prompt。
4. 附录 A 走查里的 P0 / P1 bug 与文案。

### P1 —— 方向已定（Application 化），按 §2.5 的顺序

5. **输入层来源无关化 + 应用页去 sessionId 依赖**（§2.5 步骤 1–2）：这是"每个 Application 第一次使用就有价值"成立的前提。
   先做一个 Application 打样——建议**讲给同桌听**（产品上最独特、输入只要一段材料、交互本身就是记忆写侧最有价值的来源）。
6. **记忆读槽**：等外部 context 系统合并后，闪卡 / 测验 / 讲给同桌听 / 课中同桌 / teach 从它读 `LearnerContext`（§2.3 读侧、§6 接缝）。
7. **首会话与登录墙**：78% 一分钟内离开。试听课已经是很好的第一分钟；缺的是第一分钟结束时"留住这节课"的理由——把"登录才能保存"改成"先保存在这台设备，登录后带走"，
   登录动机从"门槛"变成"带走"。
8. **「我的上下文」显示状态迁移**（曾经困惑 → 已掌握）。
9. **`/app` 首屏体积**：2393 KB 未压缩 / ≈675 KB gzip / 30 chunk（附录 A 实测；服务端 TTFB 只有 4 ms）。
   这是慢网用户"打开就白屏 10 秒"的真实原因，也是 78% 一分钟内离开里可量化的那部分。
   **2026-09-08 第一刀已落：677 → 330 KB gzip（−51%），17 chunk。** 根因不是"没做 dynamic"——page.tsx 早就把
   GlobalAskPanel / 复习布局 / 应用窗口 / 移动壳全 dynamic 了——而是三行静态 import 让 dynamic 形同虚设：
   `useWorkshopWindows` 从 `WorkshopWindowManager.tsx` 取一个类型 + 一个常量（拖进整棵应用窗口树：板书 KaTeX、
   速查表 react-markdown）；page.tsx 从 `DedaoTimeline.tsx` 取纯函数 `toDedaoEntries`（拖进 TranscriptFlowView →
   WordExplainer → @ai-sdk/react + zod v3/v4 → chat markdown）；`Recorder`（首屏必须静态）里的划词解释浮窗静态导入。
   修法全是"把纯的东西抽成纯模块 + 按需出现的东西 dynamic"（`workshop-window-state.ts`、`dedao-timeline-model.ts`、
   WordExplainer 懒加载），零行为变化。剩余 330 KB 里：page 主块 105 KB（God File + Recorder 被 scope-hoisting 合成一个
   277 KB 模块——下一刀是 God File 按域切分）、react-dom 52、COPY 36（单一真相源，不拆）、Next 运行时 31、Dexie 30。
   **第二刀（同日晚）：330 → 298 KB gzip，目标达成，没动 God File。** 先做了账（`make bundle-report`：归因构建把模块 id 换成源码路径、
   关 scope hoisting，`scripts/bundle-report.py` 按文件 / 包列 gzip），账上最大的应用模块是 `copy.ts` 36 KB——其中 landing +
   technology 两块 10 KB 是营销页文案，/app 用不到却随单体进每个页面，拆到 `copy-landing.ts`；Recorder（≈20 KB 含 ASR 客户端 /
   PCM 采集）改 next/dynamic，挂载点都是 sr-only 的隐藏引擎，桌面走 autoStartSignal、手机端 waitForRecorder 短等就位；
   再切两条纯函数泄漏（收集卡片为一个 markdownToPlainText 拖进整个网页抽取服务；语音输入静态引 ASR 客户端）。
   剩余 298 KB：react-dom 53、copy 26、dexie 30、Next 运行时 27、page.tsx 18、sonner 9、lucide 9、swr 7（useSummary 真用）。
   再往下就是 God File 按域切分（收集域 hooks ≈15 KB 只在收集 tab 用）与 sonner / dexie 的按需化，收益递减。
   骨架屏方面预渲染 HTML 只有 AppLoading 品牌页，体积减半后先观察慢网表现再决定。

### P2 —— 新生级

9. **同桌给下一步**替代目录首屏（`lesson-understanding` 产出 `nextStep`）。
10. **课程级上下文**（期中起点问题，CHANGELOG 2026-08-30 已有分析结论）：把课件 / 转写聚合到"一门课"，闪卡与测验跨课出题。
11. **记忆协议对外**（终局，见 `LEARNING_MEMORY_P0_HANDOFF.md` §1）——在内部三个应用真的靠它变好之前不做。

---

## 5. 两个假设怎么测

**假设一：一个 Application 本身是否成立。** 按 Application 分别看，不看全站：

- 首用完成率：从该 Application 的独立入口进来、不靠录课、第一次就拿到产物 / 完成交互的比例
- 7 日回访：第一次用过后 7 日内再回到**同一个** Application 的比例
- 每个 Application 各自的北极星（讲给同桌听 = 讲完并看到四象限；AI 家教 = 上完一轮课；考试 = 打印 / 导出一张速查表）
- 前提是埋点（P0-2）：现在 `EventTrack` 5 月起只剩 `tutor_chat_start/complete`，这些指标一个也算不出来

**假设二：历史 Context 能带来多大提升（Context Lift）。**

- 离线：`make eval-memory`——同一个任务、同一份材料，有 `LearnerContext` vs 无，产物质量 LLM rubric 分差 + 对"仍不稳"概念的覆盖率
- 在线：第二次及以后使用同一 Application 的完成率 / 回访率 vs 第一次；以及跨 Application 的迁移（在测验里错过的概念，闪卡里是否被优先、讲给同桌听里是否被选为目标）
- 用户可感知：「我的上下文」里"曾经困惑 → 已掌握"的状态迁移是否被用户点开、纠正

两个假设都成立，就按 §2.5 步骤 5 持续加 Application；假设一不成立的 Application 下线，不拖累整体；假设二不成立就回到记忆的表示与读法上找原因。

## 5.5 构建与部署（2026-09-08 已修）

- 构建 1815 s → **98 s**（`outputFileTracing: false`——trace 显示 1643 s 是 node-file-trace-plugin；本仓库 PM2 直跑仓库目录，追踪零价值）
- 部署改为旁路构建 + 原子切换 + 健康/静态资源检查 + 自动回滚（`scripts/deploy.sh`）。此前每次部署的整个构建期线上 `/_next/static/*` 全 500，新访客白屏——是产品最大的“隐形停机”

## 6. 与外部 context 系统的接缝

context 系统在另一台服务器上开发，新版本即将合并。为了合并干净，本仓库这一侧现在就把两条契约定死、实现留空：

- **写契约（本仓库已有原料）**：`LearningEvent`（`src/types/learning-event.ts`）——对话类 / activity / assessment 三种载荷，全部带版本字段 `v`、`appId`、`sourceId`、幂等键。
  合并方式二选一：context 系统直接读这张表作为 outbox；或本仓库在 `triggerLearningEventProcessing` 里转发。**本侧不再做物化**（P0-1 已刻意留空），避免两套画像。
- **读契约（待与 context 系统对齐）**：每个 Application 声明一个 `LearnerContextRequest`（"为完成这个任务我需要知道这个学习者的什么"：相关概念的掌握轨迹、近期在学什么、偏好、目标），
  context 系统返回一个可直接进 prompt 的 `LearnerContext` 切片 + 可溯源的证据 id。现有 `MemoryLayerSnapshot`（这节课的）与 `learnerProfile` 文本（这个人的）会被它取代，迁移期两者并存。
- **读契约本侧已落地（2026-09-08 晚）**：`src/types/learner-context.ts`（`LearnerContextRequest` / `LearnerContext`，v=1，与 LearningEvent 的 v 对齐）；
  `src/lib/services/learner-context-service.ts`（`resolveLearnerContext`：登录用户且配置了 `CONTEXT_SYSTEM_URL` 就 POST `/v1/learner-context`，
  1.5 s 超时、失败静默回落到请求方带来的本机切片；`formatLearnerContextForPrompt`：切片 → ≤600 字事实段落）；
  `src/components/learner-context-local.ts`（本机供给：会话层检验结果 → 掌握状态、最近学习现场、长期理解的困惑 / 主题 / 偏好 / 进度——
  与问同学书桌、「我的上下文」掌握轨迹同一份事实）。已接消费方：`/api/apps/execute` 注入 `context.learner`，闪卡 / 测验 / 讲给同桌听的
  user prompt 多一段「关于这个学习者」（还没稳的多覆盖、已经稳的不重复）；`trace` 里有 `learner_context=local|remote:N`。
  **今天就有真实数据在这条槽里流**（访客做完一轮闪卡，再出测验时模型已知道哪几个概念还没稳）；接上远端只是换供给方。
  下一批消费方：课中同桌 / 复习 Tutor prompt（替代 learnerProfile 散文）、teach 引擎。
- **需要从 context 系统那边确认的**：接口形态（HTTP / 同进程库）、鉴权与用户 id 对齐（本仓库 `User.id` + 访客无 id）、访客数据如何在登录后合并、状态迁移（曾经困惑 → 已掌握）是否由它保留时间序列、以及它是否消费本仓库的 `LearningEvent` 载荷格式。
  这几个答案决定 §2.5 步骤 4 的工作量，建议合并前先对一次。

---

## 附录 A：线上真实旅程走查（2026-09-08，访客模式，桌面 + 390×844 移动视口）

走查覆盖首页 → `/app?guest=1&entry=demo` 试听课 → 结课 → 复习三栏 → 应用矩阵（闪卡完整、测验部分）→ 移动视口 → 全局入口。
**走查环境的网络很慢**（首页 7 ms 的服务端 TTFB 被看成 23 s 加载），所以下面所有绝对耗时都不可信，
每条 P0 我都在服务器上用本机证据复核过，结论按复核后的写。

### 复核后的结论

| 走查报告 | 复核证据 | 结论 |
|---|---|---|
| **P0 同桌 TTFT 32 s** | 服务器本机 `scripts/measure-ttft.ts` 直打生产进程（N=3）：in-class p50 **747 ms**、review 925 ms、goal 965 ms、shared 1421 ms；HTTP TTFB 7–9 ms | 不是模型或服务端问题，是走查端网络。**不修**；`make ttft` 数字保持在 1 s 量级即可 |
| **P0 移动端 `entry=demo` 丢失** | `guest-demo-entry.ts`：试听入口是**一次性**的（同 tab `sessionStorage` 标记已消费，防止用户被困在示例课里）。走查在同一个 tab 先看完试听再切移动视口重进，命中的正是这个设计 | 不是 bug。新 tab 从 landing 进移动端会正常进试听 |
| **P0 `/app` 首屏空白 10 s+** | 服务端 TTFB 4 ms；但 `/app` 首屏 JS **2393 KB 未压缩 / 约 675 KB gzip / 30 个 chunk**（`/layout` 491 KB、首页 596 KB 作对照），最大三块：page.tsx 自身 392 KB、`6014-*` 384 KB、`fcf0fb0f-*` 262 KB | **真问题，升为 P1-9**：慢网下这就是 10 s 白屏。解法是 God File 按域切分 + 重库（mermaid / katex / shiki / wavesurfer / motion）按需加载，目标首屏 <300 KB gzip；顺手补骨架屏 |
| P1 同桌问题 chip 约 30 s 后才出现 | 课堂脉络与 starter chip 依赖转录累积（"有上下文才出现"是设计原则），阈值 ≥2 段 / ≥50 字 | 设计取舍，不改；如要更早，是脉络生成的节拍问题，不是 chip |
| P1 首页 CTA 不唯一（试听 / 看看怎么工作 / 登录）、导航 5 项 | 营销页判断 | 记录，交产品判断；主 CTA "先试听一节课"已是首屏最重 |
| P1 应用矩阵入口不叫"应用矩阵"（叫"接下来怎么学"） | 产品内的词是对的（学习动作，不是工具名）；错位在 landing 用了"应用矩阵"这个内部词 | 记录：landing 文案向产品词靠，不是反过来 |
| P2 结课 banner「继续看示例课」歧义 | 该按钮是示例课复习页顶部 banner 的 dismiss，不是结课弹窗 | 措辞可再顺，低价值 |
| P2 等待态「内容正在整理 · 00s」 | "整理"是 copy.ts 首选词（"生成"才是要避开的技术词）；真实 elapsed 是刻意设计（"不骗用户第几步"） | 不改 |
| 测验卡显示「查看进度」未进入 | 命中生成中的缓存任务态；走查未等待完成 | 待复现，单独跟 |

### 走查确认做得好的地方（保留，不要在优化里弄丢）

文案口吻一致、零开发者黑话；课堂脉络"正在讲 / 刚才怎么走到这里 / 留到课后"三层随音频生长；闪卡产物紧贴原话、有"回到课堂 0:06"回跳、
米白纸感克制；三栏"左有根 · 中练习 · 右有人陪"成立；课中回答无时间戳（符合设计）；全程零 console 错误。

### 对本方案的影响

走查没有推翻 §0–§4 的判断，反而印证了两点：**性能瓶颈在客户端体积而不在模型或服务端**（P1-9 新增）；
**第一次会话的体验本身是好的**——留不住人的原因不在"好不好用"，在"为什么要回来"，也就是 §2.3 的记忆闭环。
