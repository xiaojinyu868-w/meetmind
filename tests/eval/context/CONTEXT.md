# Context 上游诊断

`continuous-journey.py` 是不依赖 Node/npm 的 Hindsight + DashScope 上游诊断。它使用三段带应用标签的合成文本，直接调用 Hindsight 0.9.2 retain/operation/recall 和 DashScope，检查召回非空、模型回答完整（`finish_reason=stop`）以及删除后的召回为空。

该脚本不经过 MeetMind API、Context worker、用户身份授权、暂停/恢复/忘记控制或 Tutor 路由，因此不能证明跨 Application 的产品闭环，也不能作为效果评测或统计结论。真实链路验收使用 `tests/smoke/smoke-context-live.ts`。

运行前设置 `HINDSIGHT_SERVICE_KEY`、`HINDSIGHT_DASHSCOPE_API_KEY`，并确保 Hindsight 监听 `127.0.0.1:18888`：

```bash
make context-effect
```

输出包含 operation 完成数、召回记忆、使用同一任务结构的无 Context / 有 Context 回答和清理结果。任一阶段失败（包括清理或清理后非空召回）都会以非零退出码结束；失败记录保留待清理的 operation/document 标识，不能把未确认删除报告为通过。
