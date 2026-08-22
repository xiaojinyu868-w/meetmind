# teach/ —— v32 AI 家教 demo 页（/teach）前端模块

> 左备课本画布 + 右 Agent 对话栏 + ChatGPT 式课程历史。事件契约与后端
> Codex 会话层已定稿（见 teach-events.ts 头注）；后端就绪前用本地 mock
> 事件流开发（mockTeachStream.ts 把 public/demo/board-script-agent.json
> 转成契约流），**切换只改 teach-client.ts 的 isMockMode()**。

## 文件

| 文件 | 职责 |
|------|------|
| `teach-events.ts` | SSE 事件契约类型 + 纯函数：`boardEffectOf`（tool-call → 画布效果：append/flip/none）、`isVisibleTool`（气泡 chip 过滤）、`boardActionToToolCall`（mock 翻译用） |
| `mockTeachStream.ts` | `MockTeachSession`：BoardScript → 契约事件流（text-delta 按字流出、cue 到位插 tool-call、checkpoint 挂起等作答、answer 时「你的答案：…」write 上墙演示、ask canned 解答含 quote 织入）；游标快照/恢复 |
| `teach-client.ts` | **唯一收口**：listThreads/createThread/startLesson/sendMessage/interrupt + SSE 解析；mock（localStorage + MockTeachSession）与真实路由（/api/teach/*）双实现，isMockMode 一行切换（URL ?mock=0 或 NEXT_PUBLIC_TEACH_MOCK=0） |
| `teach-store.ts` | localStorage 历史（mock 阶段模拟 GET /api/teach/threads）：线程列表 + 每线程快照（对话 + 画布 + mock 游标） |
| `useTeachSession.ts` | 会话状态机 hook：事件流 → messages（text-delta 追加 / tool-call 挂 chip）+ pages（boardEffectOf 上板、flip_page 翻页）；ref 为权威数据源，快照 turn-complete 落盘；发送中再发问 = 先 interrupt 再发（「当前句讲完再说」的精确时机留后端联调）；语音管线接线：live 事件喂 speech-pipeline（回放不出声），interrupted/send/stop/换课立刻 silenceVoice；暴露 speaking/muted/setMuted/unlockAudio |
| `TeachBoard.tsx` | 画布封装：BoardCanvas（v32 备课本）+ 划线引用提问（useTextSelection + QuoteAskPopover）；历史恢复 instant 直出终态 |
| `TeachChatPanel.tsx` | 右栏对话（Chat 底座：ChatMessageList/ChatBubble/ChatComposer/ChatRenderer）；chip 行在气泡上方；语音按钮 UI 占位（micDisabledHint）；quote chip 走 composer topSlot |
| `TeachThreadList.tsx` | 课程会话列表（桌面左栏 / 移动抽屉），新开一课/删除 |
| `QuoteAskPopover.tsx` | 划线浮钮「引用提问」（交互复用 WordExplainer 未展开态 + useTextSelection 豁免约定） |
| `useTeachSpeech.ts` | 讲课声音 hook 封装（从 useTeachSession 拆出）：SentenceSplitter+Player 持有，feedDelta/feedBreak/silence 三个喂口 + speaking/muted/unlockAudio |
| `speech-pipeline.ts` | 讲课声音前端流水线：SentenceSplitter 按句切分（句末标点；tool-call/turn 结束=自然断句点）→ TeachSpeechPlayer 顺序播放（Audio 元素；播第 i 句时预取 i+1 的合成）；unlock() 在用户手势激活（新开一课/发送）；stopAll=interrupt 立刻闭嘴；合成失败跳过该句不打扰讲课流 |
| `speech-pipeline.test.ts` | 切分器 + 播放器（顺序/预取/打断/失败跳过/静音）单测 |
| `teach-stream.test.ts` | teach-events + MockTeachSession 单测 |

页面：`src/app/teach/page.tsx`（布局：顶标题 / 左列表 / 中画布 / 右对话 380px；?pace=N 加速 mock 流）。

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
