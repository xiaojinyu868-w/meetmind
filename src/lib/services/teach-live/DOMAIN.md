# teach-live —— AI 家教「上课」线第三代引擎（live stage：标签流 + 多模态板书）

> 2026-09-10 起。与 codex 底座（`teach-codex/`）、pi + vendor OpenMAIC 引擎（`teach-engine/`）三线并存，
> 路由按 `TeachThread.engine`（codex | engine | live）分发；前端是独立的 `/teach/live`（`src/components/teach-live/`）。
> 决策记录：`docs/TEACH_TUTOR_ENGINE.md` §12。用户目标原话：真人老师 1/4 的价格、相近甚至更好的效果——
> 效果来自「边说边画」的临场感 + 真人做不到的多模态（代码驱动的图形与动画流式长出来、函数图一秒画好、参数能拉、慢生图异步补位）。

## 第二轮（2026-09-11）新增：精确图形与几处精确性

- **`<draw>` 块**：老师写 JS 脚本，前端 Worker 里的确定性运行时（`src/lib/teach-live-draw/`）算几何 / 函数 / 动画并渲染。切线一定垂直半径、交点一定在线上、动点永不离开曲线。服务端只当它是一种块正文（原文透传），历史保留 4000 字（追加段要用前面的变量名）。
- **`{{ 表达式 }}` 内联计算**：口播 / ask / note / math 里的算式由 `inline-math-stream.ts` 在流式到达时算好再发出（chunk 边界切开的 `{{` 会扣住等 `}}`），TTS、字幕、记录、模型历史都只见数字。
- **draw 脚本自愈**（`draw-repair.ts` + `POST /threads/[id]/draw-fix`）：前端预跑报错 → 服务端让模型只修出错的那一段（`buildDrawRepairPrompt`：API 说明 + 全部段 + 错误 → 只输出修正段），`runDraw` 复跑验证后返回；不进日志不进历史，每线程限 40 次。修不好才走下面的回传。
- **板上情况回传**：前端 draw 脚本报错记在会话里，学生下次开口时随 `messages` / `interrupt` 的 `boardNote` 字段带给老师（只进模型上下文，不进课堂记录），老师自己改。
- **usage 事件**：每轮结束广播 `{type:'usage', inputTokens, outputTokens, costCny, ms, model}`（刊例价见 `teach.config liveCostCny`，默认百炼 GLM-5.3-Flash 输入 0.8 / 输出 2.8 元每百万 token），前端课堂记录底部累计成本行。
- **事件日志串行写**：live 一轮上千条 delta，`await mkdir` + `await appendFile` 两段异步会让相邻事件落盘颠倒（实测把 draw 脚本写成 `const = A point(...)`）；`thread-store.appendThreadEvent` 改为每线程串行队列。

## 一句话架构

```
学生消息 ─► sendTeachLiveMessage ─► streamText（GLM-5.3-Flash，reasoning_effort=low）
                                        │ 模型直出「标签流」（不是 JSON）
                                        ▼
                               LiveMarkupParser（增量，两态：顶层 / 块内原文）
                                        │ block-open / block-delta / block-close / cue
                                        ▼
                     event-bus publish + thread-store 落盘（与前两条线同一 SSE、同一 jsonl）
                                        │
   image 块闭合 ─► live-image 异步生图 ─► image-ready（半分钟后回填）
```

服务端**不模拟板书、不做节奏**：板面状态由前端按事件重建，节奏由前端 Director 按语音演出。
所以一轮 = 一次 streamText，无工具 loop、无子进程、无 MCP。每轮 input ≈ 2.5–3.7k tokens（system 2.3k + 压缩历史），
output 1–2.4k tokens，TTFT 0.8–1.1s（百炼 GLM-5.3-Flash 实测 2026-09-10）。

## 为什么是标签流（相对 teach-engine 的 JSON 动作数组）

- 块正文是原生文本：SVG / LaTeX / Markdown / 代码 / HTML 不转义，`<svg>` 里一个元素闭合就能上板——「图一笔一笔长出来」靠这个；JSON 字符串里的 SVG 要等整个 action 闭合才能解析。
- 首个 `<say>` 几个 token 就能开口；截断只丢最后半个块。
- 模型对 XML 风格标签的遵从度极高（GLM-5.3-Flash 十几轮实测零协议违例；偶发 markdown 围栏由解析器吞掉）。

协议全文与示例见 `src/types/teach-live.ts` 头注与 `src/lib/prompts/teach-live-prompt.ts`。

## 文件

