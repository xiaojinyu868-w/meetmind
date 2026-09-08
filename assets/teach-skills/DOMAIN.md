# assets/teach-skills —— teach 引擎 skill 内容库（P2）

> 运行时加载：`src/lib/services/teach-engine/runtime/skills.ts`（pi 官方 loadSkills，
> 多源合并 = 本目录内置 + fenshen 人物人格）。
> 设计依据：`docs/TEACH_TUTOR_ENGINE.md` §5.2（skill 三来源与治理）。

Agent Skills 标准目录：每个 skill 一个子目录，`SKILL.md` + 可选 `references/`。
frontmatter `name` 必须等于目录名（pi 校验，不一致进 diagnostics）。模型首轮只看到
name/description/location，正文由 read 工具按需加载——**description 决定被选中率，改写须谨慎**。

## 清单

### 教学法（vendor 自 THU-MAIC/OpenMAIC，MIT；合规见 NOTICE）

| skill | 用途 | 裁剪处 |
|---|---|---|
| feynman-learning | 费曼循环：先解释→暴露缺口→追问重建→剥离术语→迁移 | stage-design 流程 / 多代理 roster / 逐页验收 |
| understanding-by-design | UbD 逆向设计（持久理解/基本问题/GRASPS/WHERETO） | 持久化工具引用 / ask_user 表单门禁 |
| social-emotional-learning | SEL 平行目标嵌入 | 多代理 roster / stage-design 引用 |
| learning-to-learn | 学习策略与元认知平行目标 | 多代理 roster / stage-design 引用 |
| k12-core-literacy-planning | 中国 K-12 核心素养课堂（references/ 课标维度原样保留） | 课件持久化工具链 / ask_user |
| lecture-style | 大师课式讲授（高密度板书 + 成段口播 + 稀少检查点） | 页面生成器 / set_roster / voiceDesign |
| workshop-style | 动手工作坊（concept→do 节奏 + 引导式口播） | widgetOutline / 页面生成器 |
| fact-check | 事实核查纪律（短名单核查 + 已认可输入保护） | 课件编辑工具 / 联网核查降级为正式纪律 |

统一裁剪原则：删除引用 stage-design/slide-dsl/预编排课件的段落（本课堂是实时一对一
活对话，不是预制脚本）；页面类型（slide/interactive/quiz/pbl）映射到本引擎动作词表
（speech / wb_draw_* / discussion / quiz-maker）。各文件头部逐一注明。

### 自研

| skill | 用途 | 状态 |
|---|---|---|
| quiz-maker | 出题—作答—判分闭环（v1 词表可跑：wb_draw_text/latex 出题 → discussion 等答 → 判分讲评落笔；判分纪律：客观题明确答案 + 常见错因） | 已启用 |
| lab-sim | 自包含 HTML + iframe srcDoc + postMessage 交互实验 | **v2 预留**：`widget_show` 在 action-map.ts 的 ACTIONS_V2_RESERVED，前端 iframe 渲染器未接线；frontmatter `disable-model-invocation: true`，模型不可见 |

### 上游未入选及理由

- stage-design / stage-dsl / slide-dsl / slide-craft / pro-editing / page-clone /
  style-clone / pptx-import：预编排课件工具链本体（create_stage/patch_stage/
  generate_scene…），活课堂无对应工具面。
- deep-interactive / vocational：依赖 interactive widget DSL（widgetType/
  widgetOutline），v1 词表无 widget 动作。
- deep-research：依赖 web_search/fetch_url，引擎 v1 无联网工具。
- teacher-style-clone：依赖其材料管线（list_materials/录像提取）；生态位由
  fenshen 人物人格 skill 覆盖。
- build-personal-skill：OpenMAIC 平台元技能（search_classrooms/create_skill）。
- curriculum-planner / spiral-curriculum：全篇绑定跨课堂编排（create_folder/
  ask_user 门禁/read_stage_outline），单线程活课堂无对应面；螺旋重访纪律留待
  学生模型（设计文档 §5.4，P3）就绪后以自研 skill 引入。

## 治理

- **eval 门禁**（对齐设计文档 §5.2/§8，2026-09-05 已接线）：quiz-maker 出题闭环
  与判分准确率落 `tests/eval/teach/`（dry-run 出题 e2e + regression-guard teach 段，
  `make eval-teach`；判分准确率容忍 -5pp），不合格禁用
  （frontmatter 加 `disable-model-invocation: true` 即摘出模型视野）。
  通用冒烟仍跑 `npx tsx scripts/teach-engine-bench.ts`（检查 read 命中与动作序列）。
- 单测门禁：`src/lib/services/teach-engine/__tests__/skills.test.ts` 断言本目录
  全量加载零诊断、name 唯一、lab-sim 不可见——新增 skill 须同步 EXPECTED_BUILTIN。
- vendor 内容修订：只改裁剪声明允许的范围；上游整体更新时按文件重裁，不做局部追新。

## 人物人格 skill（不在本目录）

fenshen 蒸馏产物（`data/fenshen-codex/<egoId>/work/skills/<name>-perspective/`）经
多源合并挂载，就绪门禁 = `work/skill/SKILL.md` 镜像存在。注入语义 = **老师人格**，
机制（SKILL.md/read 工具/技能目录）永不出现在口播与板书（fenshen 铁律，prompt 与
PERSONA_BLOCK_INTRO 双层约束）。
