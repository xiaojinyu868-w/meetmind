# Console Components

> 机构控制台的只读/轻交互组件。组件只负责展示资产、回放和平台能力，不直接调用服务层。

## 依赖规则

```
console components -> academic primitives + props
```

- 页面负责 fetch/API 交互，组件通过 props 接收数据。
- 不直接 import `lib/services/` 或 `app/api/`。
- 视觉遵守 academic primitives 和全局 token。

## 文件索引

| 文件 | 职责 |
|------|------|
| `replay-thread.tsx` | 机构端查看学生对话 replay，渲染文本、tool trace 和生成式 UI 摘要 |
| `service-action-atom-registry.tsx` | Agent-native 服务动作原子注册表展示：感知 / 判断 / 交互 / 行动 / 评测 |
