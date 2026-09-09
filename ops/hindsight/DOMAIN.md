# Hindsight 独立联调环境

本目录运行未修改的 Hindsight 0.9.2 官方完整镜像，使用其内置 pg0 PostgreSQL/pgvector；不承载 MeetMind 应用，不接入生产用户数据。记忆提取、实体处理、整理、检索和异步任务均由上游执行。

## 启动与连接

将 runtime.env.example 复制为仓库根 .env.hindsight.local，填写独立随机服务凭证和有效百炼凭证，然后使用 `make hindsight-up`。`make hindsight-status` 查看状态，`make hindsight-logs` 查看启动日志，`make hindsight-down` 停止服务并保留数据库卷。命令不会删除记忆数据。

Hindsight API 只映射宿主机 127.0.0.1:18888，数据库没有宿主端口；API 启用官方 API-key tenant extension。MeetMind 配置 CONTEXT_HINDSIGHT_URL=http://127.0.0.1:18888，CONTEXT_HINDSIGHT_API_KEY 填 HINDSIGHT_SERVICE_KEY。该服务凭证只给 MeetMind 服务端，外部应用使用 mmctx_ 授权凭证。

远程联调时在独立目录运行同一 compose，通过 `ssh -N -L 18888:127.0.0.1:18888 <host>` 建立本机连接。模型凭证留在运行 Hindsight 的服务器。不要把本目录部署到现有应用目录后直接替换其配置。

## 配置边界

- compose.yaml：固定版本、私有网络、持久化、认证、稳定 worker ID 与单机联调资源上限。
- runtime.env.example：部署方填写的秘密与端口，不是客户端配置。
- 当前可运行示例选择百炼 qwen-plus、text-embedding-v4（1024 维）、qwen3-rerank；这是部署选择，通用 Context 类型和应用接口不依赖这些模型。
- retain 输出上限 8192、模型并发 4；后台任务仍由 Hindsight worker 调度。模型额外请求参数关闭思考模式，避免兼容接口启动验证失败。
- 不能直接修改已有库的 embedding 模型或维度；这种变更需要按上游迁移流程重新索引。
- `down` 保留卷，备份与彻底销毁是部署方的独立操作。pg0 用于开发联调，生产应切换外置 PostgreSQL；本目录不宣称提供生产高可用、备份或扩容方案。

上游依据：[安装](https://hindsight.vectorize.io/developer/installation)、[配置](https://hindsight.vectorize.io/developer/configuration)、[0.9.2 源码](https://github.com/vectorize-io/hindsight/tree/v0.9.2)。单条真实联调结果记录在 `docs/plans/CONTEXT_M1_DELIVERY.md`；上游直连诊断脚本为 `tests/eval/context/continuous-journey.py`（应用名称只是合成文本标签，不证明 MeetMind 应用闭环）。不以容器启动成功替代记忆处理验收。
