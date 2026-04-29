# Skill tooling (vendored from OpenClaw / AgentSkills)

> **Source**: `openclaw@2026.4.23` → `skills/skill-creator/scripts/`
>
> 这三份脚本直接复制自 OpenClaw 开源发行版的官方 skill-creator skill。
> 复制而不是 npm dep 的原因：openclaw npm package 要求 Node ≥22.14，
> 而 MeetMind 当前在 Node 20。脚本是纯 Python，独立可运行，不需要 openclaw runtime。
>
> ## 合规策略
>
> - 严格对齐 AgentSkills / OpenClaw skill 规范（frontmatter 只允许 name/description；
>   目录结构 = SKILL.md + references/ + scripts/ + assets/）
> - 任何跟上游的偏差都记在本文件 "MeetMind 扩展" 段
> - 上游更新时，重新从 openclaw npm 包 copy 覆盖，diff 后看是否影响
>
> ## 脚本
>
> - `quick_validate.py` — skill 结构 + frontmatter 合规检查
> - `package_skill.py`  — 打包成 `.skill` (zip with .skill extension)
> - `init_skill.py`     — 从模板生成一个新 skill 骨架
>
> ## MeetMind 扩展（不是修改，是叠加层）
>
> 上游 skill 规范只管 **文件结构 + frontmatter**。MeetMind 的 scenario skill 在此之上
> 还要满足"block 使用规范、工具面板约定、学生画像 schema"——这些以**独立 meta-skill**
> 形式存在（见 `platform-skills/meetmind-scenario-author/`），由 runtime system prompt
> 注入，不污染 skill 文件格式本身。
>
> 这意味着：**MeetMind 的 scenario skill 是 100% AgentSkills-compatible 的**，可以
> 直接给 Claude Code / Codex / 任何支持 AgentSkills 的 agent 读；它们会按标准规范
> 理解 skill，只是无法渲染我们的 block（那是平台扩展）。
