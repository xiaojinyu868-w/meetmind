# AI-Native Plugins — 应用插件

> Workshop 应用的 LLM 执行插件，每个插件对应一种应用类型。
> M14.6+ 收口为 7 个插件：4 个 catalog 结构化应用 + class-check（视频内随堂检验）+ studio-workshop（播客/信息图）+ fallback。讲给同桌听（teach-back）与精讲页（explainer）加入后 catalog 结构化应用为 6 个、插件共 9 个。

## 文件索引

| 文件 | 职责 |
|------|------|
| `quiz.plugin.ts` | 测验插件（v0.3，2026-09-11 内容层）：**这套题是为这个人出的**——prompt（`../app-prompts-practice.ts`，`app-quiz-v2`）拿到 LearnerContext 事实半（掌握轨迹：还没稳 / 刚记住 / 已经稳了，标「本课」）+ 理解半（Hindsight 记忆）+ 材料体量（分钟 / 字数），由模型决定哪些概念多出、换角度出、只出一道确认题、题量多少——代码里不按状态分配配额。题型 single / **multiple**（新，答案收口成 "A、C" 字母契约，`../quiz-answer.ts`）/ judge / fill / short，`resolveQuestionShape` 收口（多选只解析出一个正确项 → 单选；单选答案落不到选项 → 简答；判断题答案按肯定 / 否定归位）；**每题必有解析**（缺解析的题不算可用题）；同题干复读去重；`concept` 进 meta；题量上限 12（保险丝，不是目标）；转录上下文给时间戳不给段号（解析里引原话写时间点，v1 段号会漏进解析）；不用 json_object 严格模式，LaTeX 反斜杠由 `latex-json-repair` 修。导出 `buildQuizPromptMessages` / `generateQuizDraft` / `parseQuizDraft` 供 eval（`tests/eval/apps`）与生产同一份。**2026-09-09 起没有兜底题**：模型的题就是题；证据落地（在整份转录里找）只决定要不要给"回到原话"跳转（`meta.evidence = text / timestamp / none`）；LLM 一次重试，可用题 <2 抛 `GENERATION_FAILED`（窗口给"再试一次"，不写记忆） |
| `class-check.plugin.ts` | 随堂检验插件（基于知识点结构的智能随堂检验，视频内触发，不在 catalog）。题目只来自模型（一次重试，答案解析不到选项的题丢弃，仍无题抛 `GENERATION_FAILED`）；证据落地在整份转录里找，只决定「回放」跳到哪——2026-09 前会用最近一段原话切"关键短语"拼题且答案恒 A |
| `studio-workshop.plugin.ts` | Studio Workshop 主文件（~340 行），子模块如下。2026-09-09 起：非播客模式模型两次无卡片、播客模式两次无脚本计划均抛 `GENERATION_FAILED`；卡片引用按整份转录落地给，不再按序号挂抽样片段、不再补"证据模块 N" |
| `studio-workshop.types.ts` | 类型/模式检测/解析辅助（~210 行，有测试） |
| `studio-workshop.podcast.ts` | 播客管线（~310 行）：plan/清洗/时间戳污染检测/脚本行选择；每轮对白的「回放」锚点按对白内容在整份转录里落地，落地不到就没有引用 / 跳转（2026-09 前按序号轮流挂 8 段抽样片段，跳到的是别处）；合成 provider 由 `PODCAST_TTS_PROVIDER` 一行切换（默认 dashscope 逐句合成+拼接，volc 一键成品备选）；音频没拿到即整次 execute 抛错（"不出音频不算好"） |
| `studio-workshop.renderers.ts` | 渲染负载构建器（~150 行）；幻灯页只来自模型 slides，为空抛 `GENERATION_FAILED`（2026-09 前会用卡片 / 抽样片段拼页） |
| `flashcards.plugin.ts` | 闪卡（v0.5，2026-09-11 内容层）：prompt（`app-flashcards-v2`）写清一张好卡的标准——正面是提示不是标题、只有一个问号、答案关键词不出现在正面、背面两行内可用 $…$ TeX、覆盖要点不复述摘要；掌握轨迹进 prompt：还没稳的概念必须有卡且换角度（prompt 里给了具体换法：上次没记住"满射的定义"→ 这次问 $y=x^2$ 是不是满射），已经稳的不再做卡；卡数随材料（上限 16）。代码侧只做字面质量门：`frontRevealsBack`（背面整体出现在正面 / 正反同一句）剔除、同正面去重、`concept` 进 meta。导出 `generateFlashcardsDraft` / `parseFlashcardsDraft` / `buildFlashcardCards` 供 eval。**2026-09-09 起没有兜底卡**：模型的卡就是卡，落地只决定跳转；填充词 / 空题面的卡剔除；一次重试，可用卡 <2 抛 `GENERATION_FAILED`。跨会话间隔复习不在插件里——牌堆顺序由 `hooks/useFlashcardsReview` + `lib/learning/spaced-review-model` 在窗口侧决定 |
| `flashcards.plugin.test.ts` | 闪卡证据回锚测试：语义匹配优先、秒/毫秒归一、禁止按卡片序号轮转原文 |
| `mindmap.plugin.ts` | 思维导图（节点 prompt 要求“地图标签”式短语而非解释句；无原文支持的叶子节点会被剔除，保留节点回写证据时间）。2026-09-09 起节点只标注时间点不删节点，空树一次重试后抛 `GENERATION_FAILED`，不再用抽样片段拼假树 |
| `cheatsheet.plugin.ts` | 跨课 / 考试速查表。**2026-09-09 契约扩展（向后兼容）**：模型按「考试主题」组织 `topics[] → items[]`，每条带 `kind`（definition / formula / process / contrast / pitfall / exemplar）+ `term` + `latex`，`sections`（按 kind 分组）仍照常产出供旧缓存 / 分享预览 / Markdown 读；prompt 带 `buildCheatsheetMaterialHint` 按转录长度给条目数量的数字目标并禁止元说明条目；`maxTokens` 9000、不再 `responseFormat: json_object`（严格 JSON 模式把 LaTeX 反斜杠吃掉），改由 `latex-json-repair.ts` 在 parse 前后修复转义（`\\to`→tab、`\.in`、`\\"in` 等实测坏例）。原有规则：课堂、大纲、真题三类证据分别回锚；证据落地只决定条目要不要带引用，落地不到条目照留（2026-09 前直接丢条目，术语课整页 CONTENT_NOT_READY）；`strong` 只由明确强调或真题证据保留；正文保留有依据的 GFM / LaTeX / 紧凑 Mermaid（flowchart / pie / xychart-beta；小表格只用于对比，图中数值必须直接来自证据），不得为装饰滥用富文本；模型判断材料无学习价值或全部条目无法落回证据时返回 `CONTENT_NOT_READY`，禁止逐句包装原文制造假成品 |
| `teach-back.plugin.ts` | 讲给同桌听（费曼检验）：从课堂证据选 3-5 个「应该能亲口讲出来」的目标点，`anchorText` 经 `resolveGroundedEvidence` 重新锚定，锚不住 `evidence=null` 不伪造时间戳；转录过短或选点为空抛 `CONTENT_NOT_READY`。讲述后的四象限核对不在此插件，走 `/api/apps/teach-back/evaluate`（`teach-back-eval-service.ts`：coverage × confidence 由 LLM 判断，quadrant 由服务端映射推导，不信 LLM 自报） |
| `explainer.plugin.ts` | 板书精讲：一次 LLM 调用产出 BoardScript（讲稿 narration + 板书动作 DSL），render mode `'board'`；唯一防线是老师原话逐字校验，其余完全信任模型。2026-09-09 起 LLM 失败 / 无可用动作抛 `GENERATION_FAILED`，不再返回"这次没做好"的假成品 |
| `board-script.ts` | BoardScript DSL 类型 + helper（`parseWriteRef` / `countPageWrites` / `segmentDisplayText` / `checkpointAnswerText` / `extractCues`）；v2 起 write 不携带坐标，标注按 write 序号引用（'w3'）；v3 段联合类型 NarrationSegment/CheckpointSegment、ref 动作、narration 内联 cue（[aN] 词级讲写对齐，charIndex 为剥 cue 后坐标系；兼容模型偷懒写法 [N]）；BoardAction 联合含 `BoardClearAction`（teach 新引擎 wb_clear 的画布映射：清板，渲染语义 = 最后一个 clear 之前的动作不渲染，见 board-lecture.ts flattenPage；legacy 词表/备课脚本不含它）；**checkpoint 答案同规则：`answerDisplay` + `answerCues`（指向 demoActions，解析念到哪示范写到哪），sanitize 一并剥除 hints/question.text 里的标记——不剥会被 TTS 逐字念出（2026-08-19 实测）** |
| `board-blocks.ts` | 结构化板书块动作类型（shape / table / line / code，teach 新引擎全量词表）+ `codeTextToLines` helper；从 board-script.ts 拆出（类型文件 300 行预算，块动作自成一组更好读），BoardAction 联合仍在 board-script.ts 聚合并再导出。块不占 wN 编号（countPageWrites 只数 write），elementId 为引擎语义 id（spotlight / laser / wb_edit_code 的定位键，服务端 ensureElementId 保证存在），与 write 一样受 flattenPage 的 clear 截断 |
| `board-script-sanitize.ts` | `sanitizeBoardScript` 编排（quotes、页级标注越界二次清洗、script 级 ref 越界三次清洗、保底页） |
| `board-script-sanitize-actions.ts` | 动作 / 段级形状清洗：九种动作（v31 增 `new_column` 分栏标记；write role 增 `formula`——text 为 LaTeX，KaTeX 渲染）、narration 段（cue 提取剥除）、checkpoint 段（hints 必须恰好 3 级、question/answer 缺字段整段丢弃、demoActions 只允许引用页级 write）；无 type 旧数据按 narration 兼容。与 orchestrator 合称清洗层（AmIWrite：坏动作跳过记 trace 不崩；非法 target/未知 type/空 text 丢弃计数，页数/段数超限截断）；`sanitizeBoardScript` 入口从 board-script.ts 再导出 |
| `explainer-prompts.ts` | 板书精讲 System/User Prompt（2026-08 v17 少结构多智能：只留输出契约 + 品味宪法 + 引用铁律，微管理配方全部删除——节奏与结构由模型智能把握）：JSON 契约（title/pages/quotes + breathMs）、七种动作（含 ref）、**一口气一段（v26：一个 segment = 一口气——一两句完整的话 15-45 字 + 0-2 个板书动作，写东西的那口气说的就是它；纯讲的口气 actions 为空；上百字长讲稿明文禁止——小单元让音画配合在单元内天然成立，背压/闸门降级为保险丝）**、[aN] 嘴手一体（v20：写的时候嘴里说的就是手上写的；cue 锚在"开始讲述该内容"的词上，说到它笔开始写它；纯讲解时段不排书写动作）、**板书成品章法（v22：课题置顶+写完画线、并列要点序号分点、每行值得拍照、一页正文 ≤6 行疏朗不拥挤、最重要 1-2 处圈划、term=黄粉笔必记重点）**、checkpoint 契约（hints 恰好 3 条）、英文保留空格、JSON 紧凑 |
| `photo-lecture-prompts.ts` | 拍题开讲 Prompt（v17 少结构多智能）：staged 版（题目+参考解答输入）与 one-shot 版（图片直进，审题/解题/脚本/节奏一体）；只留输出契约 + 品味宪法（你就是那个老师：先让学生在乎、思维外化、看见学生的尝试）+ 数学正确性铁律 + **板书成品章法（v22，与 explainer 同一份）** + **一口气一段（v26，同上）**；staged 密度规则从"饱满 6-12 write"改为"疏朗有型 4-8 write"；无题输出 {"error":"not_a_problem"} |
| `photo-stream-prompts.ts` | 拍题开讲·流式版 Prompt（Skeleton-of-Thought：大纲调用产出 title/solution/单元计划 → 单元调用逐页生成，单元输出契约 = BoardScript 单页）：**一口气一段（v26：一个单元 2-4 个 segment，每个 segment = 一口气 15-45 字 + 0-2 动作）**、嘴手一体 cue、板书成品章法、数学正确性锚定 solution；消费方 `src/lib/services/photo-lecture-stream-service.ts` |
| `board-director-prompts.ts` | 导演 pass Prompt（节奏标注专用）：每动作 cue 锚点规则（write 锚首次提及处、圈划锚"注意/关键"提示词、宁早勿晚手先于口）+ breathMs 布点规则（关键结论/揭晓后 800-1500、上限 2500、每页至多两段长停顿）；输出契约 {segments:[{segment,cues,breathMs}]} |
| `explainer-quotes.ts` | 引用逐字校验纯函数：全部 segment 拼接去空白后 `includes` 子串匹配（跨段引用天然支持）；失败引用在 narration 中去掉「」降级为转述并移出 quotes，不阻断产物 |
| `explainer-quotes.test.ts` / `explainer-prompts.test.ts` / `board-script.test.ts` / `board-script-v3.test.ts` | 逐字命中（含跨段/去空白）、改写判 invalid；prompt 关键约束契约（含 v3 cue/checkpoint/ref 断言）；sanitize 各类坏数据；v3 cue 提取剥除（charIndex 坐标系/越界/重复）、checkpoint 形状校验（hints 恰好 3 级/缺字段整段丢弃/demoActions 只引用页级 write）、ref 越界、无 type 旧数据兼容 |
| `teach-back.plugin.test.ts` | 选点正规化测试：锚定 / 锚不住不伪造 / 去重截断 |
| `fallback.plugin.ts` | 没有插件认领时抛 `APP_NOT_SUITABLE`（2026-09-09 前会产出"已进入通用处理流程"的假成品） |
| `index.ts` | 插件注册（9 个插件） |

