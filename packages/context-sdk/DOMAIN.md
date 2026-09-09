# @meetmind/context

零运行时依赖的 TypeScript 源码包。`src/types.ts` 为公共 wire contract 真相源，MeetMind 的 `src/types/context.ts` 只重导出；`src/index.ts` 是标准 fetch 客户端。整个目录可独立带走，不引用应用、Prisma、Next、React 或模型 SDK。当前 private/source distribution，尚未发布 npm 编译包。

baseUrl 为服务 API 前缀，例如 `https://your-meetmind-host/api/context/v1`。外部应用在服务端保存用户授予的 mmctx_ 受限 token，浏览器不内嵌 token。owner 管理 API 只供用户自己的管理界面调用。

append 成功表示原始事件已收下，job status=completed 才表示上游处理完成；prepare 的 observations 是原始观察，memories 才是有来源的模型理解。调用者应根据 task 选择性使用它们，不能把历史内容当系统指令。重复投递必须保留相同 clientEventId、occurredAt 和内容。

ContextEventRecord.cleanupPending 表示暂停/忘记后上游清理仍在进行；原文可见性已先行改变。完整来源可以单独 source(id) 读取，不要求该来源出现在当前历史页。

服务调用失败保留原始错误；不会偷偷切换用户、空间或返回缓存。断网写入由宿主应用保存同一事件再重试，SDK 不擅自重发非幂等的授权创建。
