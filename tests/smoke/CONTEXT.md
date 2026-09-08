# Context 本地验收

系统终止验收进程后，可在 cleanup-context-live 设置 CONTEXT_VERIFY_STATES=true，先对全部已暂停/忘记的精确 fixture 补验空态和明确模拟的降级 UI，再执行正常清理，分别保存 UI_STATES.json/RECOVERY.json；不会把原先中断的整轮标记 passed。

画像来源弹层有独立截图。暂停全部来源后的空画像使用真实账户；降级 UI 截图文件名明确标注 ui-fixture，仅模拟 prepare 故障响应，不宣称服务停机演练。断网/后端不可用契约另由 Context 服务测试覆盖。自动画像可见性显式等待60秒，Playwright expect 不沿用 page 的默认等待设置。

测验验收故意延迟真实 /api/auth/me 到首次确认答案之后，验证已有登录 token 的认证初始化窗口内作答不会丢失。只延迟网络时序，不替换身份响应。

开发模式首次编译测验页面可能超过 30 秒，浏览器导航上限 120 秒；事件落库轮询每 2 秒一次，避免错误状态下耗尽读取额度。

失败清理恢复：确认 `make context-worker` 运行，设置 `CONTEXT_FIXTURE_ID=context-live-<报告中的完整 UUID>`，执行 `make cleanup-context-live`。命令核验本地报告、精确合成用户 ID/username，调用正式控制服务发起 forget，等待 worker，再验证原文/operation/recall 均已清理后事务删除 fixture。任何失败保留本地记录，禁止手工删库掩盖未完成清理。不适用于已丢失数据库记录的历史事故或真实用户。

2026-09-08：真实浏览器验收先确认自动画像，再按同一任务检索、打开来源弹层，记录桌面/移动截图并检查横向溢出。偏好更新检查新练习是否出现天文情境、纠正来源是否在当前用户证据中；不要求所有文本禁止提及过去情境，也不宣称已验证基准率教学质量。

清理成功必须同时满足 forgotten、无 cleanupPending、无原文、上游 operation 不存在、recall 为空。忘记 HTTP 失败时后台不会凭空发起清理；报告保留账户并明确要求重新发起，不再标注为仅等待 worker。

`make smoke-context-live` 是真实模型应用验收：要求运行本地 dev、context-worker 和真实 Hindsight，SMOKE_BASE 指向本地服务（默认 45673）。使用隔离合成用户，经内部课堂观察 HTTP、真实测验 UI（仅生成题目为 fixture）、后台投递、Hindsight、实际 Tutor SSE 与 Context 来源页面，比较相同问题的全新对话。记录完整回答、finish reason 和截图，验证暂停、恢复、遗忘。它不声称验证音频采集或教育效果提升比例。输出在 out/context-live/<fixture-id>/；失败退出非零，未确认上游清理时保留事件供 worker 恢复，不提前删本地记录。context-live-tutor.ts 负责真实 SSE 完成校验，context-live-browser.ts 负责来源与桌面/移动截图。

`make smoke-context`：使用本机 dev server（默认 127.0.0.1:3101），创建临时合成账户，经真实登录签名、middleware、API、SDK 和浏览器验证写入/跨应用读取/权限/暂停/忘记/撤销。最后删除测试账户及凭证；不使用既有用户数据。

前置：Node 24、`make db-push`、本地配置 JWT_SECRET 和 CONTEXT_ENABLED=true；不配置 CONTEXT_HINDSIGHT_URL（本次只验证无模型时的真实降级）。启动 `make dev` 并设置 PORT=3101、HOST=127.0.0.1。浏览器默认本机 Edge，SMOKE_BROWSER 可选 chrome。只允许 loopback 地址和非 production 环境。

Prisma CLI 的 DATABASE_URL 必须指向与运行时一致的绝对 prisma/meetmind.db 路径；它不自动加载 .env.local。准确命令见 docs/plans/CONTEXT_M1_DELIVERY.md。

截图和报告在 ignored `out/context-smoke/`。合成场景不等于模型效果：真实 Hindsight 的提取/检索/清理语义仍须配置后联调，使用 `make test-context` 验证官方 API 契约替身和数据库故障恢复。

还验证浏览器授权字段校验、内部应用活动适配，以及独立子进程运行 context-client 对显式事件文件的写后读取。生成的 external-event.json 是有明确标注的合成 fixture，凭证只通过进程环境传递，不写入报告与截图。

context-quiz-browser.ts 在真实独立测验页面操作首次客观题作答、看参考答案后自评与重新练习，经实际 /api/memory/events 验证完整题面、真实选项、自评的 submittedAnswer=null 和复练的答案暴露标记。只将题目生成响应替换为显式合成 fixture，不替换组件、身份、事件适配或数据库。该阶段使用另一临时账户以隔离速率额度，所有测试用户在 finally 清理。

context-mcp-process.ts 使用官方 stdio 客户端启动交付的 MCP 入口，验证实际 HTTP 下的重复写入、任务读取与原文追溯。未使用协议或 HTTP 替身。
