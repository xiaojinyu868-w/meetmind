# Agent Rules — MeetMind

> 你是接手 MeetMind 的 AI 开发者。读完这份文件再动手。
> 详细规则在 `skills/` 目录中，本文件只给你最核心的上下文。

---

## 0. Golden Commands

```bash
make check    # 类型检查（每次改完必跑）
make build    # 生产构建
make deploy   # 构建 + PM2 重启
make stats    # 项目统计（超标文件、console.log 残留）
make help     # 所有可用命令
```

**只用这些命令。不要发明新脚本。**

---

## 1. 产品是什么

MeetMind 是以学习者长期上下文为中心的 AI 学习产品。

**一句话**：用户像发微信一样把学习现场发给 MeetMind，先收下，后台慢慢理解，理解成熟后自然长出回声、复习、Tutor。

**当前聚焦**：课堂场景。一个大学生录了一节课 → MeetMind 帮他听懂了这节课 → 生成一张让他忍不住分享到班级群的回声卡。

### Taste（任何改动都必须对齐）

| 关键词 | 含义 |
|--------|------|
| **安静** | 不通知、不弹窗、不催促 |
| **回来的比发出去的更好** | 发一节课录音，回来的是「AI 听懂了这节课」 |
| **不急** | 像发酵，时间到了自己起来 |
| **小** | 一个发现，三句话，不是长报告 |
| **有根** | 每句话都能指回真实原件 |

---

## 2. Skills（详细规则在这里）

| Skill | 路径 | 何时读 |
|-------|------|--------|
| **架构执行** | `skills/architecture-enforcement/SKILL.md` | 创建/修改文件时 |
| **变更流程** | `skills/making-changes/SKILL.md` | 每次写代码时 |
| **代码审查** | `skills/code-review/SKILL.md` | 完成变更后自审 |
| **系统化调试** | `skills/debugging/SKILL.md` | 遇到 bug 时 |

**工作流**：Plan → Execute → Verify → Commit（详见 `skills/making-changes/SKILL.md`）

---

## 3. 设计系统（快速参考）

**铁律：零渐变、零阴影、纯平涂。**

| Token | 色值 | 用途 |
|-------|------|------|
| `canvas` | `#F7F7F5` | 全局背景 |
| `card` | `#FFFFFF` | 卡片 |
| `ink` | `#232322` | 正文 |
| `ink-secondary` | `#787774` | 次要文字 |
| `ink-muted` | `#A3A39E` | 时间、标注 |
| `divider` | `#E9E9E7` | 分隔线 |

**禁止**：`bg-gradient-*`、`shadow-*`、`ring-*` 装饰、非系统 Tailwind 色、emoji 作 UI 元素。

---

## 4. 架构速查

```
src/
├── DOMAIN.md              # ← 源码总览，从这里开始
├── app/api/DOMAIN.md      # 45 个 API 路由索引
├── components/DOMAIN.md   # ~137 个 UI 组件索引
├── hooks/DOMAIN.md        # 23 个 hooks 索引
├── stores/DOMAIN.md       # Zustand 状态
├── types/DOMAIN.md        # 共享类型
└── lib/
    ├── DOMAIN.md          # 库代码总览
    ├── services/DOMAIN.md # 51 个业务服务（按域分组）
    ├── utils/DOMAIN.md    # 工具函数
    ├── db/DOMAIN.md       # IndexedDB Schema + CRUD
    ├── ai-native/DOMAIN.md # 应用插件系统
    ├── longcut/DOMAIN.md  # 转录算法
    ├── capture/DOMAIN.md  # 收集逻辑
    ├── context-reach/DOMAIN.md # 输入分流
    ├── config/DOMAIN.md   # 配置中心
    └── logger.ts          # 统一日志（不要用 console.log）
```

**读取顺序**：修改某个目录前，先读该目录的 `DOMAIN.md` 了解文件清单和依赖规则。

**依赖方向**：`api → services → utils`，不可反向。详见 `skills/architecture-enforcement/SKILL.md`。

---

## 5. 关键文件

| 文件 | 行数 | 注意 |
|------|------|------|
| `src/app/(main)/app/page.tsx` | 8437 | God File，用 `replace_in_file` 精确替换，改前先读 DOMAIN.md |
| `src/app/api/video/import/route.ts` | 1209 | 多平台导入管线，已拆分 3 个子模块 |
| `src/app/api/tutor/route.ts` | 708 | AI 私教路由，已拆分 4 个子模块 |
| `src/lib/services/commonstack-echo-service.ts` | 273 | Echo LLM 调用，System Prompt 在此 |
| `src/lib/services/workspace-echo-service.ts` | 1267 | Echo 数据管线 |
| `src/components/EchoCard.tsx` | ~180 | 回声卡，必须遵守设计系统 |

---

## 6. 技术栈

- Next.js 14 (App Router) + TypeScript 5.3
- Tailwind CSS 3.4（token 在 `tailwind.config.js`，CSS 变量在 `globals.css`）
- Prisma 7.2 + SQLite
- Dexie (IndexedDB) 客户端存储
- PM2 进程管理

---

## 7. 文档索引

| 文档 | 状态 |
|------|------|
| `docs/ECHO_PRODUCT_DEFINITION.md` | ✅ Echo 产品定义 source of truth |
| `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` | ⚠️ 产品定义准确，技术细节可能过时 |
| `项目开发文档/提示词设计哲学.md` | ✅ Less Structure, More Intelligence |
| `skills/*.md` | ✅ Agent 工作规范（架构/变更/审查/调试） |
