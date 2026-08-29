# components/fenshen/ —— 「请一个分身」前端（分身架 / 请分身 / 分身对话）

> 与 teach 线平级的分身线前端。数据流：浏览器 ←SSE/REST→ `/api/fenshen/*`
> （契约事实源：`src/app/api/fenshen/DOMAIN.md`）← codex app-server。
> 渲染层用 copy-in 的 AI Elements（`src/components/ai-elements/`），纯展示层，
> 由本目录的 SSE 状态机喂数据，与传输协议无关。

## 铁律

- **skill 内容永不出现在用户面 UI**——蒸馏过程只以"账本式进展"（服务端文案化
  的 distill-progress note）可见；确认发生在输出上（试听 → 像/不像他）
- 文案全走 `COPY.fenshen` / `COPY.aiElements`（`src/lib/ui/copy.ts`）
- 依赖方向：本目录不 import `lib/services/*`，事件类型在 `fenshen-events.ts`
  独立声明（与服务端 event-bus 保持同形）

## 文件

| 文件 | 职责 |
|------|------|
| `fenshen-events.ts` | 前端事件契约 + 纯状态机（applyFenshenEvent / replayFenshenEvents，无 React/fetch 依赖，node 可直接测） |
| `fenshen-client.ts` | 与 `/api/fenshen/*` 的唯一收口：list/create/upload/events/stream/messages/interrupt/feedback（ack 型 POST） |
| `useFenshenSession.ts` | 事件流状态机 hook：open = GET events 全量回放 + EventSource 订阅续接；断线自愈靠浏览器自动重连 + 重放追齐（幂等）；streaming 中发送 = interrupt 附带 text（打断续讲一步） |
| `FenshenShelf.tsx` | 分身架全屏层（fixed inset-0，IntentDialog 模式）：shelf（卡列表 + 请分身入口）→ onboard → chat 三视图 |
| `FenshenOnboardFlow.tsx` | 请分身三选一：名人堂（首发只有孔子）/ 贴 B 站链接 / 上传录音（先走 /api/upload-audio 拿 sourceRef） |
| `FenshenChatPanel.tsx` | 分身对话：AI Elements（Conversation/Message/MessageResponse 流式 markdown/Loader）+ 试听引导条 +「像/不像他」反馈条（unlike 带 note → 重蒸馏，状态回 learning 等 ego-ready）+ 打断 |
| `DistillProgressView.tsx` | 账本式蒸馏进度（AI Elements Tool 容器，可折叠默认收起） |
| `FenshenEntryChip.tsx` | 「请一个分身」固定入口（自包含 shelf 层状态），两种形态：card（课后应用矩阵 WorkshopYellowPage 独立区块，用户可发现性主入口）/ chip（ClassroomCompanionPanel 课后 starter 卡）；不进 WORKSHOP_APP_CATALOG |

## 关键设计

- **发送语义与 teach 对齐**：POST 只回 ack，分身的话经同一条 SSE 流出；
  streaming 中发送走 interrupt+text；非 streaming 收到 409 自动降级 interrupt+text
- **历史恢复**：打开分身先拉 `/events` 回放（含只落盘不广播的 user-message），
  回放末态一律不流式（崩溃中断的 turn 不再挂 typing）
- **反馈即确认**：不像他 → POST feedback(unlike, note) → 本地强制 learning 态，
  重蒸馏的进度 / ego-ready 经订阅流回，无需轮询

## 测试

`fenshen-events.test.ts`（状态机 + 回放幂等）、`fenshen-client.test.ts`
（请求形状 / 错误消息抽取；vi.stubGlobal fetch）。跑：
`npx vitest run src/components/fenshen`
