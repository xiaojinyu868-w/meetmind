---
name: meetmind-scenario-author
description: 编写 MeetMind consult scenario skill 的权威指南。本 skill 扩展 OpenClaw 官方 skill-creator，增加 MeetMind 专属的 block 使用规范、工具面板、学生画像 schema 与审核清单。触发：当你要新建/修改/审查 platform-skills/scenarios/ 下任何一个 scenario skill 时加载本 skill。
---

# MeetMind Scenario Author

你正在给 MeetMind consult 平台写一份 **scenario skill**。scenario skill 的用途：

> 学生在 `/consult/<orgSlug>` 打开对话，选一个 scenario（比如 `cold-email-draft`），
> runtime 就用这份 skill 的 body 作为 system prompt 驱动 LLM，让它按剧本一步步带学生
> 走完一个具体服务（起草套磁邮件 / CV 诊断 / 导师匹配 / 项目短名单 / 模面练习 ...）。

## 0. 站在巨人肩膀上

MeetMind scenario skill **是 100% AgentSkills / OpenClaw 合规的 skill**。这意味着：

- frontmatter 只允许 `name` + `description`
- 目录结构 = `SKILL.md` + `references/` + `scripts/` + `assets/`
- 打包成 `.skill`（zip with `.skill` ext）
- 必须通过 `scripts/skill/quick_validate.py`（直接 vendored 自 `openclaw@2026.4.23`）

**写 skill 的基本功**去读一次 `scripts/skill/SKILL-CREATOR-REFERENCE.md`——那是 OpenClaw 官方的
`skill-creator` skill 原文，讲 progressive disclosure、frontmatter 写法、references
组织、打包校验。**本 skill 不重复那些基本功**，只加 MeetMind 专属扩展。

## 1. MeetMind 特有的运行时模型

scenario skill 不是读一次就完事的静态文档。runtime 是 **streaming agent loop**：

```
学生打开 /consult/<orgSlug> 选场景
  ↓
后端把 <你的 skill body> 作为 system prompt 注入给 LLM
  ↓
LLM 按你写的"流程"生成 natural language + fenced block
  ↓
前端解析 block → 渲染成 React 组件（按钮 / 草稿 / 上传 / CTA）
  ↓
学生交互 → 结果以 tool-result 回到 LLM 下一轮
  ↓
继续推理，直到 aha moment → 模型主动 surface ctaWechat
  ↓
学生留微信 → 写入 ConsultLead → 机构 /console/leads 可见
```

**两种 runtime 并存**（`?runtime=aisdk` / `?runtime=openclaw`），但**你的 skill body
完全一样**——runtime 差异由平台处理。你只负责把剧本写好。

## 2. 你能调用的 12 个块（硬边界）

scenario skill 里的"流程"描述必须只提到下面 12 个块。**发明新块 = skill 被拒**。

### 前端 UI 块（学生直接看到、需要他交互）

- `askOptions` — 2-6 个选项的选择卡（明确意图用）
- `showConsultantMove` — 顾问动作卡（真实意图 / 判断依据 / 下一步动作）
- `showAdvisorDiscovery` — 导师/方向探索工作台（候选、可信度、证据缺口、下一步收窄动作）
- `showServicePlan` — 全周期服务方案板（服务前/服务中/服务后，导师匹配、材料生成、面试评估、下一步行动）
- `showOutreachWorkspace` — 导师外联工作台（导师档案 / 来源 / fit map / 外联计划）
- `showDraft` — 长文草稿 / 诊断 / 短名单（带批注 + 改写按钮）
- `fileUpload` — 让学生上传文件，后端自动解析成文本回流
- `startVoiceCall` — 在对话流内升级到 realtime 语音（每会话最多 1 次）
- `ctaWechat` — **每会话最多 1 次，前 3 轮禁用**，aha 时刻的留资卡

### 后端能力块（agent 调用、LLM 看到结果）

- `webSearch` — Qwen 真实联网检索（导师近况 / 项目 DDL / 招生动态）
- `readProfile` — 读 student profile（永远"先读再问"）
- `writeProfile` — 合并写 student profile（本轮验证过的事实）

**每个块的 JSON schema、何时用、典型示例、常见错误**都在 `references/block-catalog.md`。
**写 skill 时必须读一次**。

## 3. 一份 skill 的最小结构

```
platform-skills/scenarios/<name>/
├── SKILL.md                    # 必须，body 就是注入给 LLM 的剧本
├── references/                 # 可选，机构专属内容（rubric / 范本 / 案例库）
│   ├── email-samples.md
│   └── decision-trees.md
└── assets/                     # 可选，输出物模板
```

**上传/合并机构版的资料** 在 `references/`，剧本用一句话告诉 agent "此时载入 references/X.md"
即可——LLM 会主动要求读。**不要把所有内容都塞 SKILL.md body**，那会炸 context 窗口。

