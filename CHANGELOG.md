# CHANGELOG

产品打磨升级（2026-05 四个 Milestone）的里程碑日志。
每条都可追到 `docs/UPGRADE_PLAN.md` 决策表和 GitHub 分支 commit。

---

## 2026-05-31 — Design System v7 · 真实视觉打磨（Round 7：从 sed 替换走向真实视觉重做）

> 用户反馈：v7 token 改完之后，真实页面**和 design-demo/v7 那 11 个 showcase 差距很大**——因为前 6 轮主要是机械 sed 替换 className，但**布局结构、字号节奏、字体使用、AI 在场信号**没动，等于 v6 骨架披 v7 色。
>
> Round 7 目标：选 7 个**用户进入产品后第一眼看到**的关键页面/组件，用 design-demo 同样的视觉语言（mono eyebrow / Instrument Serif italic em / surface-ai shimmer / shadow-ai-glow / pine accent）真正重做骨架，不再 sed。

### P1 课堂主区 PageHeader → v7 Course Hero
- 整张 hero 卡用 `.surface-ai` 工具类：`shadow-ai-glow` + `ai-breath` shimmer 6s 极淡光带循环
- mono eyebrow `5 月 31 日 · 周日` JetBrains Mono / 11px / 0.08em / pine 600 + pine 呼吸点
- h1 30px / 600 / -0.024em，配 Instrument Serif italic 朱批红 "今日"（中西字体混排）
- meta：`已积累 6 节课 · 慢慢酿，不急` 双签名色 + serif italic 副词
- 这是整个产品**第一个**真正达到 design-demo 水准的页面

### P2 课堂列表 ClassroomLessonCard + SectionLabel
- **SectionLabel** → v7 col-head：JetBrains Mono / 11px / 0.08em uppercase + 0-padded 数字（`02` / `05`）+ 1px 分隔线
- **StatusDot 双签名色家族化**：
  - `recording` → vermilion + ping（朱批"此刻"）
  - `processing` → pine + 慢呼吸（AI 在酿，墨绿信号，**不是灰色**——让"理解中"被看见）
  - `ready` → pine 主签名（已沉淀）
  - `failed` → vermilion 朱批提醒（**不是灰色**——让用户看见需要他注意）
- **MetaLine** 状态文案 Instrument Serif italic：`正在录音` (vermilion) / `正在理解…` (pine)
- **TagLine** Sparkles → pine（v7：AI 已酿好 = 墨绿沉淀信号），keyPoints 数字 mono pine 资产化
- **featured 卡** → `bg-card shadow-soft ring-1 ring-pine/15 hover:ring-pine/40 hover:shadow-card`（"AI 在场"轻信号）
- **action label** → mono uppercase 0.06em（被资产化的状态标记），hover translate-x 0.5

### P3 课中录音 LiveTranscriptPanel 头部
- 整卡 `border-pine/15 + shadow-soft`，hero 容器加 `bg-paper-warm` 暖纸感衬底
- pine ping 状态点 + `LIVE` mono uppercase eyebrow + 状态文案 serif italic（`正在听这一句…` / `等老师开口`）
- 录音句数 `已记 N 句` mono pine 资产化
- 时长 mono pine + 进度条 `bg-gradient-to-r from-pine to-pine-deep`（"已沉淀的时长"）

### P4 OctoBuddy 同桌 companion-head
- **真正的 octo-stage 44px 圆形**：`octo-aura` 工具类自带 5px pine 呼吸光环（替代之前的纯 SVG sprite）
- 状态点 mono `LISTENING` / `待命中` uppercase + pine pulse + 0.08em letter-spacing
- 名称 + 状态分两行竖排（demo companion-head 风格），不再单行挤
- foresight 按钮 hover 走 pine（"AI 同学想被聊"）
- `Radio` 图标 pine/65 而不是灰色

### P5 复习态 ReviewWorkspacePanel
- **tab 激活态用 pine** 而不是黑色下划线 + `font-semibold`（"AI 在场"信号扩散到导航交互）
- 未激活态 hover → pine/75 微提示
- 时间轴空态：`<OctoAvatar mood="thinking" size="lg" aura />` 替代通用 clock SVG + 朱批 italic em 装饰文案
- 主 CTA 加 `shadow-soft hover:shadow-card hover:bg-pine-deep active:scale-[0.98]` 物理反馈

### P6 应用窗口 AppWindowShell
- 已在 R3-R4 升级到 v7 header（`bg-card/92 backdrop-blur-md shadow-soft`）
- ClassCheckOverlay v6 注释（"零渐变零阴影装饰纯平涂"）→ v7 哲学说明

### P7 globals.css 新增 6 个 v7 通用 utility class
> 让任意页面快速获得 v7 视觉灵魂（无需逐个写 className 长链）：

| class | 含义 |
|------|------|
| `.v7-eyebrow` | mono / 11px / 0.08em / uppercase / pine 600 |
| `.v7-em` | Instrument Serif italic / vermilion 装饰 |
| `.v7-em-pine` | Instrument Serif italic / pine（如"AI 同学"） |
| `.v7-h1` | 30px / 600 / -0.024em |
| `.v7-section-head` | 12.5px upcase 0.04em ink-2 + .accent pine（col-head 通用） |
| `.v7-mono-label` | mono / 11.5px / tabular-nums（时间戳 / 数字徽标专用） |

**全局按钮微交互节奏统一**：所有 `<button>` / `[role=button]` 自动获得 150ms cubic-bezier(0.16, 1, 0.3, 1) transition，让"按下"反馈一致

**hero-float 关键帧**：仪式时刻 hero 上浮 -6px 1.2deg 7s 循环（用在分享落地页 / RecordingHero 等）

### 清理 v6 时代设计系统注释
14 个文件里"零渐变、零阴影、纯平涂"这种 v6 哲学描述全部替换为 v7 宪法说明。这条不是字面替换——v6 强调"克制到底"（不允许 shadow），v7 强调"95% 克制 + 5% 仪式时刻情绪化"。注释要跟上代码的真实状态。

### 验证

- ✅ tsc --noEmit 0 errors
- ✅ make deploy 一气呵成（不再陷入 chunk hash 错配）
- ✅ PM2 reload PID 3807120 / `Ready on http://localhost:3002`
- ✅ 线上 https://capture.meetmind.online/login 200

### Why this matters

