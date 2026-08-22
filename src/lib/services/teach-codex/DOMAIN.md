# teach-codex/ —— codex app-server 教学会话层

> 「上课」线的服务端编排：把 codex app-server 当 agent 底座（持久线程 /
> 流式事件 / interrupt / MCP），MeetMind 侧只管协议翻译、事件扇出、
> BoardEnv 与持久化。spike 事实源：`out/codex-spike/REPORT.md`。
> 与 `teach-agent/`（备课态一口气生成整节课的 AI SDK loop）是两条线：
> 这里复用它的 `tools.ts` 作为工具 schema 单一事实源，不复用其 loop。

## 架构

```
浏览器 ←SSE→ /api/teach/* ←JSON-RPC(stdio)→ codex app-server（每线程一进程）
                                                ↕ MCP stdio：server/teach/teach-mcp-server.mjs
                                                │   → POST /api/teach/internal/tool（BoardEnv digest 回填）
                                              shim（Next 进程内，127.0.0.1:TEACH_SHIM_PORT）
                                                ↓ Responses→Chat 纯翻译
                                          上游 chat 模型（teach.config provider 注册表）
```

关键决定：
- **每线程一进程**：CODEX_HOME 隔离到 `data/teach-codex/<threadId>/`（不污染
  ~/.codex），config.toml 由会话服务生成（provider 永远指本地 shim，MCP env
  注入 threadId/回调地址/内部令牌）。工具调用按进程归属线程，无串线问题。
- **无 ask 阻塞结构**：不实现阻塞式提问工具；教学提问走自然轮次
  （学生消息 = 新 turn），工具集 11 个（不含 teach-agent 的 ask）。
- **tool 事件单通道**：tool-call/tool-result 只由 MCP 内部回调发（带我们的
  id 与 digest），codex 的 mcpToolCall 通知忽略，避免双通道重复。
- **shim 零编排**：只做 Responses↔Chat 翻译；三个已验证的坑（developer
  role、parallel calls 聚合、namespace 工具展平/还原）见 shim-translate.ts 头注。

## 文件

| 文件 | 职责 |
|------|------|
| `teach-session-service.ts` | 编排：preflight → ensureShim → 写 config.toml → 拉起/恢复 codex 线程 → turn/start / turn/interrupt（附消息时等 interrupted 再续讲）→ 通知映射为契约事件；`handleMcpToolCall` 工具回调入口（write formula 文本在此过 `normalizeFormulaText`——模型偶发把 LaTeX 反斜杠双重转义，事件流与 BoardEnv 在源头拿同一份干净文本）；turn-active 防并发（409）；sendTeachMessage 落 student-message 日志记录 |
| `codex-app-server.ts` | app-server 进程封装：stdio JSON-RPC 客户端 + 每线程注册表 + 空闲回收（TeachConfig.idleMs，默认 15min）+ 崩溃标记（下次用线程自动重启 + thread/resume） |
| `shim-translate.ts` | Responses→Chat 纯翻译（零 IO 可单测）：请求消息/工具翻译 + 流式状态机（chat chunk → Responses 事件） |
| `shim-server.ts` | shim HTTP 服务（Next 进程内单例，127.0.0.1；端口占用则 /health 复用已有实例） |
| `event-bus.ts` | 按线程 pub/sub + 契约事件类型（SSE 唯一事实源） |
| `thread-store.ts` | TeachThread prisma CRUD + 事件日志落盘/读取（data/teach-events/*.jsonl） |
| `board-env.ts` | 按线程 BoardEnv：工具描述导出（z.toJSONSchema）、参数校验执行、事件日志重放恢复 |
| `internal-auth.ts` | 内部回调共享令牌（进程内随机生成，经 codex config.toml mcp env 下发） |
| `*.test.ts` | shim 翻译 / 事件总线 / 工具执行与重放（vitest） |

配套：`server/teach/teach-mcp-server.mjs`（codex 的子进程，零依赖手写 MCP
stdio）；`src/lib/prompts/teach-teacher-prompt.ts`（baseInstructions，整体
替换 codex 编码人设）；`src/lib/config/teach.config.ts`（provider 注册表：
gemini-commonstack 默认 / glm-dashscope 备选，`TEACH_PROVIDER` 一行切换）。

## 生命周期与恢复

- 发消息时按需拉起：shim → config.toml → 进程 → thread/start（首回合并回填
  codexThreadId）/ thread/resume（之后）。
- 空闲回收：reaper 每 60s 扫，超 idleMs 无活动杀进程；线程数据在 CODEX_HOME
  落盘，下次发消息 resume 续讲（spike §5c 验证上下文保留）。
- 崩溃：进程 exit → 注册表摘除；下次发消息重启 + resume。Next 重启后
  BoardEnv 从事件日志重放恢复（board-env.rebuildBoardEnv）。

## 边界

- 图像题（topic 图片）未支持：POST threads 只收文本 topic。
- 单实例部署假设：事件总线/进程注册表是进程内的（与现有 ASR WS 同构）。
- codex 面向编码的能力（沙箱/apply_patch/goals）靠 `sandbox=read-only` +
  `approval_policy=never` + baseInstructions 压住，版本升级需回归冒烟。
