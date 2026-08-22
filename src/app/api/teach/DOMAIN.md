# api/teach/ —— AI 家教「上课」线（codex app-server 底座）

> 交互式教学会话：浏览器 ←SSE→ 本目录路由 ←JSON-RPC→ codex app-server
> ←MCP stdio→ 板书工具（server/teach/teach-mcp-server.mjs → 内部回调回本目录
> internal/*）。编排逻辑全在 `src/lib/services/teach-codex/`，路由是薄壳。
> 协议事实与坑：`out/codex-spike/REPORT.md`。

## 事件契约（SSE data 行 JSON，与前端并行开发的唯一事实源）

```
{type:'thread',threadId}         订阅建立时的首个事件
{type:'text-delta',text}         老师讲的话（流式增量）
{type:'tool-call',id,name,args}  板书工具调用（args 已解析 JSON；name ∈ 11 工具集）
{type:'tool-result',id,result}   工具结果（BoardEnv digest：{ok,board:"第N页 · 第M栏 · wN清单",...}）
{type:'turn-complete'}           一轮讲完
{type:'interrupted'}             当前 turn 被打断
{type:'error',message}           错误（人可读）
```

时序保证：单线程内事件按发生顺序到达；tool-call 一定先于同 id 的
tool-result；interrupted 之后若 interrupt 请求附带了 text，紧跟新 turn 的
text-delta 流（同一条 SSE 连接，不断线）。

## 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/teach/threads` | GET | 历史课程列表（updatedAt 倒序，status=active） |
| `/api/teach/threads` | POST | 新建课程 `{topic}`（≤100字，先只支持文本课题）→ `{thread}` |
| `/api/teach/threads/[id]/stream` | GET | SSE 订阅（EventSource 友好；25s 心跳；首事件 `thread`） |
| `/api/teach/threads/[id]/events` | GET | 事件日志回放（含 student-message 落盘记录；历史课程恢复用，前端按序重建对话+画布） |
| `/api/teach/threads/[id]/messages` | POST | 发学生消息/开课 `{text}`（≤2000字）→ `{ok:true}`；turn 进行中 409 |
| `/api/teach/threads/[id]/interrupt` | POST | 打断 `{text?}`；附带 text 时 interrupted 落地后同线程续讲 |
| `/api/teach/tts` | POST | 讲课声音合成（按句）：`{text}` ≤300字 → wav 二进制；百炼 qwen3-tts-instruct-flash + Cherry + 教学语气指令（teach.config.ts TTS 注册表，`TEACH_TTS_PROVIDER` 留 MiniMax 切换位）；串行闸 1 路 + 退避重试；两级缓存（进程 LRU 64 + `data/teach-tts-cache/` 200 FIFO）；失败 503 前端跳句 |
| `/api/teach/internal/tools` | GET | MCP server 拉工具描述（`x-teach-internal` 令牌鉴权） |
| `/api/teach/internal/tool` | POST | MCP server 工具回调 `{threadId,name,args}` → `{result}`（同上鉴权） |

设计决定：**一条长连接 SSE 订阅 + POST 发消息回 ack**（而非 POST 返回 SSE）。
interrupt 附带消息的续讲事件因此能流在同一条连接上，前端无需重连；
EventSource 无法带 Bearer，故 `/api/teach/*` 在 public-routes（与
`/api/classroom/*` 同级别），internal 子路由靠进程内随机共享令牌自验。

## 持久化

- `TeachThread`（prisma）：id/title/topic/model/codexThreadId/status/createdAt/updatedAt。
  codexThreadId 首个 turn 拉起后回填，进程回收/重启后 thread/resume 续讲。
- 事件日志：`data/teach-events/<threadId>.jsonl`（append-only，供重放/复习线；
  BoardEnv 也靠它重放恢复）。除 SSE 契约事件外还落 `{type:'student-message',text}`
  记录（只落盘不广播——学生消息不经总线），供历史恢复完整对话。

## 鉴权

公开路由（EventSource 限制）；internal/* 用 `x-teach-internal` 令牌
（Next 进程启动时生成，拉起 codex 时经 config.toml 的 mcp env 注入 MCP server）。
