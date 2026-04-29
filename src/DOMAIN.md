# src/ — 源码根目录

> 这是 MeetMind 的全部源码。阅读顺序：先看这个文件了解全貌，再按需进入子目录的 DOMAIN.md。
> 仓库产品线边界先看根目录 `REPO_MAP.md`。

## 两条产品线 + 共享底座

| Track | 主要路径 | 说明 |
|------|----------|------|
| 原 MeetMind 学习产品 | `app/(meetmind-learning)`, `app/api/(meetmind-learning)`, `components/recorder`, `components/tutor`, `lib/db`, `lib/services/workspace-*` | 个人学习、收集、课堂 Echo、Tutor、AI 工坊 |
| Agent Native Infra | `app/(agent-native-infra)`, `app/api/(agent-native-infra)`, `components/consult`, `components/console`, `lib/consult`, `lib/academic` | B 端机构数字员工、tool atoms、skills、artifacts、trace、eval |
| 共享底座 | `app/(auth)`, `app/(shared)`, `app/api/(shared-substrate)`, `lib/services/llm-service.ts`, `web-search-service.ts`, `qwen-asr-service.ts`, `hooks/useOmniRealtimeCall.ts`, `components/ui`, `lib/config`, `lib/utils` | 两条产品线可复用，但不能写入具体业务假设 |

边界原则：原学习产品不要依赖 `lib/consult` / `lib/academic`；共享底座不要引用具体 consult skill 或 academic scenario。

## 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── (meetmind-learning)/ # 原 MeetMind 学习产品页面组
│   ├── (agent-native-infra)/# Agent Native Infra 页面组
│   ├── (shared)/           # 帮助、反馈等共享页面组
│   ├── (auth)/             # 认证页面组
│   └── api/                # API 路由 → 见 app/api/DOMAIN.md
├── components/             # ~137 个 UI 组件 → 见 components/DOMAIN.md
├── hooks/                  # 24 个客户端 hooks → 见 hooks/DOMAIN.md
├── stores/                 # Zustand 状态管理（7 文件，~89 状态） → 见 stores/DOMAIN.md
├── types/                  # 共享类型定义（5 文件） → 见 types/DOMAIN.md
└── lib/                    # 库代码
    ├── services/           # 51 个业务服务 → 见 services/DOMAIN.md
    ├── consult/            # Agent tool atom / UI tool / arena / action routing
    ├── academic/           # Education Service OS 多租户服务域
    ├── utils/              # 纯工具函数 → 见 utils/DOMAIN.md
    ├── db/                 # IndexedDB (Dexie) → 见 db/DOMAIN.md
    ├── ai-native/          # 应用插件系统 → 见 ai-native/DOMAIN.md
    ├── longcut/            # 转录算法 → 见 longcut/DOMAIN.md
    ├── capture/            # 收集逻辑 → 见 capture/DOMAIN.md
    ├── context-reach/      # 输入分流 → 见 context-reach/DOMAIN.md
    ├── config/             # 配置中心 → 见 config/DOMAIN.md
    ├── logger.ts           # 统一日志（用这个，不用 console.log）
    └── server-failover.ts  # 服务端 failover 工具
```

## 依赖方向（铁律）

```
app/api/ → lib/services/ → lib/utils/, lib/db/, lib/config/
                ↑ 不可反向
components/ → hooks/ → stores/ → types/
                        ↑ 不可反向
```

- API 路由是薄壳，业务逻辑在 services
- 组件不 import services（services 是服务端）
- types/ 是纯类型，任何模块都可以 import

## 技术栈

- **框架**: Next.js 14 (App Router) + TypeScript 5.3
- **样式**: Tailwind CSS 3.4（token 在 `tailwind.config.js`）
- **服务端 DB**: Prisma 7.2 + SQLite（schema 在 `prisma/`）
- **客户端 DB**: Dexie.js (IndexedDB)
- **状态管理**: Zustand
- **部署**: PM2 (`ecosystem.config.js`)

## 核心数据流

```
用户录音/输入链接/拖文件
  → context-reach 识别类型
  → page.tsx 路由到对应 handler
  → 调用 API route
  → services 处理业务逻辑
  → 返回结果到前端
  → IndexedDB 持久化
  → 触发 Echo 回响生成
```
