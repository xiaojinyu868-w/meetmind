# UI Components — 原子/基础 UI 组件库

> `components/ui/` 包含与设计系统对齐的基础 UI 组件，是其他业务组件的构建块。

## 设计系统约束

**铁律：零渐变、零阴影、纯平涂。**

所有组件必须使用 `tailwind.config.js` 中的设计 token：
- `canvas` / `card` / `ink` / `ink-secondary` / `ink-muted` / `divider`
- 禁止使用 `bg-gradient-*`、`shadow-*`、`ring-*` 装饰
- 禁止 emoji 作为 UI 元素

详见 `AGENTS.md` 第 3 节设计系统。

## 文件清单

```
src/components/ui/
├── Button.tsx
├── Input.tsx
├── Modal.tsx
├── Dropdown.tsx
├── Tooltip.tsx
├── Badge.tsx
├── Avatar.tsx
├── Card.tsx
├── Skeleton.tsx
├── Spinner.tsx
└── ...（待补充）
```

## 使用规则

- 业务组件应该从 `components/ui/` 组合，而不是直接写 Tailwind 样式
- 新增 ui 组件时，必须符合设计系统 token
- 组件 Props 类型定义在同文件，不单独抽 type 文件

## 关联

- 布局组件：`components/layout/`
- 业务组件：`components/business/`
- 设计系统 token：`tailwind.config.js` + `globals.css`