| 文件 | 职责 |
|---|---|
| `teach-live-service.ts` | 编排：会话注册表（globalThis）、历史（内存 + 事件日志重建）、`runTurn`（streamText → parser → emit）、409 防并发、打断（abort → interrupted → 附文字续讲）、课名跟随首个 `<scene title>`、image 块闭合即生图。对外三件：`preflightTeachLive` / `sendTeachLiveMessage` / `interruptTeachLiveThread`（与前两线同形） |
| `live-markup-parser.ts` | 增量解析器（零 IO）：顶层扫已知标签、块内原文模式只找自己的闭合标签；裸文本 = 隐式 say；半截标签只在「可能是已知标签前缀」时扣住；剥 markdown 围栏；丢游离闭合标签 |
| `live-history.ts` | 事件日志 ⇄ 模型历史：块事件拼回标签；重块正文按 kind 限长压占位（svg 3000 保留——老师要 `into` 追加、要 point 到里面的 id；anim/widget 320）；相邻同角色合并；`trimHistory` 保留最近 16 条；`draw-fix` / `usage` 这类非内容行走 default 分支被忽略（模型看到的仍是自己当年写的脚本——修正是板子的事，不是课堂对话的一部分） |
| `draw-repair.ts` | `<draw>` 脚本自愈：`repairDrawScript(threadId, chunks, index, error)` → generateText（live provider，temperature 0.2，≤1500 tokens）→ `extractScript`（`<draw>…</draw>` 取内部、剥围栏与解释句；模型常把修正段又包一层标签，之前直接 `SyntaxError: Unexpected token '<'`）→ 服务端 `runDraw` 复跑验证 → `{ script, verified }`；每线程 40 次上限。日志 `teach-live-repair` 带 `reported`（前端报上来的原始错误）——这是「模型最常写错什么」的第一手数据，2026-09-11 的「数组当点 / label+样式四参数」两类就是从这里发现后改宽 API 的 |
| `inline-math-stream.ts` | 流式 `{{ }}` 求值（`lib/utils/safe-math`）：未闭合的 `{{` 扣住等下一 chunk，块闭合 flush |
| `live-image.ts` | `<image prompt>` 异步生图（dashscope-image-service，落 `public/uploads/teach-live/`，sha1(thread:block) 命名）→ image-ready；inflight 去重 + 失败 10 分钟冷却；历史回放自愈 `scheduleMissingLiveImages` |
| `live-materials.ts` | 学生自带材料开课（2026-09-12，知乎线首用）：`LiveMaterialPack` 落盘 `data/teach-materials/<threadId>.json`（`TeachConfig.materialsDir`；文件即事实，不改 schema），`ensureSession` 建会话时 `readLiveMaterialsBlock` 拼进 system prompt 的「材料」段（`buildTeachLivePrompt` 第三参数；没有材料一字不加）。段里写清讲法：从材料讲不另讲一套、分歧点名对比、口播说「材料 1」板书写 [A1]、只有摘要的只当线索、课题从共同主题起。谁来挑材料 / 抽正文是来源方的事（`services/zhihu/zhihu-lesson-service.ts`） |
| `__tests__/live-markup-parser.test.ts` | 解析器：结构 / 分块不变性（1–7 字符切片同构）/ 隐式 say / 前缀扣留 / 原文模式 / 截断 / 围栏 / 大小写 / 属性 |
| `__tests__/live-materials.test.ts` | 材料包落盘 / 读回 / 路径字符净化 / 格式化段的约束句 / 损坏文件当没有 |

配套：`src/lib/prompts/teach-live-prompt.ts`（教学大脑：协议 + 视觉物理约束 + 节奏 + 一段示范）、
`src/lib/config/teach.config.ts`（`glm-flash-dashscope` provider、`resolveTeachLiveProvider`、`TeachConfig.liveMaxOutputTokens/liveTemperature`）。

## 事件契约（追加在 teach-codex/event-bus.ts 的联合类型上，老事件原样复用）

```
{type:'block-open', id, kind, attrs}     kind ∈ say|ask|note|math|svg|draw|plot|diagram|code|anim|widget|image；attrs 键已小写（viewbox）
{type:'block-delta', id, text}           非口播块的正文增量（口播正文走 text-delta，兼容老消费方读转写）
{type:'block-close', id, complete}       complete=false = 截断 / 打断
{type:'cue', name, args}                 scene|point|highlight|pause|erase
text-delta / turn-complete / interrupted / error / image-ready   不变；student-message 只落盘
{type:'usage', inputTokens, outputTokens, costCny, ms, model}    每轮用量与估算费用（live 独有）
```

块 id 由服务端分配（`lb_<n>`，线程内跨轮唯一）；模型自己写的 `id="tri"` 留在 `attrs.id` 作为标签，
`point at="tri#hyp"` / `svg into="tri"` 都按标签解析（前端：最近一块同名标签赢）。

## 模型与延迟（实测 2026-09-10，百炼）

- `ZHIPU/GLM-5.3-Flash`「始终思考不可关」（`enable_thinking=false` → 400）；默认会先吐 1500+ reasoning tokens。
  `reasoning_effort=low` 把推理压到 0：TTFT 0.8–2.4s，正文 ~140 tok/s。这是 `glm-flash-dashscope` provider 的 `upstreamParams`。
- 首句出声链路（生产）：建课 ~50ms + messages ack ~100ms + TTFT ~0.9s + 首句闭合 ~0.4s + TTS ~1–1.5s ≈ 3s。
  dev 下首次命中会多出路由编译（tts 4–6s），不是链路问题。
- 备选 provider 都在注册表：`glm-5.2-fast-preview` 可关思考 TTFT 0.5s（不在注册表，需要时加一行）。

## 边界与已知问题

- 单实例假设：会话注册表 / 事件总线进程内（与前两条线同构）。
- 历史只保留最近 16 条消息；长课后模型不记得最早几页画了什么（板面本身不丢——前端从事件日志重建）。
- 模型作图质量：坐标偶发重叠（prompt 已约束，svg 历史保留让 `into` 追加时知道旧元素位置）；SMIL 动画偶发让点离开曲线（prompt 已提示用 animateMotion）。
- `<widget>` 在 `sandbox="allow-scripts"` 里跑模型写的 JS：无 same-origin、无网络；高度靠 postMessage 自报（≤560px）。
- learner 读槽同前两线：开课时快照 `TeachThread.learnerJson` → prompt「关于这位学生」段。
- 材料段是会话建立时读一次的快照（同 learner）：材料包在会话存活期间改了不会生效，重启后生效。材料按预算切节选（前 3 篇 ≤1800 字），每轮 system 多 ≈4–6k tokens，成本行里能看见。
