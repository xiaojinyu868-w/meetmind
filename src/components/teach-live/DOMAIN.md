# teach-live/ —— 上课舞台（/teach/live 前端）

> 服务端：`src/lib/services/teach-live/DOMAIN.md`（协议、事件契约）。页面：`src/app/teach/live/page.tsx`。
> 一句话：暗色教室、一块亮着的暖白板；老师说到哪画到哪，学生随时插话。95% 的时间界面上只有板和声音。

## 两条时间轴（这个目录最重要的一个概念）

```
SSE 事件（模型速度，一轮 ~10s）──► live-model reducer（到达：块正文增长、页新建，segment.revealed=false）
                                 └─► Director beats（演出：句子 / 揭示 segment / 提示动作，按到达顺序排队）
Director ──► TeachSpeechPlayer（/api/teach/tts 按句合成、预取两句、串行播）
         └─► reveal / stage-cue / point → reducer / 指针状态
```

句子 beat 等**这句开始出声**才放行后面的 beat；揭示 beat 跟在句子后 320ms（声音略领先于笔），连续揭示保底 650ms 间隔。
静音时用估时（中文 ~170ms/字）代替音频时长。打断 = `director.reset()`（清队列、闭嘴、作废在飞 await）+ `discard-unrevealed`（没演到的永远不演，空页撤掉）。

## 文件

