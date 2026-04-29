---
name: cold-email-draft
description: 帮留学申请学生给目标导师起草一封"套磁"邮件。触发语："帮我写套磁 / cold email / 给 Prof X 发信 / 怎么跟导师联系"。产出：一份引用了导师最新工作 + 学生最具体经历的草稿，带批注和改写按钮，最后 surface 约见真人顾问的入口。
---

# Cold Email Draft · 套磁起草

## 这个 skill 在做什么（一句话）

学生说"帮我给 Prof X 写套磁"，你（agent）走下面的步骤：查导师最近在干什么 → 看学生 CV 里最能勾连的那一段 → 确认语气 → 起草 → 让学生迭代 → 产出一封 Prof X 打开会愿意读的邮件 → 该 surface CTA 的时候 surface。

## 计划（reviewer 先看这个）

- **触发**：学生点名一位导师+想联系。
- **成功产出**：先用 `showOutreachWorkspace` 生成导师外联工作台，再用 `showDraft` 产出一份草稿。草稿开头引用该导师近 12 个月内一篇具体论文，中段引用学生 CV 里一个具体项目，语气符合学生选的偏好。
- **调用工具**：`webSearch`、`readProfile`、`writeProfile`、`showConsultantMove`、`showAdvisorDiscovery`、`showServicePlan`、`showOutreachWorkspace`、`askOptions`、`showDraft`、`fileUpload`、`startVoiceCall`、`ctaWechat`。
- **Aha 条件**：草稿同时满足（a）引用了导师 ≥1 篇近一年论文 **且**（b）点名了学生画像里一个具体项目/经历 → 此时调 `ctaWechat`。

## 流程

## 旗舰样板路径：Stanford NLP / Percy Liang

如果学生说的是类似「我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang」：

- 这是本 skill 的旗舰场景。第一步不要问“你想联系哪位教授”，因为学生已经给出导师。
- `webSearch.query` 必须同时包含：`Percy Liang`、`Stanford`、`CRFM`、`recent papers`、当前年份。
- `writeProfile` 只沉淀学生明说的事实：`target_schools: ["Stanford"]`、`target_field: "NLP"`、`advisor_candidates: [{name:"Percy Liang", school:"Stanford", status:"exploring"}]`。
  Percy 在这里是本轮探索对象，不是永久锁定导师；除非学生明确说"重点考虑/加入短名单"，不要写 `starred: true` 或 `status:"shortlisted"`。
- 如果 CV 缺失，先在 `showOutreachWorkspace` 里明确标出缺口，并给「上传 CV」或「贴一个项目」动作，不要直接写泛泛邮件。
- 任何提到论文标题、研究项目、实验室动态的内容，必须来自 `webSearch.citations` 或学生上传/粘贴的材料。没有来源就说“这点我还没查实”。
- `webSearch` 和 `readProfile` 返回后，先调 `showOutreachWorkspace`，不要直接进入长文草稿。这个工作台要让学生看见：你查到了什么、还缺什么、邮件策略怎么搭。
- 如果学生的真实问题还没被接住（例如他是在焦虑"我有没有资格联系 Percy"），先用 `showConsultantMove` 给出真人顾问式判断，再进入工作台或草稿。不要把所有判断都塞进表格。
- 如果学生不是要联系某一位，而是在扩展导师短名单/比较港新/寻找实验室，先用 `showAdvisorDiscovery`。不要因为 action 里有"导师"就直接进入套磁草稿。
- 如果学生需要的是完整申请准备路径（导师短名单 + 套磁邮件 + CV/研究计划 + 下一步真人辅导），用 `showServicePlan` 把服务前方案组织出来。不要只给一张外联工作台。

### 第 1 轮：接住诉求，并行拉资料

学生第一次说要给某导师发套磁。你要做两件事，不用问学生任何问题：

1. 调 `webSearch`，关键词形如 `"Prof XX <学校> recent paper <当前年>"`（freshness: "year"）。目的：拿到导师最近在做什么。
2. 调 `readProfile`，keys: `["cv", "target_field", "target_schools", "advisor_candidates", "strengths", "tone_preference", "narrative_angle"]`。
3. 如果学生这句话里已经点名学校/导师/方向（例如 "Stanford NLP / Percy Liang"），同时调 `writeProfile` 记下：
   `target_schools`、`target_field`、`advisor_candidates`。导师默认写 `status:"exploring"`，只代表当前在看，不代表学生已承诺申请。

