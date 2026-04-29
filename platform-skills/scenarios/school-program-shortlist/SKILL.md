---
name: school-program-shortlist
description: 根据学生画像、目标方向和项目官方要求，生成冲刺/主申/保底的学校项目短名单，并标出证据、DDL、材料要求和下一步动作。触发："帮我选项目 / 学校短名单 / 哪些项目适合我 / 申请要求 / deadline / funding / 冲刺保底"。
---

# School Program Shortlist · 项目短名单

## 这个 skill 在做什么

把"我该申哪里"从主观建议变成可验证的项目工作台：

- 读学生画像和目标。
- 查学校/项目官方要求。
- 按冲刺、主申、保底分层。
- 暴露证据缺口。
- 把下一步接到导师探索、材料准备或面试练习。

## 产品原则

- **官方来源优先**：项目要求、DDL、材料、funding 必须来自 `searchProgramRequirements` 的 citation，不能凭记忆。
- **短名单是活文档**：第一次给 6-10 个候选；后续根据学生偏好删改，不要每轮重新生成一张完全新的名单。
- **不要假装确定**：来源不足时写"待查证"，不要写成事实。
- **不把学校写死进画像**：只有学生明确确认要保留时，才写入稳定目标；探索阶段放在 artifact。

## 调用工具

`readProfile`、`searchProgramRequirements`、`showConsultantMove`、`askOptions`、`showServicePlan`、`showAdvisorDiscovery`、`showDraft`、`writeProfile`、`useSkill`

## 第 1 轮：读取画像 + 明确短名单目标

先调用：

- `readProfile` keys:
  `["cv", "target_degree", "target_field", "target_schools", "target_start_term", "worries", "strengths", "advisor_candidates"]`

如果 `target_degree` 或 `target_field` 缺失，先 `askOptions`：

- `prompt`: `"这份短名单优先按什么目标排？"`
- `choices`:
  - `{id:"phd-nlp", label:"NLP PhD", description:"导师/科研匹配优先"}`
  - `{id:"ms-cs", label:"CS 硕士", description:"项目质量和就业/科研跳板并重"}`
  - `{id:"mixed", label:"混合策略", description:"先不锁死学位，按可能路径比较"}`

如果目标已有，用 `showConsultantMove` 说明你会先查官方要求，而不是凭感觉推荐。

## 第 2 轮：检索项目要求

调用 `searchProgramRequirements`。

推荐调用方式：

- 已有目标学校：`schools` 填 2-4 个学校，`field` 填方向，`degree` 填学位，`intakeYear` 填入学年，`focus:"requirements"`。
- 需要 DDL：再调用一次，`focus:"deadline"`。
- 需要 funding：再调用一次，`focus:"funding"`。

不要把 10 所学校塞进一个查询。先查代表性项目，再用结果判断短名单结构。

## 第 3 轮：生成短名单 artifact

调用 `showDraft`：

- `kind`: `"program-shortlist"`
- `title`: `"<方向/学位> 项目短名单 v1"`
- `body` 必须包含：

    ## 当前判断

    1-2 句说明申请策略：冲刺/主申/保底比例，以及最大不确定性。

    ## 短名单

    | 档位 | 学校/项目 | 为什么适合 | 主要风险 | 证据 |
    | --- | --- | --- | --- | --- |
    | 冲刺 | ... | ... | ... | [1] |

    ## 材料要求与时间线

    - 只写已查证的 DDL / 材料要求。
    - 未查证的写入"待查证"，不要编。

    ## 下一步

    - 先查导师/实验室
    - 上传/更新 CV
    - 生成 12 周申请路线

- `annotations`：至少 2 条，quote 指向 body 里的具体判断，note 解释证据或风险。
- `actions`:
  - `{id:"expand-advisor-discovery", label:"按短名单找导师"}`
  - `{id:"check-deadlines", label:"补 DDL 和材料要求"}`
  - `{id:"diagnose-cv-for-shortlist", label:"按短名单看 CV 硬伤"}`
  - `{id:"draft-program-fit-statement", label:"写项目 fit 段"}`
  - `{id:"build-12-week-plan", label:"生成 12 周路线"}`
  - `{id:"practice-program-interview", label:"按短名单练面试"}`
  - `{id:"voice-shortlist", label:"语音聊取舍"}`

## 第 4 轮：动作闭环

- `expand-advisor-discovery` → 用 `showAdvisorDiscovery`。候选保持 `exploring`，不要直接套磁。
- `check-deadlines` → 调 `searchProgramRequirements`，`focus:"deadline"`；更新短名单，不要另起无关 workflow。
- `diagnose-cv-for-shortlist` → 调 `useSkill({name:"cv-diagnose"})`，把短名单作为 CV 诊断目标。
- `draft-program-fit-statement` → 调 `useSkill({name:"application-materials"})`，把短名单里的项目证据接成 SOP / Research Statement 的 fit 段。
- `build-12-week-plan` → 用 `showDraft(kind:"application-plan")`，按周列：项目确认、CV/SOP、导师联系、推荐信、面试练习。
- `practice-program-interview` → 调 `useSkill({name:"mock-interview"})`，把短名单里的 why program / fit 风险接成第一道题。
- `voice-shortlist` → 调 `startVoiceCall`，focus: `["冲刺/主申比例", "地理偏好", "funding", "导师匹配"]`。

## 写画像纪律

- 学生点击"保留/加入短名单"或明确说"这几所保留"后，才写 `target_schools`。
- 仅搜索过的学校不写入稳定画像。
- 项目 facts 放在 artifact，不要塞进 `institution_tags` 变成长期噪声。

## 失败处理

- `searchProgramRequirements` 返回空：用 `showConsultantMove` 说明搜索没拿到官方来源，给两个动作：换项目关键词 / 先做假设短名单。
- 学生要求一次性比较太多学校：先选 3 所代表项目建样板，再扩展。
- 学生没有 CV：短名单可以先出策略版，但风险必须写"缺少材料证据，fit 只能粗排"。
