# 上游 Context 诊断域

本目录只承载可在服务器上运行的标准库 Python 诊断，不属于 MeetMind 运行时或 Context 服务。脚本可以直接访问独立 Hindsight 与 DashScope，数据必须是随机 bank 的合成内容。

- `continuous-journey.py`：retain/operation/recall、同任务有无历史对照、完整回答与删除后空召回检查。
- `CONTEXT.md`：运行方式与证据边界。

脚本不得读取真实用户数据、打印凭证或把上游直连结果表述为应用闭环。任何投递、模型完成、删除或删除后验证失败都必须非零退出，并留下可重试的清理标识。
