# Workspace API Routes — 工作空间接口

> Workspace 是用户学习数据的聚合层，包含 captures（收集）、echoes（回响）、search（检索）。

## 依赖规则

```
workspace route.ts → lib/services/workspace-*-service.ts + lib/services/auth-service.ts
workspace route.ts ❌ 不能调用 api/ 下其他 routes
```

## 路由清单

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/workspace/current` | GET | 获取当前用户的工作空间元信息 |
| `/api/workspace/local-migration` | POST | 把本地 IndexedDB 学习历史归属到当前账号工作区 |
| `/api/workspace/captures` | GET | 分页获取 captures 列表（支持 filter） |
| `/api/workspace/captures/stats` | GET | 获取 captures 统计（总数/时长/类型分布） |
| `/api/workspace/search` | POST | AI 语义检索（SSE 流式返回） |
| `/api/workspace/echoes/daily-refresh` | POST | 触发每日回响新鲜度刷新 |

## 文件清单

```
src/app/api/workspace/
├── current/route.ts              # 45行
├── local-migration/route.ts      # 本地学习历史 → Workspace 归属迁移
├── captures/route.ts             # 187行
├── captures/stats/route.ts       # 128行
├── search/route.ts               # 117行
└── echoes/
    └── daily-refresh/route.ts   # 73行
```

## Capture 数据结构

`WorkspaceCapture` 是用户收集的音视频/图文内容，包含：
- `id`, `sessionId`, `type`（audio/video/article/image）
- `title`, `mediaUrl`, `attachmentUrl`, `previewUrl`
- `durationMs`, `segmentCount`, `status`
- `addedAt`, `sourceKey`, `sourceType`

## Search 检索

search 接口支持：
- 自然语言语义检索
- 按 `sessionId` 过滤
- 按时间范围过滤
- SSE 流式返回匹配结果

## 依赖服务

- `workspace-echo-service.ts` (1266行) — 回响数据管线
- `workspace-context-service.ts` (838行) — Workspace 上下文管理
- `workspace-captures-service.ts` — capture CRUD