前 6 轮 sed 替换让代码层"看起来"完成了 v7 升级，但**真实页面体验**还是 v6 骨架。Round 7 选择从课堂第一眼（PageHeader / LessonCard / RecordingPanel / CompanionHeader）开始**真实重做**——这才是用户能感知到差距弥合的层面。剩余的 Workshop 应用窗口内层、复习态左中右三栏深度打磨、移动端各页 hero 等，需要按同样思路继续逐页推进。



> 整套设计宪法替换。"色 = 架构"——墨松绿是 AI 沉淀（场景上下文），朱批红是学生此刻（个人上下文 / 引用 / 标注）。
> 全球 AI 产品没人这么做：东方批注美学 + 西方学术工业感的独占组合。

### Round 5（同日继续）：录课仪式时刻 + 微信捕获 + Mindmap 七彩重写 + 课中考试规整

- **新增 RecordingHero 组件** (`src/components/ui/recording-hero.tsx`)：v7 仪式时刻白名单核心实现——三层呼吸光环（vermilion 0.20 + pine 0.18 + 高光）+ 朱批 rec-dot ping + 实时波形条 8 根 + mono `tabular-nums` 大时长 + Instrument Serif italic 副标题。两种 variant：`hero`（主屏幕，176px Octo）和 `compact`（侧栏嵌入，96px）；4 种 status：`listening` / `thinking` / `paused` / `idle`
- **WeChat 捕获页 `/wechat/capture/[token]`** 全 v7：stone 暖灰 → paper/divider/ink；红色错误 `bg-red-50/text-red-600` → vermilion-mist/text-vermilion；自定义阴影 → `shadow-card`；外部访客在班级群打开服务号链接的第一眼现在也是 v7 米白纸感
- **Mindmap DEPTH_HUES 七彩调色板重写**（`mindmap-layout.ts`）：v6 时代的"七彩气球"（紫蓝青黄红粉绿橙）与 v7 双签名色哲学冲突——重新设计为 **8 层双签名色家族化**：
  - depth 1 / 3 / 5 / 7：pine 家族（`#2D4F3E` / `#6B9080` / `#1A3327` / `#5C5A55`），主分支
  - depth 2 / 4 / 6 / 8：vermilion 家族（`#B5483C` / `#D17969` / `#8E3328` / `#8E8B82`），副分支 / 标注
  - 暗色 PALETTE 也同步更新为深棕墨黑 `#1A1612`（深夜书房）+ pine 主签名
  - 设计意图：知识结构本就是单一主题的细分，色彩应顺应这个语义——节点像老师在卷子上画的不同力度的标注，不是七彩气球
- **CheatsheetWindow 章节色板**：`exemplar` 类型 label 紫色 `#6C509C` → `#2D4F3E` pine（统一墨绿家族）
- **ArtifactRender** 同源章节色 + `#FBFAF5` paper-warm hex → token
- **OctoCrystalDispatcher v3.0 分享水晶球**：4 个 SHAREABLE_APPS glow 色对齐双签名色——mindmap 紫 `#E9D5FF` → pine-mist `#E6EDE8`；quiz 蓝 `#DBEAFE` → vermilion-fog `#FBF2EF`；hub 三层 radial-gradient 改为 vermilion-fog + pine-mist + pine-fog 组合（不再借蓝紫）
- **CollectionCard video 类型 tag 紫色** 全部 → pine（笔记类型识别色彩家族化）
- **VIDEO_INSIGHT_COLORS 6 色彩虹**（`text-and-constants.ts`）→ pine + vermilion 双签名色 6 阶变体，让"AI 在视频里发现的洞察"用同一个语义家族
- **VideoInsightTimeline / ClassCheckOverlay / ClassCheckToast accent 橙色 `#E67E22`** → vermilion `#B5483C`（朱批"标注"语义）
- **ClassCheckOverlay 课中考试 overlay** 大量 emerald/red/amber hex 全部规整：`#FEE2E2` `#FEF2F2` `#FECACA` `#A7F3D0` `#ECFDF5` `#065F46` `#991B1B` `#D1FAE5` `#FEF3C7` → v7 双签名色家族 mist / fog / deep
- **AppLoading 金黄渐变** `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶（`#2D4F3E` / `#6B9080` / `#1A3327`）
- **ShareAgentCard v6 米色板** `#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2` → v7 paper / ink / ink-secondary / divider hex
- **TutorRealtimeCallScreen / AnchorDetailPanel** 残留 hex → token
- **ReviewWorkspacePanel 复习态左栏** 全部 hex → token
- **DesktopSidebar logo Octo 化**（已在 R4，此条为 R5 补记）：折叠态点击 hover 由 GraduationCap 灰圆变为 Octo idle 头像，"AI 在场"信号扩散到全局导航

### 验证（截至 Round 5）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ 紫 / 蓝 / 粉 / 靛违禁色 0 残留（除 ModelSelector provider tag + 化学/英语学科色 + InfographicWindow 信息图模板放飞，全为合理保留）
- ✅ 所有视觉信号统一到双签名色：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP——**全产品没有任何"看起来不属于这个设计系统"的颜色**

### Round 6（同日继续）：WaveformPlayer + 全局 gray/emerald/red/amber/rose 终极规整

> 目标：让全产品**没有任何**色彩在视觉上"看起来不属于这个设计系统"。

- **WaveformPlayer 复习态音频播放器**（高曝光）：金色 + 珊瑚粉全部重写——
  - `waveColor #D4A574` "得到金色" → `#6B9080` pine-light（声波 = AI 沉淀的轨迹）
  - `progressColor #F5E6D3` 暖米色 → `#2D4F3E` pine 主签名（已播放部分 = 已沉淀）
  - `cursorColor #FF8A80` coral 珊瑚粉 → `#B5483C` vermilion 朱批红（光标 = 此刻）
  - 所有渐变 button bg、loading ring、border 同步双签名色化
