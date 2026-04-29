# Review Checklist · MeetMind Scenario Skill 提交前自检

> skill 提交平台前，把这个清单对着过一遍。
> **[C] = 关键，不过直接拒；其它 = 强烈建议**

## 结构（C 级）

- [ ] **[C]** `SKILL.md` 在 skill 根目录，不在子目录
- [ ] **[C]** `python3 scripts/skill/quick_validate.py <skill-dir>` 输出 "Skill is valid!"
- [ ] **[C]** frontmatter 只有 `name` 和 `description`，没别的字段
- [ ] **[C]** `name`（frontmatter）= 目录名 = lowercase-hyphen 风格
- [ ] 没有 `README.md` / `CHANGELOG.md` / `INSTALL.md` 等辅助文档
- [ ] 没有 symlink
- [ ] references 里每个文件 ≤300 行，超了有 3 行 TOC

## description

- [ ] **[C]** 包含"做什么"（名词）+"什么时候触发"（动词/学生说法）
- [ ] 至少一句学生典型说法用引号（`"帮我写套磁"`）
- [ ] 长度 80-500 字，过短太模糊 / 过长浪费 context
- [ ] 不以 "This skill" 或 "帮助用户" 开头——直接说产物

## Body 结构

- [ ] **[C]** 有 `## 场景目标` 段
- [ ] **[C]** 有 `## 剧本` 段，按 "### 第 N 轮" 编号
- [ ] **[C]** 有 `## Aha moment` 段，条件可判定
- [ ] **[C]** 有 `## 失败处理` 段
- [ ] body 总行数 ≤500，超了把 rubric / 案例库 / 决策树移到 references/

## Block 使用

- [ ] 所有块类型在 `block-catalog.md` 的 7 种白名单内
- [ ] `askOptions.choices` 2-6 项，id 英文
- [ ] `showDraft.annotations` 的 quote 在 body 里真实存在
- [ ] `ctaWechat.reason` 引用了本次会话的具体事实（不是通用话术）
- [ ] 整个剧本最多 emit 一次 `ctaWechat`
- [ ] `ctaWechat` emit 的轮次 ≥第 4 轮（前 3 轮禁）

## Tool 使用

- [ ] 所有 tool 名在 `tool-panel.md` 现有清单里；新工具在 `references/dependencies.md` 声明
- [ ] `webSearch` 的 query 包含必要的限定词（导师名 + 学校 + 年份）
- [ ] `readProfile` 在"问学生任何问题之前"被调用
- [ ] `writeProfile` 每轮 ≤3 个字段，只写验证过的事实
- [ ] `fileUpload` 后的 tool-result 被 `writeProfile` 持久化

## Profile 使用

- [ ] 所有字段名在 `student-profile.md` 白名单内（除了 `institution_tags.*`）
- [ ] 不尝试写只读字段（`studentId` / `email` / `wechatId` 等）

## 节奏 / 指令遵循

- [ ] 第 1 轮一个动作（文字 + 1 个块），不塞 3 个块
- [ ] 每轮最多 2 个块
- [ ] 引用数据点名（"webSearch citations[] 里的 title"），不说"您最近的工作"
- [ ] Aha 条件**可判定**（不是"学生满意时"）

## 机构化

- [ ] **[C]** skill 用到了机构的 rubric / 范本 / 案例库（不是通用 ChatGPT 能做的事）
- [ ] House style 落进 prompt 字句（不只是"参考机构风格"）

## 安全 / 合规

- [ ] 没有收集身份证 / 银行卡 / 密码等敏感信息
- [ ] 没有假装医生 / 律师 / 心理咨询师
- [ ] 外部服务调用都走平台工具面板，没硬编码 URL / API key
- [ ] 没 promise 异步交付（"我会邮件给你"）——平台当前无此能力

## 用户体验

- [ ] prose 回复 ≤120 字（除非学生要细节）
- [ ] 不用 "作为 AI 我不能..."（要么能要么改设计）
- [ ] 不用 "好问题！" "当然可以！" 等填充语
- [ ] 失败时有降级路径（webSearch 空 / CV 缺 / 学生岔开 / 工具预算耗尽）

## 打包

- [ ] **[C]** `python3 scripts/skill/package_skill.py <skill-dir>` 成功输出 `<name>.skill`
- [ ] 包文件名 = `<name>.skill`
- [ ] zip 内容根目录 = `SKILL.md` + `references/` + `assets/`（无多余 wrapper）

---

## 怎么用

1. body 写完后**先过一遍** → 标出所有没打勾的
2. **[C] 项必须全绿**，否则连 `quick_validate.py` 都过不了
3. 非 [C] 项的 Red flag 每一条都判断：是真缺陷、还是该场景特殊？特殊情况在 body 底部
   用 HTML 注释记一条 `<!-- review-exception: ... -->`，审核员会看
4. `package_skill.py` 成功后，提交平台或放到 `platform-skills/scenarios/`
