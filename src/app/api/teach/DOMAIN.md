# api/teach/ —— AI 家教「上课」线（codex 底座 × teach-engine × teach-live 三线并存）

> 交互式教学会话：浏览器 ←SSE→ 本目录路由 → 按线程引擎归属分发到三套编排：
> - **codex 底座**（legacy，`src/lib/services/teach-codex/`）：←JSON-RPC→ codex
>   app-server ←MCP stdio→ 板书工具（server/teach/teach-mcp-server.mjs → 内部回调
>   回本目录 internal/*）。协议事实与坑：`out/codex-spike/REPORT.md`。
> - **teach-engine**（P1，`src/lib/services/teach-engine/`）：pi loop + vendor
>   OpenMAIC 动作引擎，结构化动作直出、边生成边执行，无 codex 进程与 MCP。
> - **teach-live**（2026-09-10，`src/lib/services/teach-live/`）：标签流协议 + 多模态板书
>   （svg 逐笔长出 / plot / diagram / code / anim / widget / 异步 image），一轮一次 streamText，
>   节奏在前端按语音演出；前端是独立的 `/teach/live`。
> 引擎归属在创建线程时快照进 `TeachThread.engine`（codex | engine | live）：
> body.engine 显式指定优先，否则按 `TEACH_ENGINE`；**engine=null 的迁移前旧线程一律按 codex 分发**。
> 路由是薄壳：分发只在 threads/messages/interrupt 三个写路由，stream /
> internal/* 零改动（事件契约三侧一致，live 只追加了四种块事件）。

## 事件契约（SSE data 行 JSON，与前端并行开发的唯一事实源）

```
{type:'thread',threadId}         订阅建立时的首个事件
{type:'text-delta',text}         老师讲的话（流式增量）
{type:'tool-call',id,name,args}  板书工具调用（args 已解析 JSON；name 词表见下）
{type:'tool-result',id,result}   工具结果（digest：codex={ok,board:"第N页 · 第M栏 · wN清单"}；engine={ok:true, board:"板书清单文本"}）
{type:'turn-complete'}           一轮讲完
{type:'interrupted'}             当前 turn 被打断
{type:'image-ready',id,url}      插图回填完成（codex 线程：image tool-call 的 id，/uploads/teach/；live 线程：image 块 id，/uploads/teach-live/；engine v1 无 image 动作）
{type:'error',message}           错误（人可读）
{type:'block-open',id,kind,attrs} / {type:'block-delta',id,text} / {type:'block-close',id,complete} / {type:'cue',name,args}
                                 **仅 live 线程**：板书块与提示动作（kind / name 词表见 src/types/teach-live.ts）；口播正文仍走 text-delta
```

**tool-call name 双词表**（按线程引擎归属各出一套，前端 boardEffectOf 双分支）：
- codex：write / circle / underline / arrow / mark / new_column / image /
  flip_page / pause / ref / finish（`teach-agent/tools.ts` 11 工具集）
- teach-engine（runtime/action-map.ts ACTIONS_V1）：wb_draw_text / wb_draw_latex /
  wb_clear / spotlight / laser / discussion / wb_open / wb_close（speech 是口播
  队列内部动作，不发 tool-call）；`TEACH_ACTIONS_FULL=1` 放开全量 KNOWN
  （wb_draw_shape/table/line/code、wb_edit_code 等，前端降级不上板）

时序保证：单线程内事件按发生顺序到达；tool-call 一定先于同 id 的
tool-result；interrupted 之后若 interrupt 请求附带了 text，紧跟新 turn 的
text-delta 流（同一条 SSE 连接，不断线）。image-ready 是异步回填事件
（生图几十秒级，turn-complete 之后几十秒才到），对应 image tool-call
可能早于它很多；在线时经 SSE 推送，同时落事件日志供回放。

## 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/teach/threads` | GET | 历史课程列表（updatedAt 倒序，status=active；每项带 `engine`；`?engine=live` 只列该引擎） |
| `/api/teach/threads` | POST | 新建课程 `{topic, engine?}`（≤100字，先只支持文本课题）→ `{thread}`（含 engine）；`engine` 取 body 显式值，否则按 `TEACH_ENGINE` 快照，preflight 按目标引擎分发（live 用 `TEACH_LIVE_PROVIDER`）。**learner 读槽（2026-09-08）**：body 可带 `learner: LearnerContext`（本机切片，不合法当没有），服务端 `resolveLearnerContext`（登录用户：外部 context 系统 → 本仓库服务端事件表切片 `learner-context-provider` → 本机切片）后存 `TeachThread.learnerJson`；两条线在会话建立时用 `learnerFactsFromRow` 拼「关于这位学生」段，旧线程 null 一字不加 |
| `/api/teach/threads/[id]/stream` | GET | SSE 订阅（EventSource 友好；25s 心跳；首事件 `thread`） |
| `/api/teach/threads/[id]/events` | GET | 事件日志回放 `{events, engine, title, topic}`（含 student-message 落盘记录；历史课程恢复用，前端按序重建对话+画布）；顺带触发缺配图的后台生图自愈（live 线程走 teach-live/live-image，其余走 teach-codex/image-backfill；不阻塞响应） |
| `/api/teach/threads/[id]/messages` | POST | 发学生消息/开课 `{text}`（≤2000字）→ `{ok:true}`；turn 进行中 409；按 `TeachThread.engine` 分发到 teach-session-service / teach-engine-service / teach-live-service（404/409 语义与响应形状三侧一致） |
| `/api/teach/threads/[id]/interrupt` | POST | 打断 `{text?}`；附带 text 时 interrupted 落地后同线程续讲；引擎分发同上 |
| `/api/teach/tts` | POST | 讲课声音合成（按句）：`{text}` ≤300字 → wav 二进制；百炼 qwen3-tts-instruct-flash + Cherry + 教学语气指令（teach.config.ts TTS 注册表，`TEACH_TTS_PROVIDER` 留 MiniMax 切换位）；串行闸 1 路 + 退避重试；两级缓存（进程 LRU 64 + `data/teach-tts-cache/` 200 FIFO）；失败 503 前端跳句 |
| `/api/teach/internal/tools` | GET | MCP server 拉工具描述（`x-teach-internal` 令牌鉴权） |
| `/api/teach/internal/tool` | POST | MCP server 工具回调 `{threadId,name,args}` → `{result}`（同上鉴权） |

设计决定：**一条长连接 SSE 订阅 + POST 发消息回 ack**（而非 POST 返回 SSE）。
interrupt 附带消息的续讲事件因此能流在同一条连接上，前端无需重连；
EventSource 无法带 Bearer，故 `/api/teach/*` 在 public-routes（与
`/api/classroom/*` 同级别），internal 子路由靠进程内随机共享令牌自验。

## 持久化

- `TeachThread`（prisma）：id/title/topic/model/codexThreadId/engine/learnerJson/status/createdAt/updatedAt。
  codexThreadId 首个 turn 拉起后回填（仅 codex 线程），进程回收/重启后 thread/resume 续讲。
  engine 是创建时快照的引擎归属（codex | engine | live）；null = 迁移前旧线程，一律走 codex。
- 事件日志：`data/teach-events/<threadId>.jsonl`（append-only，供重放/复习线；
  BoardEnv 也靠它重放恢复）。除 SSE 契约事件外还落 `{type:'student-message',text}`
  记录（只落盘不广播——学生消息不经总线），供历史恢复完整对话。
- 插图回填：image 工具调用只落 prompt（占位框先上板）；turn 结束 / 事件日志被
  回放读取时由 `teach-codex/image-backfill.ts` 后台生图（dashscope，与旧
  teach-agent 线同 provider），落盘 `public/uploads/teach/<sha1(callId)前16位>.png`，
  完成追加并广播 image-ready；失败只记日志留占位，10 分钟冷却后再允许重试。

## 鉴权

公开路由（EventSource 限制）；internal/* 用 `x-teach-internal` 令牌
（Next 进程启动时生成，拉起 codex 时经 config.toml 的 mcp env 注入 MCP server）。
