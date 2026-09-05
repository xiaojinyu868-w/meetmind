# api/fenshen/ —— 「请一个分身」线（codex app-server 底座，teach 平级）

> 分身架 + 蒸馏进度 + 分身对话：浏览器 ←SSE→ 本目录路由 ←JSON-RPC→ codex
> app-server（蒸馏线程挂 Firecrawl 官方 MCP；对话线程不挂 MCP）。编排逻辑
> 全在 `src/lib/services/fenshen/`，路由是薄壳。

## 事件契约（SSE data 行 JSON，与前端并行开发的唯一事实源）

```
{type:'thread',threadId}          订阅建立时的首个事件（threadId = egoId）
{type:'text-delta',text}          分身对话 agent 说的话（流式增量；蒸馏期不下发）
{type:'distill-progress',note}    账本式蒸馏进度（服务端固定人话短语：翻阅讲课素材/
                                  提炼语言习惯/…/检索公开资料；命令/文件名/Phase 等
                                  内部机制一律不进 note——skill 永不对用户可见）
{type:'ego-ready',skillPath}      蒸馏完成（SKILL.md 已落盘），分身可对话
{type:'turn-complete'}            一轮结束
{type:'interrupted'}              当前 turn 被打断
{type:'error',message}            错误（人可读）
```

时序保证：单分身内事件按发生顺序到达；蒸馏与对话共用一条订阅（同一 egoId
扇出）；interrupted 之后若 interrupt 请求附带了 text，紧跟新 turn 的
text-delta 流（同一条 SSE 连接，不断线）。

## 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/fenshen/egos` | GET | 分身架列表（updatedAt 倒序） |
| `/api/fenshen/egos` | POST | 请分身 `{name, sourceType, sourceRef?}`（name ≤50字；sourceType ∈ hall/bilibili/upload，非 hall 需 sourceRef）→ `{ego}`；建行后立即起蒸馏线程，启动失败置 status=failed（failReason 人可读）并 500 |
| `/api/fenshen/egos/[id]/stream` | GET | SSE 订阅（EventSource 友好；25s 心跳；首事件 `thread`） |
| `/api/fenshen/egos/[id]/events` | GET | 事件日志全量回放 `{events}`（含 user-message 记录；打开分身/断线重连时先拉这里重建历史，再订阅 stream 续接） |
| `/api/fenshen/egos/[id]/messages` | POST | 与分身对话 `{text, sessionId?, lessonSnapshot?}`（≤2000字）→ `{ok:true}`；分身未 ready 或 turn 进行中 409。`sessionId` = 当前课程会话：分身按这节课物化；服务端查不到该会话（guest/demo 未持久化）时用 `lessonSnapshot`（前端这节课的转录快照）物化，**不回落无关 capture**；两者都没给才回退全库最新 |
| `/api/fenshen/egos/[id]/interrupt` | POST | 打断 `{text?, sessionId?, lessonSnapshot?}`（scope 语义同 messages）；附带 text 时 interrupted 落地后同线程续讲 |
| `/api/fenshen/egos/[id]/feedback` | POST | 试听反馈 `{verdict:'like'|'unlike', note?}`；unlike 触发重蒸馏 turn（带 note 重听），状态回 learning，修订落盘后再发 ego-ready |

设计决定与 teach 一致：**一条长连接 SSE 订阅 + POST 回 ack**（interrupt 附带
消息的续讲事件流在同一条连接上，前端无需重连）；EventSource 无法带
Bearer，故 `/api/fenshen/*` 在 public-routes（与 `/api/teach/*` 同级别）。
分身线无 MCP 内部回调，不需要 internal 令牌。

## 持久化

- `FenshenEgo`（prisma）：id/name/sourceType(hall|bilibili|upload)/sourceRef/
  status(learning|ready|failed)/skillPath/distillThreadId/chatThreadId/model/
  failReason/createdAt/updatedAt。两个 codex 线程 id 在各自拉起后回填，
  进程回收/重启后 thread/resume 续跑。
- 事件日志：`data/fenshen-events/<egoId>.jsonl`（append-only，供重放）。
  除 SSE 契约事件外还落 `{type:'user-message',text}` 记录（只落盘不广播），
  供历史恢复完整对话。

## 鉴权

公开路由（EventSource 限制），与 `/api/teach/*` 同级。
