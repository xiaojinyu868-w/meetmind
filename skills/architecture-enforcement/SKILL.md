# Architecture Enforcement

> 本 skill 定义 MeetMind 代码库的架构边界。每次变更前必须检查。

## 触发条件

- 创建新文件时
- 修改现有文件时
- 添加新依赖时
- 创建新 API 路由时

## 文件大小硬限制

| 类型 | 上限 | 当前超标文件 |
|------|------|-------------|
| 页面/组件 | 500 行 | `page.tsx`(9714), `AITutor.tsx`(~2100), `Recorder.tsx`(~1800) |
| API 路由 | 500 行 | `video/import/route.ts`(2074), `tutor/route.ts`(1778) |
| 服务文件 | 500 行 | `workspace-echo-service.ts`(1000), `classroom-data-service.ts`(946) |
| 工具/类型 | 300 行 | — |

**规则**：
- 新文件不得超过 500 行（组件/路由/服务）或 300 行（工具/类型）
- 如果修改使文件超标，必须先拆分再修改
- 超标文件有偿还计划（见下方「遗留债务」）

## 模块边界

```
src/
├── app/                    # Next.js 路由层（薄层，只做请求/响应转换）
│   ├── (main)/app/         # 主页面（待拆分的 God File）
│   └── api/                # API 路由（薄层，调用 services）
├── components/             # UI 组件（纯渲染 + 本地状态）
├── hooks/                  # 客户端 hooks
├── lib/
│   ├── services/           # 业务逻辑层（核心）
│   ├── utils/              # 纯工具函数（无副作用）
│   └── logger.ts           # 统一日志
├── stores/                 # Zustand 状态管理
└── types/                  # 共享类型定义
```

**依赖方向规则**（单向，不可反向）：
```
app/api → services → utils
app/pages → components → hooks → stores
components → types（共享类型）
services → types（共享类型）
```

**禁止**：
- services/ 不得 import components/
- components/ 不得直接 import services/（通过 hooks 或 props）
- utils/ 不得 import services/ 或 components/
- API 路由不得包含业务逻辑（必须委托给 services/）

## 域划分

MeetMind 的业务域：

| 域 | 服务文件 | 说明 |
|----|---------|------|
| **capture** | 无独立服务，逻辑在 page.tsx | 收集流（录音、链接、文件上传） |
| **echo** | commonstack-echo-service, workspace-echo-service | 回声生成与展示 |
| **import-pipeline** | video/import, article/import, bilibili, xiaoyuzhou | 多平台导入管线 |
| **tutor** | tutor-service, tutor/route | AI 私教 |
| **transcript** | qwen-asr-service, dashscope-asr-service, transcript-enhancer | ASR 转录 |
| **auth** | auth-service, wechat-auth-service, sms-service | 认证与微信 |
| **workspace** | workspace-service, workspace-context-service, workspace-search-service | 工作区管理 |

## 变更影响评估

修改任何文件前，回答：

1. **影响范围**：这个文件被谁 import？（用 grep 确认）
2. **类型安全**：改了接口/类型后，所有消费方是否自动报错？
3. **可回滚**：这次变更能用 `git revert` 安全撤销吗？

## 新依赖添加规则

添加 npm 包前必须满足：
- 有明确的使用场景（不是「以后可能用到」）
- 没有现有依赖能替代
- 包大小合理（用 bundlephobia.com 检查）
- 不是仅用一次的工具（考虑复制核心代码）

## 遗留债务偿还计划

以下文件是已知超标的遗留债务，不是新增的：

- `page.tsx` (9714行) — 最高优先级拆分目标，按域拆为 hooks + sub-components
- `video/import/route.ts` (2074行) — 按 stage 拆分（xiaoyuzhou/bilibili/ytdlp 各自独立）
- `tutor/route.ts` (1778行) — 拆分 intent handling / stream / context building
- `AITutor.tsx` (~2100行) — 拆分为 chat/input/history sub-components
- `Recorder.tsx` (~1800行) — 拆分为 recording/playback/upload sub-components

agent 在修改这些文件时**不要企图一次性拆分**，而是：
1. 先完成当前任务
2. 如果修改自然产生了可提取的模块（≥50行的独立函数/组件），就顺手提取
3. 每次提取后立即 `tsc --noEmit` 验证
