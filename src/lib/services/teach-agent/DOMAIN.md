# teach-agent/ —— agent 驱动板书课（v31 白纸讲义）

> 「课 = agent 的工具调用轨迹」。一节课 = 一次 AI SDK v6 `streamText` 运行：
> agent 的自然文本输出是老师讲的话（逐段 TTS），工具调用是板书动作。
> 吃 coding agent harness 红利：少结构、多智能，同步关系从流序免费得到。
> v31：黑板形态废弃——高密度双栏白纸讲义（new_column 分栏、formula role
> LaTeX→KaTeX、==重点== 马克笔、term 节标题紫底块），prompt 见
> `skills/board-teaching.md`，渲染见 blackboard/BoardCanvas。
> v32（2026-08-21）：画布皮肤改备课本（淡米色 + 横格线），手写体/笔顺动画/
> 字幕退役（见 windows/DOMAIN.md）；新增 /teach demo 页（components/teach/：
> mock SSE 事件流 + 右侧对话栏 + 课程历史），与本备课态链路并行。

## 架构

```
streamText(kimi-k3 + 13 工具)
   │  text part → 老师讲的话          tool-call part → 板书动作
   ▼
ModelMessage[]（AI SDK 原生轨迹，落盘可续讲）
   ▼  to-board-script.ts（单向 walker，零模型智能）
BoardScript（sanitize 收口）→ 现有播放器零改动播放
```

- **不设计自有轨迹格式**：轨迹就是框架的 `ModelMessage[]`；续讲/课堂态直接把
  messages 塞回 `streamText({ messages })`。
- **不要 [aN] 模型标注**：walker 按流序机械注入锚点——文本之后的动作锚到该段
  讲稿末尾（"说完就写"），页首先于文本的动作锚到段首（"先写课题再开口"）。
  cue 幻觉 / [aN] 外露 / TTS 念标记三类老问题从根上消失。
- **嘴手一体靠流序**：模型想"说到一半落笔"，自然会把句子拆开输出
  （说半句 → 调工具 → 接着写），精度靠模型行为获得，不靠标记。

## 文件

| 文件 | 职责 |
|------|------|
| `tools.ts` | 13 个原子工具（write/circle/underline/arrow/mark/pause/new_column/ref/image/flip_page/ask/finish）+ `BoardEnv` 环境状态；每次 tool result 回环境观测（页码 + 栏号 + 本页 wN 清单），wN 引用越界当场报错让 agent 自纠（不等 sanitize 静默丢弃）；单页动作 ≥14 带翻页提示（v31 双栏密度上调）；**v31 白纸讲义**：write role 增 `formula`（text 写 LaTeX，KaTeX 块级排版，BoardFormula 渲染——v30 的 \frac/\sqrt/\pmatrix 手写模拟记法从 write 文本退役，行内只留 ==高亮== 马克笔），新增 `new_column` 开新栏（一页最多 2 栏，flip_page 归零栏号），write 上限 160 字符。**工具 schema 单一事实源**：`teach-codex/`（codex app-server 上课线）经 z.toJSONSchema 复用本文件定义（11 个，不含 ask），改工具时两边同时生效 |
| `to-board-script.ts` | `messagesToBoardScript(messages, {title, images})` walker + `collectImageJobs`；image 动作按 toolCallId 回填生成图 url；单页段数达上限（6）时机械自动翻页（stats.autoFlips），不让 sanitize 静默丢段；连续同题 ask 去重（模型自我修正会重发，后者覆盖前者保住提问口述）；翻页/自动翻页前给当页末段补 1200ms 停顿（写完即翻学生来不及看成品页，实拍根修） |
| `teach-agent-service.ts` | streamText loop（`stopWhen: stepCountIs(60) 或 hasToolCall('finish')`）→ SSE 事件流（meta/text/tool/image/done/error）；跑完统一 dashscope 生图落盘 `public/uploads/teach-agent/`；课名取 agent 写的第一个 title 板书 |
| `to-board-script.test.ts` / `tools.test.ts` | walker 锚点/翻页/checkpoint/image 回填；工具环境反馈/越界自纠 |

## system prompt

`skills/board-teaching.md`（磁盘技能，可独立迭代不改代码，运行时 fs 读取 + 进程内缓存）。
哲学：描述结果与分寸，不限定过程（嘴手一体 / 板书成品 / 一口气一段的契约在里面）。

## 模型

默认 `kimi/kimi-k3`（百炼兼容模式，复用 `DASHSCOPE_API_KEY`）；
`TEACH_AGENT_MODEL` / `TEACH_AGENT_BASE_URL` 可覆盖。工具调用不兼容时退回 qwen3.7-plus。

## 边界

- 备课态先行：跑完落盘 BoardScript，播放器渲染；课堂态（学生提问 → agent 实时
  续写板书）是二期，届时复用同一 loop + messages 续讲。
- image 生成失败不毁课：url 留空，播放器渲染粉笔框占位（BoardImage.tsx）。
- 路由：`POST /api/board/teach-agent`（SSE 薄壳，messages 不下发前端）。
