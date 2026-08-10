# settings/ — 设置页组件（/settings）

> 2026-08 从 `src/app/(auth)/settings/page.tsx`（964 行 God File）拆出。
> page.tsx 只保留状态装配；本目录承载全部展示组件。

## 文件

```
settings/
├── primitives.tsx      # 行/卡原子：SettingSection(锚点 id+scroll-mt) / GroupLabel /
│                       # SettingGroup / GroupDivider / InputSettingRow / ToggleRow /
│                       # SelectRow / ActionLinkRow / ActionButtonRow / StaticRow
├── SettingsNav.tsx     # 桌面左侧锚点导航（md 以下隐藏）：IntersectionObserver
│                       # 跟踪当前 section，点击平滑滚动；active = pine 短竖线
├── AccountSection.tsx  # 「账户」：登录态身份 hero + 资料/安全卡；游客态登录卡
└── AboutYouSection.tsx # 「关于你」：学习档案 + 教练画像双卡（清除画像 confirm 内聚）
```

## 约定

- **字符串一律 `COPY.settings`**（`src/lib/ui/copy.ts`），primitives 只收 props 不写文案。
- 每个 `SettingSection` 带 `id` + `scroll-mt-24`，与 `SettingsNav` 的锚点一一对应；
  新增 section 时同步 page.tsx 的 `navItems`。
- 积分区块仍是 `components/points/PointsSettingsSection`，page 用 `<div id="points">`
  包一层提供锚点（组件未登录时自隐藏）。
- 依赖方向：`settings/* → lib/ui/copy + types + ui/avatar + next/link`，不引 services。
