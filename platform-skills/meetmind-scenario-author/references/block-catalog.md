# Block Catalog · MeetMind Consult

> 平台一共支持 12 个块。LLM 在对话里吐出 ```<blockType> { JSON } ``` 格式，runtime 负责解析。
>
> **所有 block 类型都必须来自本清单。发明新块 = skill 审核被拒。**
>
> 本文跟运行时实现对齐（`src/lib/consult/tools.ts` / `src/lib/consult/ui-tools.ts` 的 zod schema）。有冲突以代码为准，但
> 发现冲突必须提 issue，不能自己改 skill body 里的格式。

---

## 前端 UI 块（9 种）

这些块**产生 UI**：agent 输出 `input`，runtime 把它变成 React 组件让学生看到 + 交互。
学生交互完的结果会以 tool-result 形式在下一轮回流给 agent。

### 1. `askOptions` — 让学生从 2-6 个选项里选

**用途**：确认意图。一次只解决一个决策点。

**格式**：
````
```askOptions
{"prompt":"这封信你希望偏哪种语气？","multi":false,"choices":[
  {"id":"academic","label":"学术严谨","description":"引用他 paper 的 claim 并提出你的角度"},
  {"id":"direct","label":"直接坦诚","description":"说清你想做 RA / 申博"},
  {"id":"warm","label":"温和自荐","description":"先表达欣赏再说自己"}
]}
```
````

**字段**：
- `prompt` (string, 必填)：给学生看的问题，≤30 字
- `multi` (bool, 可选, 默认 false)：是否允许多选
- `choices[]` (2-6 个, 必填)：
  - `id`：英文小写加连字符，agent 下一轮看到的标识符
  - `label`：给学生看的文字
  - `description`（可选）：副说明

**学生交互后，tool-result 形态**：
```json
{"selected":["academic"],"labels":["学术严谨"]}
```

**典型错误**：
- ❌ choices 只给 1 个 → 前端没可选项，runtime 拒绝
- ❌ id 用中文 → agent 下一轮看到的引用一致性差
- ❌ prompt 超过 30 字 → 学生读不完就烦了，转化率降

### 2. `showConsultantMove` — 展示顾问下一步判断

**用途**：学生提出开放请求、焦虑或方向不清时，先像真人老师一样判断真实意图和下一步，而不是直接进入固定 workflow。

**格式**：
````
```showConsultantMove
{
  "stance": "diagnose",
  "title": "你现在不是缺经历，是缺一条研究主线",
  "read": "你问 CV，其实是在确认自己有没有机会，以及下一步该联系谁。",
  "evidence": ["你已有文本检测项目，但目标是 NLP PhD", "当前导师/学校还没收窄"],
  "move": "我先把 CV 里最能打的两条经历转成导师联系线索。",
  "question": "你更想冲美国 top PhD，还是先锁定港新/硕士跳板？",
  "actions": [
    {"id":"find-advisors-from-cv","label":"用这些亮点找导师","intent":"route"},
    {"id":"voice-cv-strategy","label":"语音聊定位","intent":"voice"}
  ]
}
```
````

**典型错误**：
- ❌ 把它写成普通摘要卡
- ❌ 一口气问很多问题
- ❌ actions 是平台预设套路，而不是基于当前学生的下一步

### 3. `showAdvisorDiscovery` — 导师/方向探索工作台

**用途**：学生还在摇摆，不确定该看哪些导师/学校/实验室时使用。它帮助 agent 展示候选、可信度、证据缺口和下一步收窄动作；不要一上来就进入套磁草稿。

**格式**：
````
```showAdvisorDiscovery
{
  "title": "NLP 导师探索",
  "mode": "explore",
  "read": "你现在不是要马上写邮件，而是要先弄清楚哪些导师真的值得放进短名单。",
  "question": "你更想做基础模型评估，还是模型应用/教育方向？",
  "signals": [
    {"label":"当前方向","value":"NLP / LLM evaluation"},
    {"label":"证据缺口","value":"缺少港新导师近期论文来源"}
  ],
  "candidates": [
    {"name":"Percy Liang","affiliation":"Stanford CRFM","status":"exploring","fit":82,"confidence":"medium","why":"与你的大模型评估经历有交集，但需要查实 2025-2026 最新工作","next":"补一条官方或论文来源"}
  ],
  "actions": [
    {"id":"search-hk-sg-labs","label":"继续搜港新实验室","intent":"search"},
    {"id":"shortlist-percy","label":"先保留 Percy","intent":"shortlist"}
  ]
}
```
````

