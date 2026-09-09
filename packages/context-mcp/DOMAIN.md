# Context MCP

复用已安装的官方 `@modelcontextprotocol/sdk` 1.29 协议与 stdio transport，工具仅适配独立 HTTP SDK。`server.ts` 为可测构造器，`main.ts` 为独立进程入口。工具只有 prepare/append/source/job；没有应用授权管理、任意 bank 或跨用户入口。

根 package.json 显式固定 SDK 1.29.0，沿用现有依赖树中的受维护 v1 版本，不依赖偶然的传递安装。`make test-context` 用官方 Client + InMemoryTransport 做初始化、工具发现与调用验证。

`make smoke-context` 另通过官方 StdioClientTransport 启动实际 main.ts 子进程，对真实 HTTP 服务验证 append 幂等、prepare 与 source；凭证通过进程环境传递，不写日志。

启动环境：MEETMIND_CONTEXT_URL 是 `/api/context/v1` 前缀，MEETMIND_CONTEXT_TOKEN 必须是用户授权生成的 mmctx_ token。拒绝 owner JWT。stdout 只交给官方 SDK 输出 MCP 帧；错误通过工具结果返回机器码，不输出原始异常或密钥。

在仓库运行 `make context-mcp`。分发时需要本目录、相邻 context-sdk 源码和 package.json 中的依赖。未发布 registry；不自动安装到开发者的工具配置。
