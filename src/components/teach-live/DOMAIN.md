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
| `live-model.ts` | 纯 reducer：`LessonState`（pages / blocks / labels / transcript / stagePageId vs currentPageId / sceneQueue / pendingAsk）。`scene` 到达时只建页并排队，Director 演到才推进 `stagePageId`；`svg into=` 作为目标块的新 segment；ask 既是口播又是提问卡；`replay=true` 全部直接 revealed |
| `director.ts` | `Director`（beat 队列 + 代数作废）、`SentenceCutter`（中日英句末标点切句）、`cleanSpeechText`（口播里的标签 / markdown 记号不念）、`estimateSpeechMs` |
| `useLiveLesson.ts` | 会话 hook：SSE → rAF 批量喂 reducer + 生成 beats；`PlayerSpeechPort` 把 TeachSpeechPlayer 的 onSentenceStart 变成 `speak()` 的 resolve；`startLesson`（建线程 + 发「开始上课」不进记录）/ `openLesson`（事件日志 replay 终态再订阅）/ `send`（生成中 → interrupt 附文字，否则直接发）/ `hush`（按住麦克风时老师先停）；断线重连整体按日志重建 |
| `live-client.ts` | `/api/teach/*` 收口：列表（`?engine=live`）/ 建课（body.engine='live' + 本机 learner 切片）/ 事件 / 发消息 / 打断 / EventSource 订阅（onOpen 区分首连与重连） |
| `svg-draw.ts` | 让 SVG 一笔一笔长出来：`splitTopLevelSvgChildren`（流式正文切成已闭合的顶层元素）、`mountSvgChildren`（剥 `<style>`/`<script>`：内联 SVG 的 style 会泄漏整页）、`animateDrawIn`（描边按路径长度 stroke-dashoffset 描画 → 填充淡入；文字上浮；`<g>` 递归错开；>6 个子元素或 `data-draw="fade"` 的组整体淡入）、`createPen`（琥珀色笔尖沿正在画的路径走） |
| `plot-dsl.ts` | `<plot>` 声明式语法 → SVG 标记（纯函数）：手写 shunting-yard 表达式求值（无 eval；隐式乘法 2x）、nice 刻度、原点穿轴、断点 / 越界裁剪、曲线尾部标签；grid / ticks / legend 标 `data-draw="fade"` 快速淡入，曲线描画 |
| `blocks/ProgressiveSvg.tsx` | 增量 DOM：按 segment 记已挂元素数，只挂新闭合的、只描新挂的；不重渲染整张图（那会让动画重放） |
| `blocks/LiveBlockView.tsx` | 按 kind 分发：svg / plot（编译后走 ProgressiveSvg）/ math（KaTeX）/ note（react-markdown + gfm + math）/ code（ChatCodeBlock）/ diagram（mermaid lazy，失败回退源码）/ anim（无脚本 iframe srcdoc：SVG 的 style 与 SMIL 只作用于自己那格）/ widget（allow-scripts 沙箱 + postMessage 自报高度 ≤560）/ image（占位卡 → image-ready 淡入）/ ask（提问卡）。只渲染有 revealed segment 的块 |
| `LiveStage.tsx` | 上课屏：顶栏（课名 / 页签：有内容或正在演的页才出现，学生手动翻页后出「回到老师那页」/ 课堂记录 / 声音）→ 板（只展示 activePage；最新块 `scrollIntoView nearest`）→ 字幕（pending 半透明 / speaking 全亮；上一句还在播时下一句的 pending 不抢）→ 输入 |
| `LivePointer.tsx` | 激光笔：目标是块（`data-block-id`）或图内 `#id`；相对 `.live-board-inner` 定位，光点滑过去 + 目标柔光圈，3.4s 淡出；目标未挂上时多试几帧 |
| `LiveComposer.tsx` | 输入 + 按住说话（`useVoiceInput` 流式 ASR；按下即 hush，松开发送累计转写）+ 发送；老师提问时占位「回答老师…」；一轮讲完给「继续讲」 |
| `LiveEntry.tsx` | 开课屏：今天想学什么 + 建议 + 上过的课（`?engine=live`）；点「开始上课」是解锁自动播放的用户手势 |
| `teach-live.css` | 全部样式（不走 Tailwind 类名：这一屏的视觉是一体的）；色彩来自 tokens.css 暗色 + 白天板面；`prefers-reduced-motion` 关动画 |
| `live-stage.test.ts` | 用真解析器 + reducer + Director（假语音口）走一遍课：到达时页 / 演出时页、揭示顺序、into 追加、highlight、ask、打断丢弃、回放终态；Director 辅助函数 |

文案：`src/lib/ui/copy-teach-live.ts`（`TEACH_LIVE_COPY`）。

## 视觉与交互约定（Taste 宪法在这一屏的落点）

- 板是主角：暗底只是舞台灯，板占满中间；块之间不画卡片边框，只有标题小字与留白；强调用松绿柔光圈，指向用琥珀光点。
- 声音是老师：没有头像脸，只有一枚会呼吸的圆标 + 四条声纹；字幕一行、居中、大字，跟声音走。
- 学生的输入永远在手边：底部一行胶囊，不弹窗、不切页；按住说话即打断。
- 内部词不出现：页面上没有「引擎 / 块 / 事件 / 协议 / 模型」。

## 未做 / 下一步

- 语音打断只在按住麦克风时；自由说话（VAD barge-in）未做。
- 学生拍题 / 传图进课堂（设计文档 §5.5-4）未接。
- 课后沉淀回主线（复习材料）未接：事件日志已是完整素材。
- 移动端只做了单列降级，未专门设计。
