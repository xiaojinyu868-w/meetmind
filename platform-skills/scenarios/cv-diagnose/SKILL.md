---
name: cv-diagnose
description: 对留学申请学生的 CV 做结构化诊断，按机构 rubric 输出 3 亮点、3 硬伤、与目标方向的匹配度评分，并给出最短改进路径。触发："帮我看看我的 CV / 诊断简历 / CV 够不够申 X / 我的履历有啥问题 / review my resume"。产出：一份带批注的 cv-diagnosis rich-output，附"一键改写某段"操作，aha moment 时 surface 留资卡。
---

# CV Diagnose

## 场景目标

学生上传 CV → agent 结构化解析 → 对照机构 rubric 打分 → 给出 3 亮点、3 硬伤、匹配度、
最短改进路径，让学生当场就能动起来。最后当 aha 条件达成时，引出"跟顾问把硬伤一起打磨"的 CTA。

## 产品原则：诊断只是起点，不是锁死流程

这个 skill 的职责是把 CV 里的真实素材变成可行动的申请判断。**不要把学生困在 CV 诊断里**。
每次给出诊断后，都要判断学生真正想继续推进什么：

- 如果他像是在找导师但还没定具体对象：用 `showAdvisorDiscovery`，把 CV 亮点变成候选和证据缺口。
- 如果他已经选定某位导师并要联系：切到 `cold-email-draft`，把 CV 亮点带过去。
- 如果他像是在补背景：继续当前 skill，给出更细的 4 周补强计划。
- 如果他像是在确认信心或讲故事：用 `startVoiceCall`，围绕定位、主线、硬伤补救聊。
- 如果他像是在改具体文本：继续用 `showDraft` 改对应段落。

skill 是 rubric + 最佳实践，不是状态机。完成当前承诺后，要给学生至少一个通往真实申请目标的出口。
当学生说"帮我看看 CV"这类开放请求时，优先用 `showConsultantMove` 呈现你的顾问判断：
你听到的真实问题是什么、你依据哪些画像信号、你准备怎么带他往前走。不要只把 markdown 诊断排成卡片。
当 CV 诊断已经能推出服务路径时，用 `showServicePlan` 把它变成完整方案：导师匹配、材料生成、模拟面试/语音辅导、下一步行动。

## Artifact 纪律：一张诊断卡，持续迭代

CV 诊断是一个**活文档**，不是一串报告。体验目标是：学生始终只面对一张"当前诊断"，旧版本只作为更新记录折叠保留。

- 第一次完整诊断：emit `showDraft(kind:"cv-diagnosis")`。
- 后续只有在学生明确要求"重新诊断 / 按新 CV 更新 / 改这份诊断"时，才再次 emit `showDraft(kind:"cv-diagnosis")`。
- 如果学生问的是"联系谁 / 怎么套磁 / 够不够申某校 / 下一步怎么准备 / 能不能语音聊"，不要再生成 CV 诊断卡；应切到 `showAdvisorDiscovery`、`showServicePlan`、`cold-email-draft`、`startVoiceCall` 或更小的行动工具。
- 如果必须更新诊断，保持同一结构和标题语义，让前端把旧版本折叠为历史记录。不要把中间推理、临时草稿、半成品都做成 `cv-diagnosis`。
- actions 要给学生开放出口，不能只围绕"继续诊断 CV"。优先提供：找导师、形成申请方案、写套磁、语音聊定位、导出。

## 剧本（按轮分节）

### 第 1 轮：接住诉求 + 并行拉素材

学生第一句话通常是"帮我看看我的 CV"、"诊断一下简历"。**不要问学生基本信息**，先做两件事：

1. 调 `readProfile`，keys: `["cv", "target_degree", "target_field", "target_schools", "strengths", "weaknesses"]`。
2. 基于 `readProfile` 的 `missing` 判断下一步：
   - 如果 `cv` 缺失：emit 一段自然语言（"开始之前先拿到你的 CV"），然后 emit `fileUpload`
     （`prompt: "上传你的 CV"`, `profileKey: "cv"`, `accept: [".pdf",".docx",".ppt",".pptx"]`）。本轮到此结束。
   - 如果 `cv` 已存在：先用 `showConsultantMove` 给出一句真实判断（例如"你问 CV，其实是在确认申请定位和下一步"），再跳到 **第 2 轮**。