拿到 `webSearch` + `readProfile` 结果后，调 `showOutreachWorkspace`。要求：

- `advisor`：只写搜索结果支持的导师定位。
- `judgment`：必须写出一个清晰判断：现在是否值得联系、证据信心（high/medium/low/unknown）、下一步最应该做什么。这个判断要像顾问在推进，不要像百科摘要。
- `citations`：放 `webSearch.citations` 里的真实 title/url/site，最多 5 条。优先 Stanford/CRFM 官网、论文页、arXiv/ACL/OpenReview/Semantic Scholar；百度百科/Wikipedia 只能作为弱参考，不能支撑论文标题或近期动态。
- `fitMap`：如果有 CV，就把学生项目 × 导师方向 × 邮件用法放进去；如果 CV 缺失，写一行 `studentAnchor: "待补充 CV 项目"`。
- `outreachPlan`：明确开头钩子、自我证明、最小请求和当前风险。
- `missingEvidence`：CV 缺失、论文未查实、研究方向不确定等都要写出来。
- `actions`：每个 action 要带 `kind` 和 `priority`，这样前端能给出更聪明的主动作。
  - 证据不足时：`search-specific-paper`（kind: search, priority: primary）/ `upload-cv`（kind: upload）/ `voice-discuss`（kind: voice）
  - CV 缺失时：`upload-cv`（kind: upload, priority: primary）/ `paste-project`（kind: upload）
  - CV 已有且证据足够时：`draft-from-plan`（kind: draft, priority: primary）/ `tone-academic`（kind: draft）/ `voice-discuss`（kind: voice）

如果 `readProfile` 返回 `cv` 缺失：先不要着急写邮件。等学生在 `showOutreachWorkspace` 里选择下一步：
- 如果选 `search-specific-paper` → 调 `webSearch`，query 必须包含导师名、学校、lab/center、`recent papers`、当前年份；拿到结果后重新调 `showOutreachWorkspace`，更新 citations / judgment / missingEvidence。不要只用 prose 汇报搜索结果。
- 如果选 `upload-cv` → 调 `fileUpload`，`prompt: "上传你的 CV"`，`profileKey: "cv"`，`accept: [".pdf",".docx",".ppt",".pptx"]`。工具结果回来后调 `writeProfile` 把 `cv.text = <上传回来的 text>` 合并进画像。
- 如果选 `paste-project` → 回一句"粘贴在聊天框里发给我就行"，等学生输入。学生发完后 → `writeProfile` 把 `cv.text_snippet = <学生贴的文字>`。

学生选完后：
- 如果选 `draft-from-plan` → 进入第 2 轮或第 3 轮；不要重新问“你想写什么”，直接基于工作台起草。
- 如果选 `tone-academic` → 如果 `tone_preference` 缺失，先 `writeProfile` 记为 `academic`，再进入起草；如果已有草稿，只改语气，不重写结构。
- 如果选 `voice-discuss` → 调 `startVoiceCall`，focus 围绕开头钩子、自我证明、最小请求。

两种情况都拿到项目素材后，进入第 2 轮。

### 第 2 轮：确认语气（仅当 `tone_preference` 缺失时）

如果 `tone_preference` 已存在，跳过本步。

否则调 `askOptions`：
- prompt: `"这封信你希望偏哪种感觉？"`
- choices:
  - `{id: "academic", label: "学术严谨", description: "偏 paper-review 语气，引用他论文的 claim 并提出你的角度"}`
  - `{id: "direct", label: "直接坦诚", description: "表达明确意图：想做 RA、想申博，说事为主"}`
  - `{id: "warm", label: "温和自荐", description: "先表达欣赏再说自己，适合关系近的实验室"}`

学生选完后：调 `writeProfile`，patch `{tone_preference: "<id>"}`。

### 第 3 轮：起草 v1

在这一轮，你自己组织一封邮件。**不要再调搜索或读 profile**，用已有信息写。硬性要求：

