# Consult Agent Tools

> To B consult agent 的工具注册和 UI tool schema。这里定义的是平台能力边界，前端只按 tool name 渲染。

## 依赖规则

```
consult tools -> services + utils
```

- `tools.ts` 可以 import `ui-tools.ts` 和服务层。
- `ui-tools.ts` 只定义 AI SDK tool schema，不 import 组件。
- `ui-action-routing.ts` 是纯函数层，把前端 UI action 结果转成 agent prompt 路由提示，可单测。
- 新增 tool 时同步更新学生端渲染、console replay、scenario skill 文档和 smoke case。

## 文件索引

| 文件 | 职责 |
|------|------|
| `tools.ts` | 组装最终 `makeConsultTools`，包含 useSkill / readProfile / writeProfile / webSearch / searchProgramRequirements |
| `ui-tools.ts` | 无 execute 的生成式 UI tool：askOptions / showConsultantMove / showServicePlan / showOutreachWorkspace / showDraft / fileUpload / startVoiceCall / ctaWechat |
| `advisor-discovery-tool.ts` | `showAdvisorDiscovery` 的 AI SDK tool schema，用于导师/方向探索而非套磁 workflow |
| `service-action-atoms.ts` | Agent-native 服务动作原子注册表：感知 / 判断 / 交互 / 行动 / 评测 |
| `service-action-atoms.test.ts` | 服务动作原子注册表单元测试，确保五类原子覆盖和 live tool 覆盖 |
| `arena.ts` | Agent Arena 纯评测器：从 UIMessage/tool trace/profile 判断 flagship case 是否达标 |
| `ux-replay.ts` | Agent UX Replay 纯评测器：从语义化体验轨迹判断等待、重复、内部噪音和信息负荷 |
| `ux-replay.test.ts` | 用背景-only 咨询 replay 固化 HCI 回归标准 |
| `ui-action-routing.ts` | 从 UIMessages 提取最近 UI 动作和所在 artifact 状态，并生成闭环路由提示 |
| `ui-action-routing.test.ts` | UI action 路由纯函数单元测试 |