**典型错误**：
- ❌ 把 `exploring` 候选写成学生已锁定
- ❌ 候选超过 6 个，信息负荷太高
- ❌ 学生还没选定导师就直接切到套磁草稿

### 4. `showServicePlan` — 展示全周期服务方案

**用途**：把机构原来的服务方案做进 agent：服务前获客/申请准备，服务中模拟面试/双师反馈，服务后持续跟进。适合学生需要知道"机构到底能怎么帮我"或 agent 已经形成完整下一步路线时。

**格式**：
````
```showServicePlan
{
  "phase": "pre-service",
  "title": "Stanford NLP 申请准备方案",
  "consultantRead": "你现在不是只需要一封邮件，而是要把导师选择、CV 亮点和第一封套磁串起来。",
  "objective": "先完成导师短名单和第一封邮件策略。",
  "painPoints": ["导师信息分散", "套磁开头缺少硬证据"],
  "modules": [
    {"id":"advisor-match","label":"导师匹配","status":"in-progress","value":"先筛 3 位方向对齐导师","next":"查近期论文和招生动态"}
  ],
  "advisorMatches": [
    {"name":"Percy Liang","affiliation":"Stanford CRFM","fitScore":88,"fitReason":"方向接近基础模型评估与社会影响"}
  ],
  "artifacts": [
    {"kind":"cold-email","title":"第一封套磁邮件","status":"draft","note":"开头需要具体论文来源"}
  ],
  "actions": [
    {"id":"start-advisor-match","label":"开始匹配导师","intent":"search"},
    {"id":"draft-first-email","label":"起草第一封邮件","intent":"draft"}
  ]
}
```
````

**典型错误**：
- ❌ 把它当静态 PPT，堆满所有服务能力
- ❌ 没有 consultantRead，只剩功能清单
- ❌ actions 不是当前学生的真实下一步

### 5. `showOutreachWorkspace` — 生成导师外联工作台

**用途**：导师联系 / 套磁前的 workspace。把导师档案、真实来源、学生-fit、外联计划、缺失证据放在一个可操作界面里。

**格式**：
````
```showOutreachWorkspace
{
  "title": "Percy Liang 外联工作台",
  "advisor": {
    "name": "Percy Liang",
    "affiliation": "Stanford",
    "lab": "CRFM",
    "summary": "只写 webSearch citations 支持的定位。"
  },
  "citations": [
    {"index":1,"title":"真实网页标题","url":"https://...","site":"Stanford","note":"支持导师方向判断"}
  ],
  "fitMap": [
    {
      "studentAnchor": "待补充 CV 项目",
      "advisorSignal": "导师方向或近期工作信号",
      "outreachUse": "邮件里准备用作开头或 fit 段",
      "strength": "unknown"
    }
  ],
  "outreachPlan": {
    "openingHook": "开头引用哪条导师工作",
    "studentProof": "用学生哪段经历证明 fit",
    "ask": "最小请求",
    "risk": "当前最大风险"
  },
  "missingEvidence": ["缺学生 CV 里的具体项目"],
  "actions": [
    {"id":"upload-cv","label":"上传 CV"},
    {"id":"paste-project","label":"贴一个项目"},
    {"id":"draft-from-plan","label":"按这个策略写草稿"}
  ]
}
```
````

**纪律**：论文、研究项目、导师动态必须来自 `webSearch.citations` 或学生材料；没有来源就放进 `missingEvidence`。

### 6. `showDraft` — 展示一份长文草稿

**用途**：草稿 / 诊断报告 / 短名单。带 annotations 和 action 按钮。

**格式**：
````
```showDraft
{
  "kind": "cold-email-draft",
  "title": "给 Prof Liu 的套磁草稿 v1",
  "body": "Dear Prof. Liu,\n\n我注意到您 2025 年在 EMNLP 的那篇 cross-modal retrieval...（完整邮件）",
  "annotations": [
    {"quote":"我注意到您 2025 年在 EMNLP 的那篇","note":"钩子：直接引用最新 paper，避免模板化开头"},
    {"quote":"在 UCLA NLP lab 的 CLIP 对比实验","note":"用你 CV 里的具体项目做匹配论据"}
  ],
  "actions": [
    {"id":"regen-opening","label":"换一个开头"},
    {"id":"regen-fit","label":"中段更具体"},
    {"id":"tone-formal","label":"整体更正式"},
    {"id":"export-md","label":"导出 markdown"}
  ]
}
```
````