应用的可评测 Prompt 基线统一放在上级 `../app-prompts.ts`（闪卡 / 测验两组在 `../app-prompts-practice.ts`，2026-09-11 拆出并由 app-prompts 再导出——两者共享"掌握轨迹怎么进 prompt"这一套上下文；teach-back 的三段 prompt——选点 / 安静学生 instructions / 四象限核对——单独在 `../teach-back-prompts.ts`，因 app-prompts.ts 已达行数上限；只放纯字符串函数。2026-08 语音讲课下线后「安静学生 instructions」暂无调用方，已标 deprecated；explainer 的 prompt 在本目录 `explainer-prompts.ts`，只放纯字符串函数）；应用矩阵七类应用已接入管理员运行时控制（explainer 暂未列入 `GOVERNED_APP_KEYS`，运行时直接用本目录 Prompt 基线），真实插件执行、产品现场透镜、控制中心预览和线上/候选试跑共用同一份 System/User Prompt。导图是单课轻结构 Markdown；速查表要求跨课 / 考试证据与可打印 JSON；信息图只保留一个中心命题并限制手机阅读负担；播客把可朗读语料与章节时间证据分离，避免把时间读进音频或让模型猜章节。管理员只可追加指令和选择模型，证据回锚、层级边界、输出格式、视觉 / 音频价值合同不可覆盖。

