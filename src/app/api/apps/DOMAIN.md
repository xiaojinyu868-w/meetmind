# Apps API Routes — AI 原生应用系统接口

> 应用系统是 MeetMind 的 AI 原生能力展示层，支持插件化扩展。

## 依赖规则

```
apps route.ts → lib/ai-native/plugins/*.ts（插件系统）
apps route.ts → lib/services/ai-control-service.ts（仅服务端注入已发布 Prompt / 模型覆盖）
```

## 路由清单

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/apps/execute` | POST | 执行 AI-Native 应用插件；服务端为应用矩阵六类应用注入 `runtimeControl`，插件不能反向依赖 Prisma；材料不足、插件拒绝低价值成品时统一返回 `422 CONTENT_NOT_READY` |
| `/api/apps/plugins` | GET | 获取已注册插件列表 |
| `/api/apps/catalog` | GET | 获取应用目录（分类/标签） |
| `/api/apps/infographic/generate-image` | POST | Gemini 生成信息图 |

## 文件清单

```
src/app/api/apps/
├── execute/route.ts                     # tier / readiness / 插件执行与统一错误契约
├── plugins/route.ts                     # 待确认
├── catalog/route.ts                     # 待确认
└── infographic/
    └── generate-image/route.ts          # 待确认
```

## 插件系统

应用通过 `lib/ai-native/plugins/` 下的插件暴露能力：

| 插件 | 文件 | 职责 |
|------|------|------|
| Studio Workshop | `studio-workshop.plugin.ts` | 工作室/播客内容生成 |
| Mind Map | MindmapWindow 内置 | 思维导图渲染 |
| Infographic | InfographicWindow 内置 | 信息图渲染 |

详细插件文档：`src/lib/ai-native/plugins/DOMAIN.md`