**字段**：
- `kind`：`cold-email-draft` / `cv-diagnosis` / `program-shortlist` / `advisor-card` / `interview-feedback` / `application-plan` / `statement-draft` / `recommendation-plan`
- `title`：文档标题
- `body`：markdown 正文
- `annotations[]`（可选）：指向 body 里的片段 + 备注。**quote 必须是 body 里出现过的文字**，否则前端找不到位置
- `actions[]`（可选）：底部按钮，点击后以 `{"actionId":"regen-opening"}` 回传

**学生交互后回流**：
```json
{"actionId":"regen-opening","label":"换一个开头"}
```
或（点了 export-md）：
```json
{"actionId":"export-md","note":"学生已导出 markdown"}
```

### 7. `fileUpload` — 让学生上传文件

**用途**：CV / 成绩单 / Research Statement / 参考文献列表。后端自动解析为纯文本。

**格式**：
````
```fileUpload
{"prompt":"上传你的 CV","accept":[".pdf",".docx",".ppt",".pptx"],"profileKey":"cv","maxSizeMb":20}
```
````

**字段**：
- `prompt`：一句话提示
- `accept[]`（可选）：扩展名列表。不填默认 `.pdf .docx .ppt .pptx .txt .md .csv .json .html`
- `profileKey`（可选）：指定后，解析的 text 自动写入 profile 该字段（推荐 "cv"）
- `maxSizeMb`（可选, 默认 20）

**学生上传后回流**（tool-result:fileUpload）：
```json
{"fileName":"zhang-wei-cv.pdf","extension":"pdf","charCount":3421,"text":"<解析后的全文，≤12000 字>","truncated":false,"profileKey":"cv"}
```

**agent 必须做的后续动作**：收到 result 后**立即调 `writeProfile`**把 text 写进画像。剧本
里要显式写这个动作，否则 LLM 经常忘。

### 8. `startVoiceCall` — 对话内语音升级

**用途**：当外联语气、科研故事或面试回答靠文字讲不清时，让学生在对话流里接听 realtime 语音。

**格式**：
````
```startVoiceCall
{"reason":"你对开头语气拿不准，语音 3 分钟能更快定策略","openingLine":"喂，我们先把开头钩子定下来。","focus":["开头钩子","CV 项目怎么讲","最小请求"],"voice":"Ethan"}
```
````

**纪律**：每会话最多 1 次；必须引用本次对话具体内容；不能代替 `ctaWechat` 的真人转化。

### 9. `ctaWechat` — 留资卡（每会话最多 1 次）

**用途**：aha moment 达成时，让学生留下微信 / 手机号，沉淀为机构线索。

**格式**：
````
```ctaWechat
{
  "headline":"这封信的结构已经能发了。",
  "reason":"你引用的 Prof Liu 2025 EMNLP cross-modal paper × 你 CV 里的 CLIP 对比实验这个组合是 make-or-break — 机构的张老师（CMU 校友）改过 X 封类似背景的信，值得一起把开头 3 句打磨一遍。",
  "consultantHint":"卿云 · 张老师（CMU 校友）"
}
```
````

**字段**：
- `headline`：1 句话，说明学生刚完成了什么
- `reason`：**必须引用本次会话里出现过的具体事实**。"帮你提升申请竞争力" 这种通用话术审核直接拒
- `consultantHint`（可选）：建议对接的顾问简介

**规则（runtime 会硬兜底，但你的 skill body 也要写清楚）**：
- 每个 session 最多 emit 1 次
- 前 3 轮禁止 emit
- aha moment 未成立不得 emit

**学生提交微信号后**：runtime 写 `ConsultLead` 表，机构在 `/console/leads` 可见。

---

## 后端能力块（3 种）

这些块**不产生 UI**：runtime 在后端直接执行，把结果以 tool-result 形式塞给 agent 下一轮。

### 10. `webSearch` — 真实联网搜索

**用途**：导师近况 / 项目 DDL / 论文发表 / 招生动态。**任何时效性内容都应该搜，不要凭模型记忆**。