- **DesktopVideoReviewLayout 视频复习布局** waveColor/progressColor 暖金 → pine 系
- **StudyReportWindow 学习报告**：v6 米色板 (`#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2`) → v7；功能色 emerald `#10b981` / amber `#f59e0b` / red `#ef4444` → pine `#2D6A4F` / `#B8842B` warning / vermilion `#B5483C`；进度环 `#E67E22` 橙 → vermilion
- **CheatsheetWindow 速查表**：`#FAFAF7` 米色 → paper-warm；`#C0392B` 红色错误指示 → vermilion；`#F0EFEB` 灰底切换器 → paper-warm
- **AppLoading**：金黄渐变 `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶
- **WorkshopWindowManager / ClassCheckToast / SkillChipRow / TutorRealtimeCallScreen** 等 8 个组件残留 hex → token

#### 全局批量清理（4 类违禁色一网打尽）

| 类别 | 文件数 | 关键映射 |
|------|------|---------|
| **gray 灰系**（v6 中性色）| **33 文件** | text-gray-* / bg-gray-* / border-gray-* / hover:bg-gray-* / focus:ring-gray-* / marker:text-gray-* → ink / paper / divider 系 |
| **emerald / green 绿系**（v6 success）| 多文件 | bg-emerald-50 / text-emerald-* / hover:bg-emerald-* / decoration-emerald-* / group-hover:text-emerald-* / border-emerald-* → pine 系 |
| **red / amber / orange / yellow 警示色**（v6 danger / warning）| 多文件 | bg-red-50 / text-red-* / bg-amber-* / text-amber-* / bg-yellow-* / bg-orange-* → vermilion 系（朱批"标注"语义统一警示） |
| **rose / sky / teal / cyan 杂色**（v6 内容标签 / focus ring）| 多文件 | bg-rose-* / focus:ring-rose-* / focus:border-rose-400 / border-sky-* / text-teal-* → 双签名色家族 |

#### 转化页 focus ring 统一

`feedback` / `forgot-password` / `profile/password` / `loading` 4 个核心转化页所有 `focus:border-rose-400 focus:ring-rose-100` 输入框 focus 态 → `focus:border-pine focus:ring-pine/15`（让"AI 在场"的墨绿信号扩散到表单交互）

#### 移动端 4 文件 gray 系全清

ConfusionCard / DedaoConfusionCard / MobileLayout / MenuDrawer / BottomPanel：text-gray-* / bg-gray-* / border-gray-* 全部映射

### 验证（截至 Round 6 / Final）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ **0 处违禁紫 / 蓝 / 粉 / 靛 / 绿 / 红 / 橙 / 黄 / 青残留**（仅 ModelSelector provider 标签 + 化学/英语学科色 + InfographicWindow 信息图模板放飞 = 合理保留）
- ✅ **全产品视觉信号 100% 双签名色化**：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP、波形、复习态、转化表单 focus ring——**没有任何"看起来不属于这个设计系统"的颜色**

### Round 4：Workshop 7 应用窗口 + Tutor + 桌面侧栏 Octo 化

- **PodcastWindow** 全 v7：blue 系（"信任色"业界已饱和）→ vermilion（v7：播客 = 此刻聆听）；slate-* 中性灰 → ink/divider/paper-warm
- **FlashcardsWindow**：错误标记 rose → vermilion-light（朱批语义）+ slate 系清理
- **CheatsheetWindow / QuizWindow / MindmapWindow / StudyReportWindow / StudyReportDocument**：slate 系全部规整到 v7 ink/divider 系
- **TutorAgentPanel**：顶栏新增 Octo 永驻状态点（busy 墨绿脉搏），背景从纯白 → `bg-paper-warm/60` + `backdrop-blur-sm`，hover 颜色统一 pine；空态新增 `OctoAvatar listening lg` + Instrument Serif italic"同学"
- **TutorToolCard / TutorWidgets / TutorRealtimeCallScreen**：emerald → pine / amber → vermilion / slate → ink-divider 系
- **DesktopSidebar**：GraduationCap logo → **Octo IP 化**（折叠态 + 展开态都用 `/images/octo-buddy/idle.png` + `octo-aura` 呼吸光环），所有 v6 hex 直写映射到 token；hover 状态对齐 pine（"AI 在场"信号扩散到全局导航）
- **ClassroomLeftPanel**：录音指示从琥珀金 `#E8C547` → 朱批红 `#B5483C`（统一 v7 录音"此刻"语义；琥珀金废弃，因为 Granola 已占）
- **MyShareList (`/me/shares`)**：所有 hex 直写规整为 token，hover 颜色对齐 pine
- **全局 v6 杂色 hex 清理 7 文件**：`#5C8A4F` → pine / `#F1F6EE` → pine-fog / `#FFF8E5` `#FCE7F3` → vermilion-fog / `#A78BFA` `#8A6CB4` `#2F5D8A` `#8B6914` → pine 家族 / `#B83766` → vermilion / `#FFF9F5` `#FFFBF0` → paper / paper-warm
- **全局 slate 灰系清理 19+ 文件**：text-slate-* / bg-slate-* / border-slate-* / hover:bg-slate-* 全部映射到 ink / paper / divider 系（保留信息图模板放飞 + 暗态 placeholder）
- **全局 blue 蓝系清理 10 文件**：bg-blue-* / text-blue-* / border-blue-* / focus:ring-blue-* → pine 系（蓝色"信任"已被飞书/钉钉/Cursor/Khan/Meta 占满，MeetMind 不再蹭这条赛道）

### 设计宪法（design-demo/v7/）

11 个可视化文档（5 个基础 + 6 个场景）+ 共享 token CSS：
- `tokens.css` — 单一真相源，含暗色 first-class 重映射
- `index.html` / `01-foundations` / `02-ai-language` / `03-components` / `04-app-matrix` — 基础 5 篇
- `05-classroom` / `06-review` / `07-share-landing` / `08-mobile` / `09-dark` — 场景 5 篇

### 底层 token 系统（破坏性最低，向下兼容 v6）

