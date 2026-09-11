# teach/ —— v32 AI 家教 demo 页（/teach）前端模块

> 左备课本画布 + 右 Agent 对话栏 + ChatGPT 式课程历史。事件契约与后端
> Codex 会话层已定稿（见 teach-events.ts 头注）；后端就绪前用本地 mock
> 事件流开发（mockTeachStream.ts 把 public/demo/board-script-agent.json
> 转成契约流），**切换只改 teach-client.ts 的 isMockMode()**。

## 文件

| 文件 | 职责 |
|------|------|
| `teach-events.ts` | SSE 事件契约类型 + 纯函数：`boardEffectOf`（tool-call → 画布效果：append/flip/none；image 动作带 callId 回填定位键；**双词汇分支**：legacy 词表 write/circle/... 永久保留供旧线程回放，新引擎 teach-engine 词表 wb_draw_text→write（首条注入 title）/wb_draw_latex→formula/spotlight→circle（a_N→wN 启发式）/wb_clear→BoardClearAction/laser→`BoardEffect.laser` 瞬态（BoardLaser 真渲染，useTeachSession 只在 live 落地）/wb_open/wb_close/discussion→none；全量词表（TEACH_ACTIONS_FULL 默认放开）wb_draw_shape/table/line/code→结构化块动作（board-blocks.ts 类型，BoardBlocks 渲染），wb_edit_code→行级编辑载荷（`applyCodeEditToBoard` 按 elementId 找到 code 块逐行落板）；`createElementIdResolver` 逐事件登记 tool-call 流，把 spotlight/laser 的语义 elementId 翻成 wN（wb_clear/flip_page 后重置））、`applyImageUrlToBoard`（image-ready → 占位动作填 url）、`isVisibleTool`（气泡 chip 过滤；SILENT_TOOLS 含 speech/discussion/wb_open/wb_close）、`boardActionToToolCall`（mock 翻译用） |
| `mockTeachStream.ts` | `MockTeachSession`：BoardScript → 契约事件流（text-delta 按字流出、cue 到位插 tool-call、checkpoint 挂起等作答、answer 时「你的答案：…」write 上墙演示、ask canned 解答含 quote 织入）；游标快照/恢复 |
| `teach-client.ts` | **唯一收口**：listThreads/createThread/startLesson/sendMessage/interrupt + SSE 解析；mock（localStorage + MockTeachSession）与真实路由（/api/teach/*）双实现，isMockMode 一行切换（URL ?mock=0 或 NEXT_PUBLIC_TEACH_MOCK=0） |
| `teach-store.ts` | localStorage 历史（mock 阶段模拟 GET /api/teach/threads）：线程列表 + 每线程快照（对话 + 画布 + mock 游标） |
| `useTeachSession.ts` | 会话状态机 hook：事件流 → messages（text-delta 追加 / tool-call 挂 chip）+ pages（boardEffectOf 上板、flip_page 翻页、image-ready 回填占位 url）；ref 为权威数据源，快照 turn-complete 落盘；发送中再发问 = 先 interrupt 再发（「当前句讲完再说」的精确时机留后端联调）；语音管线接线：live 事件喂 speech-pipeline（回放不出声），interrupted/send/stop/换课立刻 silenceVoice；暴露 speaking/muted/setMuted/unlockAudio；标题跟随双协议（write role=title / 新引擎首条 wb_draw_text，engineTitleSeenRef 按线程重置，回放同路径） |
| `TeachBoard.tsx` | 画布封装：BoardCanvas（v32 备课本）+ BoardLaser 瞬态光圈层 + 划线引用提问（useTextSelection + QuoteAskPopover）；历史恢复 instant 直出终态 |
| `BoardLaser.tsx` | 激光笔瞬态指示（新引擎 laser 动作的真渲染）：指向板书元素的光点 + 扩散光圈，2.4s 淡出，不留永久板书。wN 目标走 annotation-measure 的字墨级包围盒，结构化块目标按 BoardFlow 外层 `data-element-id` 宿主盒量（坐标换算与标注层同源 toVirtualRect）；目标未渲染/已翻页不画（降级不炸板）。瞬态语义在数据层保证：useTeachSession 只在 live 事件置位 `laser`，事件日志回放永不重演 |
| `TeachChatPanel.tsx` | 右栏对话。渲染层 = Vercel AI Elements（`@/components/ai-elements/`）：ChatMessageList→Conversation（use-stick-to-bottom 自动跟随 + 回到最新）、ChatBubble→Message/MessageContent、ChatRenderer→MessageResponse（Streamdown 流式 markdown，CJK 加粗插件原语内置，排版规格 leading-[1.85]/text-[14.5px]/pine marker 走 className 覆盖，math 用默认链 + remark-math/rehype-katex 追加；narration 漏出的 `==高亮==` 经 `@/lib/utils/normalize-narration-marks` 归一为加粗）、ChatThinkingStripBubble→Loader；chip 行在消息上方；语音按钮 UI 占位（micDisabledHint）；quote chip 走 composer topSlot（ChatComposer/useChatComposer 保留） |
| `teach-response.test.tsx` | 渲染层迁移回归：CJK 加粗（MessageResponse vs 底座 StreamingMarkdown 对照）、流式半截 ``` 兜底、KaTeX 对齐、user 气泡壳 |
| `TeachThreadList.tsx` | 课程会话列表（桌面左栏 / 移动抽屉），新开一课/删除 |
| `QuoteAskPopover.tsx` | 划线浮钮「引用提问」（交互复用 WordExplainer 未展开态 + useTextSelection 豁免约定） |
| `useTeachSpeech.ts` | 讲课声音 hook 封装（从 useTeachSession 拆出）：SentenceSplitter+Player 持有，feedDelta/feedBreak/silence 三个喂口 + speaking/muted/unlockAudio |
| `speech-pipeline.ts` | 讲课声音前端流水线：SentenceSplitter 按句切分（句末标点；tool-call/turn 结束=自然断句点）→ TeachSpeechPlayer 顺序播放（播第 i 句时预取 i+1 的合成）；`fetchAudio` 可以给 Blob（整句 wav → Audio 元素，变速保音高）或 `PcmStreamSource`（流式 PCM → pcm-stream-audio 句柄），播放器不区分；unlock() 在用户手势激活（新开一课/发送）；stopAll=interrupt 立刻闭嘴；合成失败跳过该句不打扰讲课流 |
| `pcm-stream-audio.ts` | 流式 PCM 的 Web Audio 句柄（2026-09-11，讲给同桌听评委开口用）：/api/teach/tts `stream:true` 的 audio/pcm 分片到一片就 createBuffer + start(nextStart) 首尾相接，首片 ~0.4s 出声；`unlockSpeechAudioContext()` 要在用户手势里调一次；pause = 停止（不回调 onended）；setRate 是 playbackRate 会变音高（评委席语速固定 1） |
| `speech-pipeline.test.ts` | 切分器 + 播放器（顺序/预取/打断/失败跳过/静音）单测 |
| `pcm-stream-audio.test.ts` | 流式句柄：分片衔接 / 跨片半样本 / 首片回调 / 晚到的片从现在接 / pause / 自动播放策略挂起 |
| `teach-stream.test.ts` | teach-events + MockTeachSession 单测 |

页面：`src/app/teach/page.tsx`（布局：顶标题 / 左列表 / 中画布 / 右对话 380px；?pace=N 加速 mock 流）。

## 新引擎适配遗留（P1-B 收口，留 P2/P3）

- **done/讲完态**：旧协议 finish 工具置 done；新引擎 v1 词表无 finish 等价物，
  engine 线程 done 永不置位（UI 上完课态不出现）。P2 决策：词表加 finish
  还是前端按 turn-complete 启发。
- **laser**：已换真渲染（`BoardLaser.tsx`，2026-09-05；live 才落地，回放不重演）。
  spotlight/laser 的语义 elementId
  已由 `createElementIdResolver`（teach-events.ts）在 useTeachSession 逐事件登记
  翻译成 wN（2026-09-05 补丁，wb_clear/flip_page 后重置，对齐 flattenPage 重编号）；
  未登记的自定义 id 仍透传，渲染层找不到目标即不画，不炸板。
- 清板渲染语义在 `flattenPage`（board-lecture.ts）：最后一个 BoardClearAction
  之前的动作不渲染、write 从 w1 重编号；legacy 词表无 clear，行为不变。

## 待后端联调（2026-08-21 已完成一轮，契约终稿见 src/app/api/teach/DOMAIN.md）

- ~~消息路由入参~~：已对齐——订阅制 SSE（GET .../stream）+ POST ack；
  interrupt 附 text = 打断续讲一步；历史恢复 = GET .../events 事件日志回放
- 划线引用：messages 只收 text，quote 按 buildWireText 拼进 text 发送、回放
  拆回（后端原生收 quote 字段后改 teach-events.ts 一处）
- 提问时机「当前句讲完再说」：前端立即 interrupt + 发消息（路由注释确认
  打断时机由前端控制）
- 语音提问（按钮是 disabled 占位）

## 真实模式健壮性（联调后）

- 订阅断线自愈：EventSource error 后重连 open → 全量重放事件日志追齐；
  75s 静默看门狗兜底（阈值 > Gemini TTFT 上限 30s）
- 会话代数 epochRef：init openThread 与手动新开课的竞态，慢的一方落地即弃
- 重连不重复开课：onReady 走 EventSource open 且只 fire 一次
