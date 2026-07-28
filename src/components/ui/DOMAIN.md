# UI Components — 原子/基础 UI 组件库

> `components/ui/` 包含与设计系统对齐的基础 UI 组件，是其他业务组件的构建块。

## 设计系统 v7（图书馆台灯 + 朱批红笔）

**核心理念**：双签名色 = 产品架构。墨松绿 (`pine`) 是 AI 沉淀，朱批红 (`vermilion`) 是学生此刻。
**铁律**：95% 中性色 + 双签名 < 8% 面积；投影必须存在但克制；AI 时刻可见但不打断。

所有组件使用 `tailwind.config.js` v7 token：
- 中性：`paper` / `paper-warm` / `card` / `ink` / `ink-secondary` / `ink-muted` / `divider`
- 双签名：`pine` / `pine-mist` / `pine-fog` · `vermilion` / `vermilion-mist` / `vermilion-fog`
- 投影：`shadow-soft` / `shadow-card` / `shadow-float` / `shadow-modal` / `shadow-ai-glow`
- 字体：`font-sans` (Inter) · `font-serif` (Instrument Serif italic) · `font-mono` (JetBrains Mono)

详见 `docs/DESIGN_SYSTEM.md`（设计系统 v7 文字真相源）+ `design-demo/v7/` 完整 showcase。

## 文件清单

| 文件 | 类别 | 用途 |
|------|------|------|
| `button.tsx` | v7 升级 | variant: `default` / `pine` / `vermilion` / `ghost` / `naked` / `link` / `danger` / `outline` / `secondary`，size 加 `xl`，含 `loading` |
| `card.tsx` | v7 升级 | variant: `default` / `soft` / `elevated` / `ai`，可 `hoverable`，新增 `CardEyebrow` |
| `badge.tsx` | v7 升级 | variant: `default` / `pine` / `vermilion` / `sand` / `mute` / `outline`，可 `dot=true` 加状态点 |
| `input.tsx` | v7 升级 | Focus 用墨绿 ring，error 用朱批红 |
| `skeleton.tsx` | v7 升级 | shimmer 横扫（不再 pulse 明灭），子组件 `Paragraph` / `Cite` / `AppCard` |
| **`cite.tsx`** | v7 新增 | **引用资产化**——`<Cite kind="ts" value="20:01" />` 朱批时间戳 / `kind="src"` 墨绿资料 |
| **`octo-avatar.tsx`** | v7 新增 | Octo 头像 wrapper · 8 mood × 6 size，呼吸光环 + `statusDot` |
| **`thinking-strip.tsx`** | v7 新增 | 三档等待形态：`TypingDots`（轻）/ `ThinkingStrip`（中）/ `BrewingStrip`（重·"酿"） |
| **`stream-text.tsx`** | v7 新增 | 流式输出包装器，字符 stagger 浮现 + 末尾 caret，支持增量字符动画 |
| `avatar.tsx` | radix | 通用头像 |
| `dialog.tsx` | radix | 模态框 |
| `dropdown-menu.tsx` | radix | 下拉菜单 |
| `popover.tsx` | radix | 浮层 |
| `progress.tsx` | radix | 进度条 |
| `scroll-area.tsx` | radix | 自定义滚动区 |
| `select.tsx` | radix | 选择器 |
| `separator.tsx` | radix | 分隔符 |
| `sheet.tsx` | radix | 侧抽屉 |
| `slider.tsx` | radix | 滑块 |
| `switch.tsx` | radix | 开关 |
| `tabs.tsx` | radix | Tab |
| `textarea.tsx` | base | 文本域 |
| `toggle.tsx` / `toggle-group.tsx` | radix | 切换 |
| `tooltip.tsx` | radix | Tooltip |
| `loading.tsx` | base | LoadingSpinner / LoadingOverlay / LoadingCard |
| `page-transition.tsx` | base | 路由切换动画 |
| `ripple-button.tsx` | base | 点击涟漪按钮 |

## 使用规则

- 业务组件应该从 `components/ui/` 组合，而不是直接写 Tailwind 样式
- 新增 ui 组件时，必须符合 v7 设计系统 token
- 组件 Props 类型定义在同文件，不单独抽 type 文件
- 优先用 v7 一等公民 class（`pine` / `vermilion` / `paper` / `surface-ai` / `cite-ts` / `cite-src`），不要再写 v6 别名（`mint` / `coral` / `canvas`）

## v7 模式速查

```tsx
// 引用 = 视觉资产
<Cite kind="ts" value="20:01" onActivate={jumpTo} />
<Cite kind="src" value="资料 3" />

// AI 在场卡片（自带 1px pine ring + 缓慢光带）
<Card variant="ai" className="p-6">…</Card>

// 流式输出
<StreamText text={liveBuffer} cursor={isStreaming} />

// 等待三档
<TypingDots />                                      {/* < 0.5s */}
<ThinkingStrip>Octo 正在对照…</ThinkingStrip>       {/* 1-2s */}
<BrewingStrip>这节课还在沉淀</BrewingStrip>          {/* 后台长任务 */}

// Octo 永驻
<OctoAvatar mood="listening" size="md" statusDot="vermilion" />

// 高亮笔
<mark className="mark-pine">不让中间路由器被淹</mark>
<mark className="mark-vermilion">不让接收方被噎着</mark>
```

## 暗色模式

通过 `<html data-theme="dark">` 切换。底色变深棕墨黑 `#14110D`，墨绿变浅松绿 `#6B9080`，朱批变暖橘红 `#E07A5F`。所有 token 自动重映射，组件无需任何改动。

## 关联

- 布局组件：`components/layout/`
- 业务组件：`components/business/`
- 设计系统 token：`tailwind.config.js` + `src/app/globals.css`
- 完整 showcase：`design-demo/v7/`（9 篇文档）
- 字体加载：`src/app/layout.tsx`（Inter / Instrument Serif / JetBrains Mono via next/font）