| 文件 | 职责 |
|---|---|
| `live-model.ts` | 纯 reducer：`LessonState`（pages / blocks / labels / transcript / stagePageId vs currentPageId / sceneQueue / pendingAsk / usage 累计）。`scene` 到达时只建页并排队，Director 演到才推进 `stagePageId`；`svg` / `draw` 的 `into=` 作为同类目标块的新 segment；ask 既是口播又是提问卡；`replay=true` 全部直接 revealed；`reveal-all`（回看被打断）；`draw-fix` 事件（只在事件日志里出现）把自愈后的脚本换进对应 draw 段正文。`LiveSegment.instant`：重新取景后的整图段直接以终态上板，不逐笔描 |
| `director.ts` | `Director`（beat 队列 + 代数作废；beat 多一种 `student`——回看时学生当年的话演到才进记录）、`SentenceCutter`（中日英句末标点切句）、`cleanSpeechText`（口播里的标签 / markdown 记号不念；**公式先经 `lib/utils/math-text.speakableText` 变成能念的中文**——`$\mathbf{u}\cdot\nabla\mathbf{u}$` 念「u 点乘 纳布拉 u」）、`estimateSpeechMs` |
| `useLiveLesson.ts` | 会话 hook：SSE → rAF 批量喂 reducer + 生成 beats；`PlayerSpeechPort` 把 TeachSpeechPlayer 的 onSentenceStart 变成 `speak()` 的 resolve；`startLesson`（建线程 + 发「开始上课」不进记录）/ `openLesson(id, 'resume' | 'replay')`（resume = 日志终态再订阅；replay = 日志整段喂 Director 按当年节奏 + 声音重放，学生的话演到才进记录，中途开口即 `reveal-all` 而非丢弃——那是历史不是未来）/ `send`（生成中 → interrupt 附文字，否则直接发；带引用时发「学生指着板上的「X」问：…」，记录只记原话；顺带把 draw 报错作 `boardNote` 交给老师）/ `hush` / `setRate`（语速）/ `replayLesson`；断线重连整体按日志重建 |
| `live-client.ts` | `/api/teach/*` 收口：列表（`?engine=live`）/ 建课（body.engine='live' + 本机 learner 切片）/ 事件 / 发消息 / 打断 / `liveFixDraw(threadId, chunks, index, error, segmentId)`（带 segmentId 服务端才落 `draw-fix` 事件）/ EventSource 订阅（onOpen 区分首连与重连） |
| `svg-draw.ts` | 让 SVG 一笔一笔长出来：`splitTopLevelSvgChildren`（流式正文切成已闭合的顶层元素）、`mountSvgChildren`（剥 `<style>`/`<script>`：内联 SVG 的 style 会泄漏整页）、`animateDrawIn`（描边按路径长度 stroke-dashoffset 描画 → 填充淡入；文字上浮；`<g>` 递归错开；>6 个子元素或 `data-draw="fade"` 的组整体淡入）、`createPen`（琥珀色笔尖沿正在画的路径走） |
| `plot-dsl.ts` | `<plot>` 声明式语法 → SVG 标记（纯函数）：手写 shunting-yard 表达式求值（无 eval；隐式乘法 2x）、nice 刻度、原点穿轴、断点 / 越界裁剪、曲线尾部标签；grid / ticks / legend 标 `data-draw="fade"` 快速淡入，曲线描画 |
| `blocks/ProgressiveSvg.tsx` | 每张图先注入公共 `<defs>`（五色箭头 marker `mm-arrow-*`、发光 `mm-glow`、投影 `mm-shadow`、柔和渐变 `mm-soft-*`），模型写 `<svg>` 时直接引用；CSS 语义 class（`pine / amber / stroke-3 / dashed / soft-pine / label / glow`…）在 teach-live.css。增量 DOM：按 segment 记已挂元素数，只挂新闭合的、只描新挂的；不重渲染整张图（那会让动画重放）；`segment.instant` 的元素挂上就是终态（DrawBlock 重新取景后的整图），不进描画批次。读 `LiveStyleContext.rough`：开着就先经 `svg-rough.ts` 换成手绘笔迹再描画；**切换手绘 / 工整时清空重挂已画的（终态直出）**——此前只影响之后的新笔，看起来像没反应（2026-09-11 用户反馈） |
| `draw/DrawBlock.tsx` | `<draw>` 块：**计算与展示分开**——段一闭合就在 Worker 里跑（LiveBlockView 对未揭示的 draw 块也渲染同一个 `<section hidden>` 外框 + 同一个 DrawBlock 实例，揭示只是显示出来——之前揭示前后是两个 React 位置，揭示那一刻重新挂载、算好的结果和自愈全丢、同一段自愈请求发两次），揭示时才描画；结果按「前缀文本」缓存（修第 3 段不重算 1、2 段）。报错：先渲染报错前算好的部分，同时向 `draw-fix` 要修正（每段一次，带 `segmentId` 让服务端落 `draw-fix` 事件），服务端验证过的脚本替换该段重算；修不好显示一句人话并经 `onIssue` 记入会话。首段决定布局，`into` 段沿用；**补画超出画面**（viewBox 任一边撑大 > 15%）→ 整图按全部内容重新取景（`refit`：瞬时替换、之前的段作废、之后的段沿用新布局，ProgressiveSvg 以 `instant` 段不再逐笔描）；`param()` 滑块拖动整图重算瞬时替换 |
| `draw/draw-runtime-client.ts` | 主线程侧：一个共享 Worker + 请求队列 + 2s 超时（死循环 → terminate 重建）；Worker 不可用回退主线程执行 |
| `draw/draw-worker.ts` | Worker 入口：拆掉 fetch / XHR / WebSocket / importScripts / indexedDB 等全局后执行 `lib/teach-live-draw/runtime.runDraw` |
| `svg-rough.ts` | 手绘笔迹：把刚挂上的几何元素换成 rough.js 的 `<g>`（roughness 0.55、单笔、保留 id / data-* / 虚线 / 透明度 / marker）；文字、`data-draw="fade"` 的网格刻度、带 SMIL 子元素的形状、半径 < 6 的点保持工整。每次替换后 `retargetMotionPaths`：`<mpath href>` 指到的形状变成 `<g>` 后运动路径会失效（动点停在原点，2026-09-11 实测），把它重指到 `<g>` 里的描边 path |
| `live-style-context.ts` | 舞台级视觉开关（手绘 / 工整），默认开，localStorage 记住 |
| `blocks/LiveBlockView.tsx` | 按 kind 分发：svg / plot（编译后走 ProgressiveSvg）/ math（KaTeX；**逐行**：每个已揭示 segment 一行，`<math into="eq">` 追加行带进场动效；`\pine{}` `\amber{}` `\blue{}` `\rose{}` 颜色宏在送入 KaTeX 前文本展开成 `\textcolor`——KaTeX 的 macros 遇到宏体里的 `#2F6B55` 会当参数记号；`\htmlId{ca}{c^2}` 经 trust 放行，`point at="eq#ca"` 能指到具体一项）/ note（`normalizeNoteMarkdown`：老师写的裸 LaTeX 与色板宏先经 `splitMathText` 补 `$` 定界、展开成 `\textcolor`，再 react-markdown + gfm + math——之前 `\pine{e_1 \to (1,0)}` 在要点里原样露出）/ code（ChatCodeBlock）/ diagram（mermaid lazy，失败回退源码）/ anim（无脚本 iframe srcdoc：SVG 的 style 与 SMIL 只作用于自己那格）/ widget（allow-scripts 沙箱 + postMessage 自报高度 ≤560）/ image（占位卡 → image-ready 淡入）/ ask（提问卡）。只渲染有 revealed segment 的块（draw 例外：hidden 外框先挂着算图）。`expandColorMacros` 本体在 `lib/utils/math-text.ts`（MathText 的行内公式同样展开），这里只转出口 |
| `LiveStage.tsx` | 上课屏：顶栏（课名 / 页签：有内容或正在演的页才出现，学生手动翻页后出「回到老师那页」/ 手绘开关 / 语速 1×·1.25×·1.5× / 回看这节课 / 课堂记录 / 声音）→ 板（只展示 activePage；最新**可见**块 `scrollIntoView nearest`（`.live-block:not([hidden])`——未揭示的 draw 块以 hidden 外框先挂着算图）；**点任何一块或图里带名字的部分 = 指着它**，输入框出引用 chip）→ 字幕（pending 半透明 / speaking 全亮；上一句还在播时下一句的 pending 不抢；Octo Buddy 头像三态：想 / 讲 / 等）→ 输入。课堂记录抽屉底部一行本节课累计 token 与估算费用 |
| `LivePointer.tsx` | 激光笔：目标是块（`data-block-id`）或图内元素——`at="fig#v"` 里的名字先按 `#id`、再按 `data-name` / `data-label` / `[id$="-v"]` 找（渲染出的 id 带块前缀 `lb_3-v`，直接 `#v` 命不中），`e₁` 与 `e1` 视为同名；相对 `.live-board-inner` 定位，光点滑过去 + 目标柔光圈，3.4s 淡出；目标未挂上时多试几帧 |
| `LiveComposer.tsx` | 输入 + 按住说话（`useVoiceInput` 流式 ASR；按下即 hush，松开发送累计转写；**焦点不在输入框时按住空格同效**）+ 发送；引用 chip（指着板上的 X，可取消）；老师提问时占位「回答老师…」；一轮讲完给「继续讲」 |
| `LiveEntry.tsx` | 开课屏：今天想学什么 + 建议 + 上过的课（`?engine=live`；每节课两个动作：接着上 = 终态续讲，回看 = 按当年节奏 + 声音重放）；点「开始上课」是解锁自动播放的用户手势 |
| `teach-live.css` | 全部样式（不走 Tailwind 类名：这一屏的视觉是一体的）；色彩来自 tokens.css 暗色 + 白天板面；`prefers-reduced-motion` 关动画 |
| `live-stage.test.ts` | 用真解析器 + reducer + Director（假语音口）走一遍课：到达时页 / 演出时页、揭示顺序、into 追加、highlight、ask、打断丢弃、回放终态；Director 辅助函数 |