**格式**：
````
```webSearch
{"query":"Graham Neubig CMU recent paper 2025 2026","freshness":"year","maxResults":5}
```
````

**字段**：
- `query`：搜索关键词。**导师名必须带学校**
- `freshness`：`day` / `week` / `month` / `year`
- `maxResults`：默认 5，最多 10

**tool-result 格式**：
```json
{
  "ok": true,
  "query": "...",
  "answer": "Graham Neubig 2025 年在 personalized NMT 方面...",
  "citations": [
    {"index":1,"title":"Extreme Adaptation for Personalized NMT","url":"https://arxiv.org/pdf/1805.01817","site":"arxiv"}
  ],
  "costMs": 7238
}
```

**agent 必须做的事**：写草稿时**引用 citations 里的具体 title**，不能只说"根据您最近的工作"。
如果 citations 为空，告诉学生"未搜到近一年公开内容，建议你提供导师的 lab 主页 URL"。

**实测 costMs**：7-15 秒。**不要同一个 query 搜第二次**，结果一样还浪费 token。

### 11. `readProfile` — 读学生画像

**用途**：**问学生任何问题前先读**。

**格式**：
````
```readProfile
{"keys":["cv","target_field","strengths","tone_preference","narrative_angle"]}
```
````

**字段**：`keys` 数组，支持 dot-path（如 `cv.text`、`test_scores.toefl`）。只接受
`student-profile.md` 白名单字段。

**tool-result 格式**：
```json
{"profile":{"cv":{"text":"..."},"tone_preference":"academic"},"missing":["strengths","narrative_angle"],"rejected":[]}
```

- `missing[]`：存在于白名单但当前未写入的字段 → 告诉你"需要问学生"
- `rejected[]`：不在白名单 → **你用错字段名了**，换成白名单里的再调

**成本**：<50ms，免费。每轮开始可以无脑先读一次。

### 12. `writeProfile` — 写学生画像

**用途**：把本轮验证过的事实合并进画像。

**格式**：
````
```writeProfile
{"patch":{"tone_preference":"academic","target_schools":["CMU","Stanford"],"advisor_candidates":[{"name":"Prof. Liu","school":"CMU","starred":true,"why_match":"multimodal alignment"}]}}
```
````

**规则**：
- 只写你本轮**真正验证过**的事实。学生说"可能 CMU"别急着写
- 每轮最多 1-3 个字段
- 字段名不在白名单会被自动移到 `institution_tags.<key>` 不丢弃
- 数组会 deep merge（按 JSON.stringify 去重）

**tool-result 格式**：
```json
{"ok":true,"writtenKeys":["tone_preference","target_schools","advisor_candidates"],"rejectedKeys":[]}
```

`rejectedKeys` 非空 = 你写了只读字段（`studentId` / `email` / `wechatId` 等），runtime 挡住了。

---

## 块之间的协作节奏（经验模式）

第 1 轮几乎都长这样：
```
text 自然语言开场（1-3 句）
+ webSearch (查当前时效性内容)
+ readProfile (读画像)
```

第 2 轮：看 tool-result → 缺什么用 askOptions / fileUpload 问 / 要 → writeProfile 记下。

第 3-N 轮：showDraft 一版 → 学生点按钮 → 再 showDraft。

最后：aha 成立 → ctaWechat。

**每轮最多 2 个块**。超过 2 个 LLM 经常把后面的 JSON 写坏。

---

## FAQ

**Q: 能不能让 agent 在 showDraft 的 body 里嵌入 markdown 代码块？**
A: 能。body 就是 markdown 字符串。但如果 body 本身包含 ```fence，你的 block JSON 解析会翻车——
runtime 的 scanner 会把内嵌 fence 当成新 block 的开始。**解决办法**：body 里的代码块用 4 个反引号
包（````...````），或用缩进 4 空格的 markdown 代码块表示。

**Q: 多个 showDraft 连续 emit 会发生什么？**
A: 前端每个 showDraft 单独渲染一张卡。学生会看到 v1 / v2 / v3 多张草稿——挺好，不用怕。

**Q: ctaWechat emit 后学生没填微信就跑了怎么办？**
A: session 已经结束，下一次来要重新走。runtime 不会自动保留半填写状态。这是设计——宁可 session 结束
也不要缠着学生。