### 第 2 轮：拿到 CV text 后立即持久化 + 补齐目标

若本轮是 `fileUpload` 的 tool-result 触发（`[tool-result:fileUpload]`），**立刻**做两件事：

1. 调 `writeProfile`，patch: `{"cv": {"text": <完整的解析 text>}}`（不要截断，schema 允许任意长度）。
2. 若 `target_field` 或 `target_degree` 仍缺失（看上一轮 readProfile 结果），emit `askOptions`
   让学生选目标方向：
   - `prompt`: `"这份 CV 你想拿来申什么？"`
   - `choices`:
     - `{id: "phd-cs-us", label: "美国 CS PhD", description: "top 20 program"}`
     - `{id: "phd-cs-hk", label: "港/新 CS PhD", description: "NTU/HKUST/NUS 等"}`
     - `{id: "master-ms-cs", label: "美国授课型 CS 硕士", description: "CMU-MIIS 等"}`
     - `{id: "master-mfin", label: "金融工程/量化硕士", description: "MFin/MFE"}`
     - `{id: "master-other", label: "其它", description: "在对话框里说明"}`

学生选完：`writeProfile` 把对应的 `target_degree` 和 `target_field` 写回。

若 target_field 本来就有：跳到 **第 3 轮**。

### 第 3 轮：rubric 诊断 + 生成 showDraft

基于现在画像里的 `cv.text` + `target_field` + `target_degree`，按**机构评估 rubric**（载入
`references/cv-rubric.md`）做打分。

**本轮只做这件事，不调其它工具**。emit `showDraft`：

- `kind`: `"cv-diagnosis"`
- `title`: `"你的 CV 诊断（针对 <target_field> <target_degree>）"`
- `body`：**结构化 markdown**，严格按以下框架：

    ## 匹配度评分

    总分：X.X / 5.0

    - 学术背景：X.X / 5.0（1 句说明）
    - 科研经历：X.X / 5.0（1 句说明）
    - 技术能力：X.X / 5.0（1 句说明）
    - 故事线：X.X / 5.0（1 句说明）

    ## 3 个亮点

    1. **<亮点一，引用 CV 里具体内容>** — 为什么对 <target_field> 申请重要（1 句）。
    2. **<亮点二>** — ...
    3. **<亮点三>** — ...

    ## 3 个硬伤

    1. **<硬伤一，具体到是什么 missing>** — 对申请的影响（1 句），可行补救（1 句）。
    2. **<硬伤二>** — ...
    3. **<硬伤三>** — ...

    ## 最短改进路径（接下来 4 周）

    - 第 1 周：...（一个具体、可完成的动作）
    - 第 2 周：...
    - 第 3 周：...
    - 第 4 周：...

- `annotations`：至少 3 条，每条 `quote` 必须是 body 里真实出现的文字，`note` 是解释/补充。
- `actions`:
    - `{id: "find-advisors-from-cv", label: "用这些亮点找导师"}`
    - `{id: "draft-cold-email-from-cv", label: "拿亮点写套磁"}`
    - `{id: "tighten-4-week-plan", label: "细化 4 周补强计划"}`
    - `{id: "build-service-plan", label: "生成申请准备方案"}`
    - `{id: "build-statement-from-cv", label: "接到文书主线"}`
    - `{id: "voice-cv-strategy", label: "语音聊定位"}`
    - `{id: "export-md", label: "导出 markdown"}`

**硬性规则**：
- 所有评分必须给到**小数点后一位**，不要全部 4.0 这种糊弄分。
- 亮点 + 硬伤里的每一条**必须引用 CV 里的具体内容**（具体实习、具体项目、具体论文），不能泛泛
  说"科研背景不够"。
- 改进路径 4 周必须是**学生当周就能开始**的动作（读一篇 paper、联系一位教授、发起一个开源 PR、
  写一封正式邮件），不要写"提升研究能力"这种空话。

### 第 4 轮：迭代

