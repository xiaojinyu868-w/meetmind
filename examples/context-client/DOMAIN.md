# 独立应用接入样例

`main.ts` 在独立进程用外部应用凭证读取当前任务相关 Context，仅依赖可带走的 SDK 和 Node 文件读取。它是 Context 接入样例，不是假装调用模型的家教或测验生成器。

先在 `/context` 写入真实经历并创建应用授权，将 token 与 URL 配入进程环境后运行 `make context-example`；可用 MEETMIND_CONTEXT_TASK 指定任务。输出完整 bundle，包括来源与降级状态。默认只读。

显式设置 MEETMIND_CONTEXT_EVENT_PATH 为一个 ContextEventInput JSON 文件时，先通过具备 write 的授权写入该事件，再用 afterEventId 读取；服务端校验完整契约。文件应来自实际交互，重试保留其中的 clientEventId、occurredAt 与内容。示例不自动生成学习经历。

`make smoke-context` 会以临时合成用户与单独子进程运行这个真实入口，验证写入与读取。合成 fixture 是验收数据，不是模型效果证明。