运行时治理必须由服务端 `/api/apps/execute` 读取后写入 `AppExecutionContext.runtimeControl`；插件自身不得静态 import Prisma-backed `ai-control-service`。插件模块可能被客户端窗口复用类型或纯函数，破坏该边界会把 `better-sqlite3` 打进浏览器构建。

**hanzi-writer 笔画数据（2026-08 起自托管）**：板书播放器（`src/components/apps/windows/blackboard/`）的 title/term 笔顺动画依赖 hanzi-writer 的笔画数据，经 `/api/board/hanzi/[char]` 读本地 `hanzi-writer-data` 依赖包（原 jsDelivr CDN 实测每字 1~3s，是书写卡顿最大来源），加载失败降级为手写体字体渲染。笔画数据为 Arphic Public License（非 MIT；库本身 MIT），许可文件 `ARPHICPL.TXT` 在依赖包内随附。

## 已清理（M14.6+）

以下 plugin 已删除——它们只能通过 `tutor-tools.ts` 的 tool-calling 触发，但 M14.6 起 `agent/route.ts` 纯对话 `tools = {}`，这三个变成无入口死代码：

- `study-report.plugin.ts` — 学习报告（面向家长，产品定位错位 + 非视频场景死入口）
- `knowledge-cards.plugin.ts` — 知识卡片
- `confusion-drill.plugin.ts` — 困惑点训练
- `review-plan.plugin.ts` — 复习计划