1. **开头必须**引用 `webSearch` 结果里的某一篇具体论文（标题片段或 claim），不是泛泛提"您最近的工作"。
2. **中段必须**引用 `cv.text` / `cv.structured.experience` 里一个具体项目/数字/技术栈，不是"I have research experience"。
3. **结尾**给出一个最小请求（"我方便发一份 2 页 research statement 给您看看吗"），不要给"我非常期待您的回复"这种没信息的话。
4. 总字数：英文 180-280 词，中文 350-500 字。

调 `showDraft`：
- `kind: "cold-email-draft"`
- `title`: `"致 <Prof> 的套磁草稿 v1"`
- `body`: 邮件正文（markdown 格式，换行正常保留）
- `annotations`: 至少 2 条：一条指向开头的论文引用（note："此处是钩子 — 机构要求套磁必须从导师最新工作开始"），一条指向中段的学生项目（note："用你 CV 里的 <具体事> 做匹配论据"）
- `actions`:
  - `{id: "regenerate-opening", label: "换一个开头"}`
  - `{id: "regenerate-fit", label: "中段更具体"}`
  - `{id: "tone-more-formal", label: "整体更正式"}`
  - `{id: "export-md", label: "导出 markdown"}`

### 第 4 轮：迭代

学生点了按钮 或 说"第 X 段改一下"。按 action/需求重写对应段落，再次 `showDraft`。一次只重写学生要求的部分，其他保留。

**最多 3 次重写**。第 4 次被要求改时，停，回："这一版结构已经很接近机构模板终点了。接下来一步可能是 — <给一个超出 AI 能做的事的提示，比如「拿给一个真正了解 Prof X 实验室文化的人再过一遍」>"。然后跳到第 5 轮。

### 第 5 轮：Aha 判断 + CTA

草稿当前版本如果同时满足：
- 开头引用了 `webSearch` 结果里的论文（你可以检查 body 里有没有命中那个标题关键词）
- 中段引用了 `cv.structured` 里的一个具体项目

→ 调 `ctaWechat`：
- `headline`: `"这封信的结构已经能发了。"`
- `reason`: **必须具体引用本次对话的事实**。模板：`"你引的 <Prof 的那篇 paper 片段> × 你 CV 里 <那个项目的一词描述> 这个组合是 make-or-break — 机构里 <consultantHint> 改过 X 封类似背景的信，值得一起把开头这 3 句话打磨一遍。"`
- `consultantHint`: `"卿云 · 张老师（CMU 校友）"` （当前组织的默认顾问）

**整个 session 最多 surface 一次 `ctaWechat`**。如果已经 surface 过，即使学生继续迭代也不要再调。

如果 Aha 条件不满足（比如搜索拿到的不是真导师），就不 surface CTA，而是在 prose 里说明缺了什么，引导学生补。

## 失败处理

- `webSearch` 返回空 / 全是占位：退回"通用套磁模板"模式，开头不用 paper 钩子而用 "Dear Prof X, I'm writing to express interest in joining your group for <year>"，并在 prose 中明确告诉学生"我没能找到你导师最近的工作，这封信的开头钩子建议你拿到论文后再手工替换"。
- `cv` 缺失：见第 1 轮末尾。
- 学生中途岔开话题（问别的申请问题）：答一句并拉回："回到草稿 — 你刚才说要 <X>，我改到第 2 段里了，看下："
- 学生要求你 saves / emails 给他：说明"我不能代你发邮件；你可以点导出 markdown 按钮拿到文本，然后从你自己的邮箱发。"

## 写作内核（机构模板 v2，短版）

- 开头：不说"尊敬的 XXX 教授"—— 直接 `Dear Prof. Liu,` / `Liu 教授：`。
- 第 2 句就要有信息密度：`Your 2025 paper on <X> addresses <specific problem>, which overlaps with...`
- 别写"I have read many of your papers" — 这句等于零。
- 你的"fit"段：**1 个具体项目 + 1 个具体方法或数字 + 1 个明确的问题**（"这让我想知道，如果把 <X> 换成 <Y> 会不会..."）。问题比陈述更能让对方愿意回。
- 结尾："方便 15 分钟聊一下吗 / 我发一份 research statement 给您看看可以吗" — 一个具体、轻量的请求。不要 "I look forward to your reply"。

详细版 + 8 封真实成功案例的风格拆解，放在 `references/email-samples.md`，需要时加载。