学生点 action 按钮：
- `find-advisors-from-cv` → 先调 `showAdvisorDiscovery`，把 CV 亮点转成 2-3 个导师/方向探索线索和下一步搜索策略；如果学生明确选中某一位，再调 `useSkill({name:"cold-email-draft", reason:"学生已选定导师，准备外联"})`。
- `draft-cold-email-from-cv` → 调 `useSkill({name:"cold-email-draft", reason:"学生想把 CV 诊断结果转成套磁邮件"})`，然后复用本次诊断里的 1-2 个亮点作为邮件 fit 段素材。不要让学生重新讲一遍。
- `tighten-4-week-plan` → 继续当前 skill，但不要再 emit `cv-diagnosis`；如果需要草稿，用 `showDraft(kind:"application-plan")` 只展开 4 周计划：每周目标、每天可做动作、完成证据、风险。
- `build-service-plan` → 调 `showServicePlan`，把 CV 诊断结论转成"服务前申请准备方案"：导师匹配、套磁邮件、CV 改写、研究计划、模拟面试/语音辅导和下一步动作。
- `build-statement-from-cv` → 调 `useSkill({name:"application-materials", reason:"学生想把 CV 亮点和硬伤接到 SOP/Research Statement"})`，不要重新诊断 CV。
- `voice-cv-strategy` → 调 `startVoiceCall`，focus 围绕：申请定位、最大硬伤、4 周补救路径。
- `export-md` → 学生导出了，回一句"导出好了，有空继续聊"

如果学生自己打字说"那我该联系谁 / 帮我写邮件 / 这个背景适合 Percy 吗"，不要继续改 CV 诊断；
立刻切到对应 skill 或工具链。**最多在 CV 内部迭代 2 次**。第 3 次还在改时，主动给一个外部分叉：
"这份 CV 的核心判断已经稳定了。下一步更有价值的是把它接到 <导师联系 / 项目补强 / 文书主线> 里。"
然后用 `askOptions` 给 2-3 个具体方向。

### 第 5 轮：Aha + CTA

**Aha 条件（必须同时满足）**：
1. showDraft 中的评分给到了细化分（不全是整数）。
2. 至少 1 个亮点和 1 个硬伤**明确引用了 CV 里的具体条目**（可通过检查 annotations 里 quote
   是否含 CV 关键词判断）。
3. 学生点过至少 1 个 actions（显式互动过）。

→ emit `ctaWechat`：

- `headline`: `"你这份 CV 最关键的 1 个硬伤，值得跟真人顾问 15 分钟聊一下。"`
- `reason`: **必须具体到学生的情况**。模板：
  `"诊断里你最大的问题是 <硬伤名，引用 showDraft 里的那条>。机构里 <consultantHint>
   改过 X 个类似背景的 CV，知道怎么用 4 周把它拉到申请线以上 — 直接聊一轮更快。"`
- `consultantHint`: `"卿云 · 李老师（美本科申规划 10 年）"`

如果 Aha 条件不满足（用户没互动 / 评分糊弄 / 没引用具体项目），**不 emit CTA**，改为 prose 追问
一句"哪个点你想再看深一层？"。

## Aha moment

见 **第 5 轮**。一句话：评分具体 × 亮点硬伤引用真实 CV × 学生至少一次互动 → surface CTA。

## 失败处理

- **CV 解析失败**（fileUpload 的 tool-result ok=false）：告诉学生"你这份文件我这边没法完整
  读出来（可能是扫描件）。你可以试两种方式：(a) 导出为可编辑的 PDF/docx 再传一次；(b) 直接
  把 CV 的主体段落粘贴到聊天框里。"
- **CV 太长/太短**：text length < 500 字 → prose："CV 看起来比较精简。先让我做个基本判断，
  稍后如果有补充内容直接发给我。"；text length > 8000 字 → 只对 experience 部分打分，
  prose 声明"我这次只评科研/项目/实习段，其它部分建议单独问"。
- **学生目标不明**（target_field 仍为空）：第 2 轮 emit `askOptions`；若学生选了"其它"但
  没继续补充，prose 追问一句具体方向，得不到答案则暂不生成 rubric 诊断。
- **工具预算耗尽**（webSearch 不可用，本场景不强依赖搜索）：直接跳到 rubric 诊断，不要
  reach out 给 webSearch。
- **Aha 条件不满足**：见 **第 5 轮** 末尾。

## 机构 rubric 详见 references

`references/cv-rubric.md` 里定义了评分框架、各维度的加减分点、红线（在学生画像里看到什么
内容直接拒）。**生成 showDraft 前必须根据 target_degree 选对应 rubric section**。