`nextSuggestedPlugins` 字段（`AppExecutionResult` 上的"建议下一个 plugin"）也已删除——只有赋值没有消费方，是死字段。

## 已有测试

- `studio-workshop.types.test.ts` — 44 tests，覆盖模式检测/时间戳/数组/对话解析
- `flashcards.plugin.test.ts` — 覆盖模型时间戳不可信时，题面/答案仍能回到真正支持它的课堂片段
- `latex-json-repair.test.ts`（`src/lib/ai-native/`）— LLM JSON 里 LaTeX 转义修复；`mindmap-tree.test.ts` — 节点标签 TeX → Unicode（`flattenInlineTex`，SVG 文字不能渲染 KaTeX；prompt `app-mindmap-v2` 同时要求模型直接写 Unicode）
- `quiz.plugin.test.ts` / `cheatsheet.plugin.test.ts` / `mindmap.plugin.test.ts` — 覆盖错误时间戳、幻觉条目、虚假重点、跨课课内时间与大纲证据的处理（2026-09-09 起：题 / 卡 / 节点只标注证据强弱，不删不换；整份不可用才 GENERATION_FAILED）；quiz 另覆盖多选答案收口（"A, D" → "A、D"、单项 → 单选、对不上 → 简答）、缺解析不算题、复读去重、判断题归位
- `tests/eval/apps/`（`make eval-apps`）— 测验 / 闪卡**产物质量**评测：真课转录（映射课）× 访客 / 有掌握轨迹的学习者，冻结的模型输出过生产后处理再断言（每题有解析、无重复、无"以下哪个不是"、解析不漏段号、不稳概念被覆盖；一卡一点、正面不泄答、背面两行内）。改 prompt 后 `make eval-apps-real` 看真产物并读 runs 里的 items——dry-run 不测 prompt
- `teach-back.plugin.test.ts` — 选点正规化：anchorText 锚定、锚不住不伪造时间戳、去重与上限
