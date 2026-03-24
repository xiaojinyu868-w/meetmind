# Agent Rules — MeetMind

> 你是接手 MeetMind 的 AI 开发者。读完这份文件再动手。

---

## 1. 产品是什么

MeetMind 是一个以学习者长期上下文为中心的 AI 学习产品。

**一句话**：用户像发微信一样把学习现场发给 MeetMind，MeetMind 先收下，后台慢慢理解，理解成熟后自然长出回声、复习、Tutor。

**哲学**：先收，再懂，再教。

**当前聚焦**：课堂场景。一个大学生录了一节课 → MeetMind 帮他听懂了这节课 → 生成一张让他忍不住分享到班级群的回声卡。

### 产品 Taste（必须对齐）

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件 |

### 产品不是什么

- 不是录音转写工具
- 不是 AI 教育工具外壳
- 不是功能工作台
- 不是前台满是 AI 解释和提示的产品

### 判断标准

任何改动都先问：

1. 这个改动是不是让用户更容易收集？
2. 是不是更原件优先？
3. 是不是更少打扰？
4. 是不是更像「发消息」而不是「用功能」？
5. 是不是对齐 taste（安静、小、有根）？

---

## 2. 设计系统

项目使用 **Notion 式秩序白皮书**设计系统。铁律：**零渐变、零阴影、纯平涂**。

### 色彩 Token

| 角色 | Token | 色值 | 用途 |
|------|-------|------|------|
| 底色 | `canvas` | `#F7F7F5` | 全局背景 |
| 卡片 | `card` | `#FFFFFF` | 卡片、面板 |
| 交互 | `hover` | `#EFEFEF` | hover 态 |
| 主色 | `ink` | `#232322` | 正文、标题 |
| 辅助 | `ink-secondary` | `#787774` | 次要文字 |
| 弱化 | `ink-muted` | `#A3A39E` | 时间、标注 |
| 边线 | `divider` | `#E9E9E7` | 分隔线、边框 |
| 淡边线 | `divider-light` | `#F0F0EE` | 更轻的分隔 |

### 功能色块

| Token | 色值 | 用途 |
|-------|------|------|
| `sand` | `#FDF3C0` | 时间轴问答 |
| `mint` | `#D1F4E0` | 微信/资料 |
| `dustyblue` | `#D3E4F4` | 多源解析 |
| `rose` | `#FADEC9` | AI 私教 |

### 设计禁令

- **禁止** `bg-gradient-*`、`linear-gradient()`——不用渐变
- **禁止** `shadow-*`——不用阴影（tailwind.config.js 已全部设为 none）
- **禁止** `ring-*` 作为装饰描边——用 `border-[#E9E9E7]` 代替
- **禁止** 使用 `stone-*`、`amber-*`、`slate-*` 等非系统 Tailwind 色——只用上表中的设计 token
- **禁止** emoji 作为 UI 元素（💡、🔑、📍 等）——只用 SVG 或纯文字

### 回声卡设计原则

回声卡是系统设计语言的一部分，不是例外：

- 只用系统 token（ink / ink-secondary / ink-muted / divider）
- echo 正文是唯一主角，其他都是注脚
- 用留白和排版节奏区分于普通内容，不靠装饰
- 金句用 `border-l` 划线 + 斜体，不用背景色块
- 来源用下划线文字链接（脚注），不用药丸标签

---

## 3. 代码约定

### 文本编码

- 所有源文件 `UTF-8`，不允许乱码
- 所有用户可见中文必须是可读简体中文
- 禁止提交 `锟斤拷`、`馃`、`鈥`、`銆` 等乱码字符
- 修改 UI 文案后必须在浏览器验证渲染

### 核心文件

| 文件 | 职责 | 注意 |
|------|------|------|
| `src/app/(main)/app/page.tsx` | 收集主页面 | ~9700 行，**极度谨慎修改**，任何改动可能影响大量分支逻辑 |
| `src/lib/services/commonstack-echo-service.ts` | Echo LLM 调用 | System Prompt 在此，修改需对齐 taste |
| `src/lib/services/workspace-echo-service.ts` | Echo 工作区逻辑 | 数据管线：normalize → metadata → toEchoSummary |
| `src/components/EchoCard.tsx` | 回声卡组件 | 必须遵守设计系统，不加装饰 |
| `src/components/EchoShareCard.tsx` | 分享图 Canvas | 书籍封面排版风格 |

### 技术栈

- Next.js 14 (App Router) + TypeScript 5.3
- Tailwind CSS 3.4（设计 token 在 `tailwind.config.js`，CSS 变量在 `globals.css`）
- Prisma 7.2 + SQLite
- Dexie (IndexedDB) 客户端存储
- PM2 进程管理
- 生产构建：`NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build`

### 提交前检查

1. `npx tsc --noEmit` — 零类型错误
2. `npx next build` — 生产构建成功
3. 如修改了 UI 文案，扫描乱码字符
4. 如修改了 EchoCard / EchoShareCard，确认遵守设计系统（零渐变、零阴影、系统 token）

---

## 4. 工作守则

### 优先级

1. 主链路闭环 > 视觉打磨
2. 课堂场景 > 全场景
3. 收集体验 > AI 展示
4. 少打扰 > 多功能

### 不要做

- 不要加前台大 AI 洞察展示
- 不要加复杂画像面板
- 不要堆新的一级页面
- 不要为了「像 AI 产品」而增加前台打扰
- 不要把低杠杆 UI 修改包装成高价值推进

### page.tsx 改动规则

`page.tsx` 是 ~9700 行的核心文件。改动规则：

- 用 `replace_in_file` 精确替换，**绝不整文件重写**
- 改动前先用 `read_file` 确认上下文（前后 20 行）
- 改动后立即 `tsc --noEmit` 验证
- 一次只改一个功能点，不要连锁修改

---

## 5. 文档索引

| 文档 | 内容 | 状态 |
|------|------|------|
| `docs/ECHO_PRODUCT_DEFINITION.md` | Echo 产品定义、taste、三层价值、增长引擎 | ✅ 当前 source of truth |
| `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` | Capture V1 产品定义、收集原则、微信角色 | ⚠️ 产品定义部分仍准确，技术细节可能过时 |
| `项目开发文档/提示词设计哲学.md` | Less Structure, More Intelligence 提示词原则 | ✅ 设计哲学仍适用 |
| `roadmap/多模态Agent技术架构路线2026-2030.md` | 五年技术路线 | 📋 参考性文档，非当前执行计划 |