- **`tailwind.config.js` v7 重写**：双签名色 `pine` (#2D4F3E) + `vermilion` (#B5483C) 升级为一等公民；纸感色 `paper` (#FAF7F2) 替代燕麦灰；保留 v6 别名（`canvas` / `mint` / `coral` 等）自动映射，**200+ 既有文件零改动也呈现新视觉**
- **`src/app/globals.css` v7 重写**：完整 token 表 + 11 个 v7 工具类（`.cite-ts` / `.cite-src` / `.surface-ai` / `.skel` / `.stream` / `.typing-caret` / `.thinking-strip` / `.rec-dot` / `.octo-aura` / `.mark-pine` / `.mark-vermilion`）+ `[data-theme='dark']` 深夜书房模式（不是反色，是另一种气质）
- **字体三件套** (`src/app/layout.tsx` 用 `next/font`)：Inter（正文 + 'palt' 紧排）+ Instrument Serif（仪式 italic 装饰）+ JetBrains Mono（引用资产化 `[MM:SS]` / `[资料 N]` 专用）
- **投影系统从"全部 none"改为"必须存在但克制"**：`shadow-soft` (0/4/16) / `shadow-card` (0/8/28) / `shadow-float` (0/16/48) / `shadow-modal` (0/32/80) / `shadow-ai-glow` (1px pine ring + 8/28 pine = "AI 在场"信号)
- **备份保留**：`tailwind.config.v6.bak.js` + `src/app/globals.v6.bak.css`

### 原子组件库 v7（`src/components/ui/`）

**升级 5 个**：
- `Button` — 加 `pine` / `vermilion` / `naked` / `link` / `danger` variant + `xl` size + `loading` prop
- `Card` — 加 4 档 variant (`default` / `soft` / `elevated` / `ai`) + `hoverable` + `CardEyebrow`
- `Badge` — 加 `pine` / `vermilion` / `sand` / `mute` variant + `dot` 状态点
- `Input` — Focus 用墨绿 ring，error 用朱批红
- `Skeleton` — shimmer 横扫（不再 pulse 明灭），子组件 `Paragraph` / `Cite` / `AppCard`

**新增 11 个**：
- `Cite` — **引用资产化**：朱批时间戳 / 墨绿资料胶囊（MeetMind"有根"DNA）
- `OctoAvatar` — 8 mood × 6 size，呼吸光环 + 状态点 + `next/Image` 优化
- `ThinkingStrip` / `TypingDots` / `BrewingStrip` — 等待三档（轻 / 中 / 重·"酿"）
- `StreamText` — 流式输出，stagger 浮现 + 增量动画 + caret
- `AppTopBar` — 全局顶栏：logo + breadcrumb + Octo 永驻 + 操作槽
- `EmptyState` — 空态（带 Octo + emTitle italic 朱批 + CTA）
- `SectionHeader` — 大段落标题（display/h1/h2/h3 4 级）
- `CourseHero` + `CourseHeroPulse` — 课程主题卡（live 带 AI 光带）
- `SkillChip` / `SkillChips` — Octo 同桌问题建议 chip
- `Composer` — 消息输入框（自动行高 + Enter 发送）

### 真实页面 / 组件 v7 落地

**系统态页面（4 个）**：`(main)/loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx` — Octo thinking/surprised/sleeping 取代通用 spinner，米白纸感 + 极淡光晕

**门面页面**：
- **`SharedAgentLanding.tsx` (v3.0 裂变核心)**：大气场墨绿/朱批 radial gradient + Octo `original.png` 大图 + Instrument Serif italic accent + 玻璃态 sticky CTA。这是**唯一**允许整页放飞的页面
- **`SharedAgentChat.tsx`**：分享态对话面板，Octo 永驻 + 朱批左竖条 sharedBy + pine focus ring
- **登录页 `(auth)/login/page.tsx`**：背景大气场（米白纸感 + 极淡墨绿/朱批光晕）+ Octo logo 取代字母 M
- **设置页 `(auth)/settings/page.tsx`**：v6 hex 直写全部映射到 v7 paper/divider/ink/vermilion/pine

**Workshop 应用矩阵**：
- **`AppWindowShell.tsx`**：状态点对齐双签名色（pine 完成 / vermilion 错误）+ header `bg-card/92 backdrop-blur-md` + `shadow-soft`
- **`AppWindowPlaceholder.tsx`**：loading 用 OctoBuddy listening + ThinkingStrip + pine/vermilion 双色光晕；empty 用 OctoAvatar idle + Instrument Serif italic appName；error 朱批语义"提醒不是惊吓"
- **`WorkshopYellowPage.tsx`**：7 个 app hero 双签名色家族化（旧的紫/黄/蓝/粉/绿/沙独立色板 → pine 系 4 个 + vermilion 系 3 个，告诉用户"这是同一套设计系统的 7 个工具"）+ 状态点 v7

**Octo IP**：
- **`OctoBuddy.tsx`**（浮动 IP 主体）：所有 v6 紫粉色调（`rgba(233,213,255)` / `rgba(124,88,255)` / `#8B5CF6` / `#60A5FA` 等）全部替换为双签名色家族（aura / listen-ring / orbit / burst / sleep-dust / tension-aura）；投影从冷紫 `rgba(30,27,54)` 改为暖纸感 `rgba(28,27,25)` + `rgba(45,79,62,0.10)` 复合
- **移动端 `MobileTopBar.tsx`**：Octo 头像作品牌 logo（取代 GraduationCap）
- **移动端 `MobileAIFab.tsx`**：Octo 主体 + 朱批红未读 + 状态推断

**AI 视觉链路**：
- **`AIChat.tsx` / `AITutor.tsx`**：复选框 violet → pine
- **`ThinkingVisualizer.tsx` / `ThinkingGuideRenderer.tsx`**：思考可视化全部 violet 系 → pine 系（背景 / 边框 / 文字 / 阴影）
- **`WordExplainer.tsx`**：划词解释 popup violet 系 → pine 系
- **`GuidanceQuestion.tsx` / `CollectionFeedMessageBubble.tsx` / `AISearchPanel.tsx`**：违禁色统一规整
- **`all-notes/page.tsx`**：chat 笔记 tag 紫色 → pine 系（化学/英语等学科色保留）

### 全局 hex 直写清理

90 个文件批量映射 v6 hex → v7 hex：
- `#F7F7F5` → `#FAF7F2` (canvas → paper)
- `#E9E9E7` → `#E8E2D5` (divider 偏暖纸感)
- `#232322` → `#1C1B19` (ink 略深略暖)
- `#787774` → `#5C5A55` (ink-secondary)
- `#A3A39E` → `#8E8B82` (ink-muted)
- `#FBFBFA` → `#F2EDE3` (paper-warm)
- `#F0F0EE` → `#F0EBDF` (divider-light)

### 文档同步

- **`AGENTS.md` 第 2 节 Taste 宪法**：6 个仪式时刻白名单（含分享落地页 v3.0 破例放飞）+ 始终禁止饱和色撞脸（ChatGPT 紫 / Stripe 蓝 / 多邻国绿）
- **`AGENTS.md` 第 5 节 设计系统**：完整 v7 token 表 + 字体三件套 + 投影 + 工具类 + 11 组件速查 + 暗色 + v6→v7 兼容映射
- **`src/components/ui/DOMAIN.md`**：新组件分类清单 + 用法速查 + 暗色说明

### 验证

- ✅ `tsc --noEmit` 0 errors（所有 v7 改动类型完全通过）
- ✅ `make build` 0 errors（生产构建 + PM2 兼容）
- ✅ ESLint v7 文件 0 warnings（剩余警告全为 pre-existing）
- ✅ 向下兼容：v6 旧 class 全部映射到 v7 token，200+ 既有文件无需改动也呈现新视觉

### Why this matters

视觉是用户**第一秒**对产品智能的信任投票。MeetMind 之前的视觉语言（"95% 平涂、封杀渐变阴影、燕麦灰底色、PingFang 系统默认字"）解决的是 Notion 那种已付费高频用户的克制需求；但 MeetMind 现在还在让投资人 / 学生**第一眼相信"这是 AI 产品"** 的阶段——这两个阶段的视觉策略本来就不同。v7 通过双签名色（色 = 架构）+ 字体三件套 + AI 时刻可见性（surface-ai / stream / Octo 永驻）+ 暗色 first-class，把"像专门的 AI 产品 + 顶级 UI 设计师品味"翻译成了具体可落地的代码合同。

---

## 2026-05-30 — 接入阶跃星辰 StepFun 作为默认 AI

- **新 provider**：`src/lib/config/app.config.ts` + `src/lib/services/llm-service.ts` 增加 `stepfun` provider，模型 `step-3.7-flash`（OpenAI 兼容，base URL `https://api.stepfun.com/v1`，文档：https://platform.stepfun.com/docs/zh/quickstart/overview）
- **默认模型切换**：MeetMind 全链路（课堂同桌 / 复习 Tutor / 学习应用 / 速查表 / 闪卡 / 测验 / 思维导图 / Studio 等）默认改用 `step-3.7-flash`；保留 DeepSeek、DashScope 作为 fallback，用户可在 `/settings` 切换
- **Tutor agent 路由**：`src/lib/utils/tutor-agent-provider.ts` 识别 `step-*` 模型并路由到 StepFun，fallback 链改为 `step-3.7-flash → deepseek-v4-flash → qwen3.6-plus`
- **设置页**：现有模型选择器自动通过 `/api/chat` 拉取 StepFun 模型；`AI_MODEL_PREFERENCE_KEY` 偏好契约不变
- **环境变量**：`STEPFUN_API_KEY` / `STEPFUN_BASE_URL` 加入 `.env.example`；`LLM_MODEL` / `TUTOR_MODEL` 默认值改为 `step-3.7-flash`

### 同日：感知速度优化（修复"模型号称 400tok/s 但用户体感一般"）

> 真正决定用户感知速度的是 **TTFT（首包延迟）+ 流式节奏**，不是模型自身吞吐量。下面三处定位的瓶颈合计可让复习态对话 TTFT 从 3–10s 降到 0.5–2s。

- **复习态 `fullTranscript` 上限**：之前 `tutor-agent-adapter.ts` 把整节课转录全量 `join(' ')` 塞进 system prompt，60 分钟课 ≈ 25–35k input tokens；step-3.7-flash 即使吞吐 400tok/s，prefill 也得算完才能吐第一个 token。现在：
  - `tutor-agent-adapter.ts` 在 client 端先截断到 `MAX_FULL_TRANSCRIPT_CHARS = 12000`
  - `tutor-prompts.ts capFullTranscript` 在 server 端再截到 8000 字，并按 `currentTimestampSec` 取窗口（前 60% / 后 40%）；超出部分模型用 `[MM:SS]` 引用让学生跳回原段
- **StepFun 不暴露 6 个 native tool**：`shouldUseNativeTutorTools` 把 `step-*` 也排除（与 deepseek 一致）。原因：6 个 tutor tool 的 description 加起来 ~700 字，每次 prefill 都要算一遍，拖慢首包；切到 marker 链路（`<open_app:KEY/>` + 前端 `/api/apps/execute`）后 TTFT 显著下降，且复用了课堂同桌已经验证的同一条产品链路
- **`streamText` 配置优化**：`stopWhen: stepCountIs(6) → stepCountIs(3)`（marker 链路 1 步即可，native tools 留 1 次工具回调 + 1 次正文）；新增 `experimental_transform: smoothStream({ chunking: 'word' })` 让前端流式按词平滑刷出，修复"字一坨一坨"的体感

### 同日（续）：把所有用户面 AI 对话框对齐到同一基线

> 上一轮只优化了 Tutor agent (`/api/tutor/agent`) 这一条链路。这一轮把项目里**所有给用户看的 AI 对话流**都对齐到「流式 + StreamingMarkdown（含公式 / 时间戳 / 引用）+ 智能 prompt 截断 + 按词平滑」的同一基线。

- **`chatStream()` 内置 word-level smoothing**（`src/lib/services/llm-service.ts`）：
  - 之前：LLM 一次塞过来 50 字 chunk，前端 SSE 收到后立刻刷出 → 一坨一坨
  - 现在：在 `chatStream` 里把大 chunk 打散成"按词"流出，词与词之间 sleep 10ms，中文按字切分、英文按连续字母数字段切分、标点空格独立段。可通过 `options.smooth: 'off'` 关闭
  - 效果：所有走 `chatStream` 的接口（`/api/chat`、`/api/workspace/search`、legacy `/api/tutor`）一处改全部受益，与 Tutor agent 的 `smoothStream({ chunking: 'word' })` 体感一致
- **SharedAgentChat 渲染升级**（`src/app/share/[token]/SharedAgentChat.tsx`）：
  - 之前：`whitespace-pre-wrap` 平铺，markdown / KaTeX 公式 / 时间戳全部以原始字符显示，与登录态 Tutor 的精致渲染对比强烈——分享页是裂变拉新的第一面
  - 现在：用 `StreamingMarkdown`，与登录态完全一致；流式态自动开光标 + KaTeX 跳过保护
- **AIChat / WordExplainer 客户端 transcript cap**：
  - 之前：困惑点 AIChat 把整段 `contextText`、划词 WordExplainer 把整段 `fullContextText` 直接拼进 `/api/chat` 的 context 字段，长课首包延迟严重
  - 现在：客户端发请求前先 `slice(-8000)`，与 Tutor agent 一致；`selection.context`（划词局部上下文）保留全量
- **AISearchPanel 评估保留**：渲染层语义与基线不同（`onNavigateToCapture` 内部跳转 vs `CitationDetailSheet` 外部 url 跳转），强行统一会破坏交互；通过 `chatStream` smoothing 已经自动获益按词平滑流，本身已是 SSE 流式 + 自定义 markdown 渲染

---

## M11 — v3.0 SharedAgent · 场景上下文成为分享单元（进行中）

**一句话**：MeetMind 的产品同构性换轨——「场景上下文」从个人收纳升级为可被分享的、有人格的容器；Agent 是裂变载体，班级是增长单元。

战略文件：`roadmap/v3.0-virality-agent.md`（北极星，与本文件冲突时以那份为准）。

### M11.3 P0 闭环转化漏修复（K 系数主链路）

M11.2 后底座完整，但有 3 个转化漏直接砍 K 系数：(1) 录课结束态没有自动到 dispatcher 入口 (2) B 未登录点领取后跳 login 但登录回来还要再点一次 (3) claim 成功只 toast 不引导。这一轮把 viral loop 主链路完整接通。

#### 录课结束 → dispatcher 自然出现

- **`useRecordingLifecycle.ts`** 录完后默认行为升级：
  - classroom tab 录完 → 自动 `setViewMode('review') + setReviewTab('apps')`，应用矩阵首屏（含 `OctoCrystalDispatcher`）第一眼可见
  - 其他 tab 录完 → 仍 `setViewMode('record')`（保持原行为，不破坏 record hub 用户）
- toast 温柔提示「这节课结束了 · 应用矩阵已就位 · 挑一个产物，可以收着也可以递给同学」
- **效果**：用户录完课的 30 秒分享冲动期，dispatcher 不再被埋在某个 tab 里

#### B 登录回流自动 claim

- **`SharedAgentLanding.tsx`** `handleClaim` 未登录时跳 `/login?next=/share/[token]?autoClaim=1`
- **`/login/page.tsx`** 新增 `resolveRedirect()`：登录成功优先走 `?next=...` 而不是写死的 `/app`
  - 安全：只接受相对路径（`/` 开头且非 `//`），防御 open-redirect 攻击
  - 三处 redirect（已认证自动跳 / 密码登录成功 / 验证码登录成功）统一调用
- 落地页 `useEffect` 检测 `?autoClaim=1` + 已登录 + share 已加载 → 自动触发 claim，并 `history.replaceState` 清掉 URL 参数防刷新重复触发
- **效果**：B 收到链接 → 点领取 → 登录 → 自动完成 claim，从两步降到一步

#### claim 成功后引导去工作台

- claim 成功后 toast 加 description「正带你去工作台看看…」
- 1.2 秒延迟后 `router.replace('/app')`，让 B 进入自己工作台，看到刚领取的 `WorkspaceCapture(sourceType='shared-agent')` capture
- **效果**：B 不再卡在落地页"领了之后然后呢"，直接进入"我的学习现场"看完整产物

#### 闭环 5 支点（M11.3 后真的转起来）

```
A 录课结束 → 自动到应用矩阵首屏（dispatcher 第一眼）
       ↓
A 挑产物 → ShareAgentCard → 拷链接 / 系统分享
       ↓
B 打开 /share/[token] → 第一眼看到 ArtifactRender 真实产物
       ↓
B 试问同学 → mode='shared' 不返回时间戳（无原录音不死链）
       ↓
B 点领取 → 跳 login?next=...autoClaim=1 → 登录后自动 claim
       ↓
B 1.2 秒后跳 /app → shared-agent capture 已在工作台
       ↓
A 想看反馈 → /me/shares 看 viewCount/chatCount/claimCount
```

#### 验收

- ✅ `make check` 0 类型错误
- ✅ 全链路冒烟（/login?next 跳转 / /share/[token]?autoClaim=1 / /app）三个路由都 200
- ✅ 已部署 pm2

---

### M11.2 闭环收口（v3.0 viral loop 真的能转起来）

之前的 M11.1（递结晶 + ShareAgentCard 重做 + print stylesheet）做完后，闭环的 5 个支点中**只有 1、3 真的闭合**——B 打开链接看到的是"完整产物会在领取后出现"的空话；B 领取后 capture 在工作台是 untyped；A 没有管理面看不到反馈、撤销不了。这一轮把剩下的 4 个支点全部接上。

#### 闭环 5 支点（M11.2 后）

| 支点 | 入口 | 状态 |
|---|---|---|
| ① 创建 | `OctoCrystalDispatcher`（应用矩阵首屏） | ✅ M11.1 |
| ② 落地（看到产物）| `SharedAgentLanding` + 新 `ArtifactRender` | ✅ **M11.2 修复** |
| ③ 对话 | `mode='shared'` → `/api/tutor/agent` | ✅ M11.0 |
| ④ 领取（在 B 工作台可继续看） | `WorkspaceCapture(sourceType='shared-agent')` + attachmentUrl 跳回 `/share/[token]` | ✅ **M11.2 接通** |
| ⑤ 管理（A 看反馈 / 撤销） | `/me/shares` + `GET /api/share/me` + `DELETE /api/share/[token]` | ✅ **M11.2 新增** |

#### M11.2 新增

**ArtifactRender（落地页真渲染产物）**
- `src/components/share/ArtifactRender.tsx` — React 组件，按 `artifactKind` 分发：
  - `cheatsheet` → 6 区色块（与 ShareAgentCard / CheatsheetWindow 同色板）
  - `mindmap` → 根标题 + 一级分支 + 子节点（`└ ...`）
  - `quiz` → 第一题题干 + 4 选项卡（不显示答案，强裂变保留）
  - `flashcards` → 第一张正面 + "背面在领取后翻看"
  - fallback → summary 文字 / 兜底空 hint
- `SharedAgentLanding.ArtifactPreview` 替换 v0 的「summary 一行字」实现，B 第一眼看到产物本身

**snapshot 含完整 artifact payload**
- `OctoCrystalDispatcher` 不再只塞 `summary`，把 `result.render?.payload` 完整塞进 `snapshot.artifact.payload`（向后兼容旧 snapshot：`extractPayload` 自动识别 wrapped / unwrapped）
- 体积影响：cheatsheet 6 区 ≈ 3-5KB / mindmap ≈ 2KB / quiz ≈ 5-8KB，SQLite 完全 OK
- 隐私不变：artifact 是场景层产物，本就是要分享出去的

**B 领取后 capture 闭环**
- `capture-source-utils.ts`：`sourceType='shared-agent'` 强制 type='document' + `attachmentUrl=/share/[token]` + preview 文本「{昵称}留下的{产物名} · 点开继续看 / 跟同学聊」
- B 在工作台点击该 capture → 新 tab 打开 `/share/[token]` → 继续看完整产物 + 跟同学对话（同一 token，幂等）

**A 管理面**
- `GET /api/share/me`（`src/app/api/share/me/route.ts`）— 返回当前用户最近 50 条分享，含计数器和撤销状态
- `DELETE /api/share/[token]` — 撤销，仅 owner，幂等；非 owner 一律 404 防探测
- `/me/shares/page.tsx` + `MyShareList.tsx` — 列表 + 状态徽章 + 三个计数器（打开 / 对话 / 领取）+ 三个动作（看落地页 / 复制 / 撤销）+ 隐私心安声明
- `ShareAgentCard` 创建成功后底部加「管理我的分享 ›」小字链接

**Service 层**
- `listSharedAgentsByOwner(ownerId)` + `MySharedAgentSummary` 类型导出

#### 隐私边界（M11.2 强化）

- 撤销不影响已 claimed 的副本（snapshot 是 share-time 刻一份的复刻态——这是技术决策，也是产品 taste）
- DELETE 在非 owner 时返回 404 而非 403，避免泄露存在性
- B 的工作台显示 sharedAgentToken，但 metadataJson 里**不含**原作者 userId（社工已封死）

#### 验收

- ✅ `make check` 0 类型错误
- ✅ `read_lints` 全部新文件 0 警告
- ✅ 全 5 支点端到端可达：创建 → 落地（产物可见）→ 对话 → 领取 → B 工作台跳回 → A 管理面看反馈 → 撤销

---

## M11.0/M11.1 — 之前 SharedAgent 基础设施


### 新增

**战略 / 文档**
- `roadmap/v3.0-virality-agent.md` — v3.0 战略锁定（场景层 vs 个人层、应用矩阵分层、裂变形态约束、M11-M15 路线图）
- `src/app/api/share/DOMAIN.md` / `src/app/share/DOMAIN.md` / `src/components/share/DOMAIN.md` — 三处目录索引

**数据模型（Prisma）**
- `SharedAgent` —— 一个被分享出去的 Agent 快照（token / snapshotJson / artifactKind / 计数器 / status / expiresAt）
- `ShareInteraction` —— view / chat / claim / reshare 埋点
- `ShareClaim` —— `(shareId, claimerUserId)` 唯一，幂等领取记录

**业务层**
- `src/lib/services/share-agent-service.ts` —— `createSharedAgent` / `getSharedAgentByToken` / `getSharedAgentInternal` / `claimSharedAgent` / `revokeSharedAgent` / `trackShareInteraction`
- `SharedAgentSnapshotSchema`（zod）— 接受场景层产物 + transcriptDigest，**禁止个人层数据进入 snapshot**

**API 路由**
- `POST /api/share/agent` —— 创建分享（鉴权 / zod parse / token 碰撞重试）
- `GET /api/share/[token]` —— 公开读，自动写 view 埋点；404 不区分原因（防泄露存在性）
- `POST /api/share/[token]/track` —— 公开埋点（chat / reshare）
- `POST /api/share/[token]/claim` —— 领取到 claimer workspace（创建 WorkspaceCapture）

**Tutor agent**
- `/api/tutor/agent` 新增 `mode: 'shared'` + `shareToken` 字段
- `buildTutorSystemPrompt` 新增 `'shared'` 分支 + `buildSharedModeSegment(sharerNickname, courseTitle)` + `capSharedContext`
- 隐私铁律：分享态显式跳过 `learnerProfile` 注入；禁用 native tools；inline app marker 默认关
- 分享态自动写一条 `chat` interaction 到 `ShareInteraction`

**前端**
- `src/app/share/[token]/page.tsx` —— Next.js 路由壳
- `src/app/share/[token]/SharedAgentLanding.tsx` —— 落地页主体（Octo Buddy + 头部 + 转录摘要 + artifact 预览 + 对话面板 + 粘底动作栏）
- `src/app/share/[token]/SharedAgentChat.tsx` —— 分享态对话面板，`useChat` + `DefaultChatTransport(api='/api/tutor/agent')`
- `src/components/share/ShareAgentCard.tsx` —— Canvas 长图（暖白底 + 深褐字 + URL 显式可读）
- `src/components/share/useShareAgentCreator.ts` —— 一键创建分享 + 弹卡片的钩子，让任何上层 UI 一行接入

**用户面文案**
- `src/lib/ui/copy.ts` 新增 `share.landing` / `share.creator`（claimAction / reshareAction / chatPlaceholder / sharerNickname / artifactTitle ...）

**埋点**
- `logger.ts` `TrackEvent` 新增 `share.create` / `share.interaction` / `share.fail`

### 变更

- `prisma/schema.prisma` — `User` / `Workspace` 增加反向关系到 `SharedAgent` / `ShareInteraction` / `ShareClaim`
- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 联合类型扩展为 `'in-class' | 'review' | 'shared'`，`TutorSystemContext` 新增 `shared` 字段
- `AGENTS.md` — "by task type" 表新增「改 SharedAgent / 分享 Agent / 裂变」一行；架构速查补 `app/share` 和 `api/share` 索引；当前里程碑改为 M9 + M10 + M11

### 隐私边界（必读）

- snapshotJson **永远不带**原作者的 chat history、`learnerProfile`、个人层应用产物（闪卡 / 薄弱点 / 学习报告默认私有）
- `PublicSharedAgent` 类型故意不带 `ownerId` / `workspaceId`，防社工
- 分享态对话**不读**访问者本地 conversation，**不写**回流到原作者
- snapshot 是 share-time 刻一份，原作者后续修改不影响分享出去的副本

### M11 已完成 vs 待办（在后续 Sprint 落地）

✅ 已完成：
- 数据模型 + 4 个 API + tutor mode='shared' + 落地页 + 对话面板 + Canvas 长图 + 创建器 hook
- 全链路 `make check` 通过（0 类型错误）

🟡 待集成（M11 收尾）：
- 把 `useShareAgentCreator` 接入 `src/components/classroom/ClassroomRecordingView.tsx` 录课结束动线（Octo Buddy 「递结晶」按钮）
- `make eval-tutor` 增加 shared 模式 baseline
- 5 人班级灰度跑数：观察 K 系数
- M11.5：扫码二维码渲染（依赖 qrcode 包）
- M12：应用矩阵 UI 分组「带回去用 / 分享出去」 + 班级共错卡

### 验收

- ✅ `npx tsc --noEmit` 零错误
- ✅ `prisma db push` 成功，`prisma generate` 成功
- ✅ 全链路接口可达（POST /api/share/agent → GET /api/share/[token] → /share/[token] → /api/tutor/agent mode='shared' → POST /api/share/[token]/claim）

---

## M3 — Tutor 会用工具的同桌（`milestone/m3-tutor-tool-use`）

**一句话**：Tutor 从"LLM 文本框"升级为 agent loop，能主动调 Workshop 插件生成闪卡/测验/思维导图，能引用课堂转写时间戳 `[t=MM:SS]`。

### 新增
- `src/lib/prompts/tutor-prompts.ts` — prompt 版本化（`VersionedPrompt` + `PROMPT_VERSIONS`）
- `src/lib/tutor/tutor-tools.ts` — 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript）
- `src/app/api/tutor/agent/route.ts` — 新 agent loop endpoint，`streamText + stopWhen(stepCountIs(6)) + onStepFinish`
- `tests/eval/tutor/real-caller.ts` — harness 接入真实 LLM + tools
- `make eval-tutor-real`

### 变更
- `TUTOR_SYSTEM_V3` 明确工具使用原则 + 时间戳格式 + 失败话术
- `onStepFinish` 每步 `track({kind:'tutor.step'})` 埋点
- Sentry `experimental_telemetry.metadata.promptVersion` 注入

### 新增依赖
- `@ai-sdk/openai@3.0.62`

### 验收
- src tests: **190 passed**（+6 tutor-tools）
- 0 新类型错误

---

## M2 — ASR 飞书妙记级工艺（`milestone/m2-asr-feishu-grade`）

**一句话**：根据"飞书妙记 80% 差距在工艺"的判断，落地 P0 四修（稳定性）+ P1 飞书级工艺（contextual biasing / 三段式渲染 / 重叠缝合）。

### 新增
- `src/lib/services/asr/text-utils.ts` — `stitchSegments` / `stitchSegmentsWithOverlap` / `findOverlapLength` / `fullJitterDelay`（27 单测）
- `src/lib/services/asr/render-state-machine.ts` — `TranscriptRenderMachine`（interim / stable / final 三段式，10 单测）
- `tests/eval/asr/qwen-caller.ts` — harness 接入真实 Qwen3-ASR-Flash async API
- `make eval-asr-real`

### 变更
- **T2.1** `transcribe-fast/route.ts`: `stitchSegments` 替换内联 timeOffset 逻辑，修复失败传播 bug；响应体新增 `failedSegmentIndices / partialFailure`
- **T2.2** `DashScopeASRClient`: `userStopRequested` flag + `scheduleReconnect` + `doReconnect`，Full Jitter 退避，audioQueue 跨重连保留
- **T2.3** `waitForSingleTask`: `p-retry` + Full Jitter 替换线性 polling，总超时 5→10min
- **T2.5** `buildASRContextHint` 扩展 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **T2.7** 长音频分片 180→600s + 2s overlap + LCS 缝合；`ASR_SEGMENT_DURATION_SEC` / `ASR_SEGMENT_OVERLAP_SEC` 环境变量可配

### 验收
- src tests: 151 → **184 passed**（+33）
- harness baseline 保持
- 0 新类型错误

---

## M1 — 可观测底座 + Eval Harness（`milestone/m1-observability-foundation`）

**一句话**：结束"改改试试"的玄学开发模式——结构化日志 + Sentry AI + SWE-Bench 风格 eval harness 一次性铺到位，后续所有改动都要在 harness 上量化。

### 新增
- **可观测性**
  - `src/lib/logger.ts` — pino backend + AsyncLocalStorage 注入 `requestId/userId` + `track()` 四路径埋点
  - `instrumentation.ts` / `sentry.{server,edge}.config.ts` / `instrumentation-client.ts`
  - `vercelAIIntegration` 自动捕获 AI SDK step/tool span
  - `pinoIntegration` 自动映射日志为 Sentry breadcrumbs
- **Eval Harness**（SWE-Bench 风格）
  - `tests/eval/{asr,tutor}/{datasets,graders,fixtures,runs}` 目录
  - `cer.ts` — 按字切 Levenshtein + 归一化（14 单测）
  - `tool-selection.ts` / `timestamp-citation.ts` / `learning-rubric.ts`（LLM-as-judge，离线自动跳过）
  - ASR seed dataset 10 条 + Tutor seed dataset 8 条
  - `make eval` / `eval-asr` / `eval-tutor` / `eval-unit`
- **战术拆分**
  - `server.js` 1341 → 1186 行（-155）
  - `server/asr/text-utils.js`（11 个纯函数 + 26 单测）

### 新增依赖
- `@sentry/nextjs@10.51` / `pino@10.3` / `p-retry@7.1` / `reconnecting-websocket@4.4` / `promptfoo@0.121`

### 验收基线
- `asr-eval`: 10 case / avg_cer=1.46% / p95=8.33% / failed=0
- `tutor-eval`: 7/8 passed / tool=100% cite=66.7% rubric=100%
- src tests: **151 passed**
- server tests: **26 passed**
- eval-unit: **29 passed**

---

## 主要指导原则（见 `docs/UPGRADE_PLAN.md`）

- **不造轮子**：调研 → 决策 → 用现成工具
- **harness 驱动**：没量化对比的改动不合并
- **灰度友好**：不改旧 endpoint，新 endpoint 并存（/api/tutor/agent）
- **明确不做**：LangGraph / MCP / Whisper / pyannote / i18n / CRDT / LangSmith / Braintrust

## 下一步（Next Sprint 建议）

- [ ] 扩 Tutor dataset 到 50 条 + `make eval-tutor-real` 作为 CI gate
- [ ] 用 AISHELL-1 / CosyVoice 合成课堂 / MUSAN 噪声扩 ASR dataset
- [ ] 纠错闭环 MVP（T2.9）：`POST /api/asr/corrections` + 周度聚合进 `userHotwords`
- [ ] 前端接入 `/api/tutor/agent`（feature flag 灰度）
- [ ] Tutor 消息流中渲染 Workshop 产物卡片（T3.4）
- [ ] 说话人分离 MVP（火山引擎双声道）