文案：`src/lib/ui/copy-teach-live.ts`（`TEACH_LIVE_COPY`）。
公式显示：字幕 / 提问卡 / 课堂记录用 `components/apps/windows/MathText`（闪卡同款，KaTeX 行内），要点走 react-markdown + remark-math——老师把 `$…$` 或裸 LaTeX 写进口播时屏幕上是渲染好的公式、耳朵里是中文。

## 视觉与交互约定（Taste 宪法在这一屏的落点）

- 板是主角：暗底只是舞台灯，板占满中间；块之间不画卡片边框，只有标题小字与留白；强调用松绿柔光圈，指向用琥珀光点。
- 声音是老师：没有头像脸，只有一枚会呼吸的圆标 + 四条声纹；字幕一行、居中、大字，跟声音走。
- 学生的输入永远在手边：底部一行胶囊，不弹窗、不切页；按住说话即打断。
- 内部词不出现：页面上没有「引擎 / 块 / 事件 / 协议 / 模型」。

## 未做 / 下一步

- 视觉自检（老师「看一眼板」修重叠）未做——严谨图已由 `<draw>` 保证，自由 `<svg>` 的重叠留观察。
- 语音打断只在按住麦克风 / 空格时；自由说话（VAD barge-in）未做。
- 学生拍题 / 传图进课堂（设计文档 §5.5-4）未接。
- 课后沉淀回主线（复习材料）未接：事件日志已是完整素材。
- 移动端只做了单列降级，未专门设计。
