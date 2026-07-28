# 设计系统 v7（皮肤层 · 可换）

> 本文是 MeetMind **当前**视觉体系的文字快照，不是禁令。
> 它记录的是" Taste 原则（`docs/PRODUCT_TASTE.md`）在 v7 这一代的表达方式"——
> 色值、字体、组件形态、投影、动效全部属于可替换的实现细节：
> v6 被 v7 替换过，v7 也终将被 v8 替换。探索新方向时去 `design-demo/` 建新的
> showcase（v7 就是这么长出来的），新系统成型后这份文档整体翻页。
> 原则不变：双签名色所代表的语义（AI 沉淀 vs 学生此刻）是产品的一部分，
> 但**用什么色、什么字、什么形态去表达它，永远可以做得更好**。

**核心理念：晨雾学习台 + 朱批红笔。** "色 = 架构"——松石绿是 AI 沉淀（场景上下文），朱砂是学生此刻（个人上下文 / 引用 / 标注）。大面积界面保持明亮、低饱和；深色只用于文字与小面积强调，禁止用纯黑大面营造"科技感"。

## 双签名色（Tailwind class · CSS var）

| 角色 | 名称 | 色值 | Tailwind | CSS Var | 语义 |
|------|------|------|----------|---------|------|
| **主签名** | 松石绿 Pine | `#2F6B55` | `pine` / `pine-mist` / `pine-fog` | `--mm-pine` | AI / 沉淀 / 长期上下文 |
| **次签名** | 朱砂 Vermilion | `#C45E4C` | `vermilion` / `vermilion-mist` / `vermilion-fog` | `--mm-vermilion` | 此刻 / 引用 / 学生标注 |

## 中性色

| Token | 色值 | Tailwind | 用途 |
|-------|------|----------|------|
| `paper` | `#F6F8F6` | `bg-paper` | 主底色 · 明亮晨雾白（v7.1） |
| `paper-warm` | `#EDF2EE` | `bg-paper-warm` | hover / 次表面 |
| `card` | `#FFFFFF` | `bg-card` | 主卡片 |
| `ink` | `#20312A` | `text-ink` | 主文字；不再作为大面积按钮底色 |
| `ink-secondary` | `#53645C` | `text-ink-secondary` | 次文字 |
| `ink-muted` | `#819087` | `text-ink-muted` | 弱文字 / 标注 |
| `divider` | `#DCE5DF` | `border-divider` | 清透冷灰绿边线 |

## 字体三件套（已在 `app/layout.tsx` 通过 next/font 加载）

| 字体 | Tailwind | 用途 |
|------|---------|------|
| **Inter** | `font-sans`（默认） | 正文 · 'palt' 紧排让中英混排立刻 +30% 高级感 |
| **Instrument Serif** | `font-serif` 或 `.font-serif-italic` | 仪式字 · 标题里偶尔的 italic em |
| **JetBrains Mono** | `font-mono` 或 `.font-mono-cite` | 引用资产化 · `[MM:SS]` / `[资料 N]` 专用 |

## 投影系统（必须存在但克制）

| Tailwind | 强度 | 用途 |
|---------|------|------|
| `shadow-soft` | 0/4/16 · 0.04 | 日常卡片 |
| `shadow-card` | 0/8/28 · 0.06 | 主卡片（首选） |
| `shadow-float` | 0/16/48 · 0.08 | 悬浮元素 |
| `shadow-modal` | 0/32/80 · 0.12 | 模态 |
| `shadow-ai-glow` / `shadow-glow` | 1px pine ring + 8/28 pine | **AI 在场专属** |

## v7 工具类（globals.css 直接可用）

```html
<!-- 引用资产化 -->
<span class="cite-ts mono">[20:01]</span>     <!-- 朱批时间戳 -->
<span class="cite-src mono">[资料 3]</span>   <!-- 墨绿资料 -->

<!-- AI 在场卡片 -->
<div class="surface-ai">…</div>                <!-- 1px pine ring + 缓慢光带 -->

<!-- 高亮笔 -->
<mark class="mark-pine">不让中间路由器被淹</mark>
<mark class="mark-vermilion">不让接收方被噎着</mark>

<!-- 流式输出 -->
<p class="stream"><span style="animation-delay:.04s">字</span>…<span class="typing-caret"></span></p>

<!-- 思考气息流 / 录音呼吸点 / Octo 光环 -->
<div class="thinking-strip">Octo 正在对照你前面问过的内容…</div>
<span class="rec-dot"></span>
<div class="octo-aura"><img … /></div>

<!-- 骨架屏 -->
<div class="skel h-3 w-2/3"></div>
```

## v7 原生组件（`@/components/ui`）

| 组件 | 文件 | 用途 |
|------|------|------|
| `Button` (variant: `pine` / `vermilion` / `ghost` / `naked` / `link` / `danger`) | `button.tsx` | 升级版按钮，size 加 `xl` |
| `Card` (variant: `default` / `soft` / `elevated` / `ai`, hoverable) | `card.tsx` | 4 档投影 + AI 在场态 |
| `Badge` (variant: `pine` / `vermilion` / `sand` / `mute`, dot) | `badge.tsx` | 双签名色胶囊，dot 状态点 |
| `Skeleton` + `Skeleton.Paragraph` + `Skeleton.AppCard` | `skeleton.tsx` | shimmer 横扫，不再 pulse 明灭 |
| `Cite` (kind: `ts` / `src`) | `cite.tsx` | **引用资产化**——MeetMind"有根"DNA |
| `OctoAvatar` (mood: 8 态, size, statusDot) | `octo-avatar.tsx` | 头像 wrapper，呼吸光环 + 状态点 |
| `ThinkingStrip` / `TypingDots` / `BrewingStrip` | `thinking-strip.tsx` | 三档等待形态：轻 / 中 / 重（"酿"） |
| `StreamText` | `stream-text.tsx` | 流式输出包装器，stagger 浮现 + caret |
| `AppTopBar` | `app-topbar.tsx` | 应用顶部栏 |
| `EmptyState` | `empty-state.tsx` | 空态占位 |
| `SectionHeader` | `section-header.tsx` | 区块标题 |
| `CourseHero` | `course-hero.tsx` | 课程 Hero 区 |
| `SkillChip` | `skill-chip.tsx` | M14.6 动态能力 chip（取代 inline app 药丸，点击直接打开应用矩阵） |
| `Composer` | `composer.tsx` | 对话输入条 |
| `RecordingHero` | `recording-hero.tsx` | 录音 Hero 区 |

## 暗色模式 first-class

通过 `data-theme="dark"` 切换。底色 `#14110D`（深棕墨黑，温度比纯黑高），墨绿变浅松绿 `#6B9080`，朱批变暖橘红 `#E07A5F`——给凌晨学习的学生眼睛准备的版本。所有 token 自动重映射，组件无需任何改动。

## v6 → v7 兼容映射

旧 class 全部保留并自动映射到 v7 token：`bg-canvas` → 新米白、`text-ink` → 新墨黑、`bg-mint` / `bg-skyblue` 等都映射到 pine 体系，`bg-coral` 映射到 vermilion 体系。**新代码请直接用 v7 class（pine / vermilion / paper / surface-ai / cite-ts / cite-src）**，不要再用 v6 别名。