## 4. Body 必须包含的四段

无论什么场景，body 结构严格按这四段：

```markdown
# <场景名>

## 场景目标（一句话）

## 剧本（按轮分节）

### 第 1 轮：...
### 第 2 轮：...
...

## Aha moment

<一个可判定的条件。模型每轮都问自己"aha 成立了吗？"；成立 → 调 ctaWechat>

## 失败处理

- 联网搜索失败 → ...
- 学生岔开话题 → ...
- 工具预算耗尽 → ...
```

**不是建议，是硬要求**。审核时我们按这个结构扫。

## 5. LLM 指令遵循实战经验（踩过的坑，必读）

这一段是用真实跑通数据总结的，**任何一条违反，LLM 都会翻车**：

1. **不要写"让 LLM 自由发挥"**。剧本第 1 轮必须具体到"调哪个工具、参数大概长什么样"。
   示例：`"调 webSearch，query 形如 'Prof X <学校> recent paper <当前年>'，freshness='year'"`
2. **编号节拍**（第 1 轮 / 第 2 轮 / ...）比抽象描述有效 10 倍。LLM 会跟着节拍走。
3. **每个块的参数示例**要写在剧本里，**不要只放在 block-catalog**。agent 偷懒，看不见就不用。
4. **一次最多输出 2 个块**。经验：一次 3+ 块时 LLM 经常把后面的 JSON 写坏。
5. **引用数据要点名**：不说"引用导师的工作"，说"引用 webSearch 返回 citations 里第 N 条的 title"。
6. **aha 条件要可判定**。不能写"学生满意时"。要写"当前 showDraft.body 里同时满足
   (a) 包含 citations[].title 中的一个片段 **且** (b) 包含 cv.structured.experience 里
   一个项目名"。
7. **fileUpload 后要 writeProfile**。上传后的 text 会以 tool-result 回流，agent 经常忘了把它
   写进画像——剧本里要显式写"收到 tool-result:fileUpload 后，立即调 writeProfile 把
   text 合并到 cv.text"。
8. **ctaWechat.reason 必须引用本次会话里出现过的具体事实**。通用话术（"帮你提升申请竞争力"）
   审核直接拒。

## 6. 工作流

1. **读一次** `scripts/skill/SKILL-CREATOR-REFERENCE.md`（OpenClaw 原版，讲 progressive disclosure）
2. **读** `references/block-catalog.md`（我们的块字典，必读）
3. **读** `references/tool-panel.md`（每个工具能干嘛、返回什么）
4. **读** `references/student-profile.md`（画像字段白名单）
5. **读** `references/review-checklist.md`（提交前自检）
6. **可选：**拿现有 `platform-skills/scenarios/cold-email-draft/` 作为参考实现
7. **初始化** 新 skill：`python3 scripts/skill/init_skill.py <name> --path platform-skills/scenarios`
8. **写** `SKILL.md`（按 §4 四段结构）+ 必要的 `references/`
9. **自检** `python3 scripts/skill/quick_validate.py <skill-dir>` → 必须 "Skill is valid!"
10. **打包**（给机构分发时）`python3 scripts/skill/package_skill.py <skill-dir>` → `<name>.skill`
11. **导入平台**：把目录放到 `platform-skills/scenarios/` 或 `/console/skills` 上传

## 7. 当你对规范以外的事有疑问

- 能不能发明一个新块？→ **不能**。block-catalog 是平台护城河，一个块对应一个我们写的 React
  组件；新块走"平台工程团队加一个组件 + 你的 skill 引用它"两步。
- 能不能加一个新工具？→ 按 `references/tool-panel.md` 的"热更新流程"走：在你的
  skill 里加一个 `references/dependencies.md`，声明你想要的工具 + 为啥 + fallback；
  reviewer 评估后加进平台，你的 skill 自动可用。
- 能不能写到 `institution_tags` 以外的自由字段？→ 先看 `references/student-profile.md`，
  90% 情况下官方 schema 已经覆盖；剩下 10% 用 `institution_tags.*` 做扩展。

## 8. 不可违反的底线（审核红线）

- 剧本包含"让 LLM 扮演医生 / 律师 / 心理咨询"等专业身份 → 拒
- 收集或存储身份证号 / 银行卡 / 家庭住址 → 拒
- 任何 scenario 末尾没有 `ctaWechat` 的自然落点 → 拒（scenario 不转化就没价值）
- 依赖了我们没有的平台工具但没在 `dependencies.md` 声明 → 拒
- body 超过 500 行没拆到 references → 拒
- frontmatter 带 `name` / `description` 以外字段 → 拒（validator 直接挡）

---

**你不是在写文档，你是在写一份给另一个 LLM 读的剧本。每一个字都要有用，每一个指令都要具体。**
