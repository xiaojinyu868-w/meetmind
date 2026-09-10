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
| `/api/apps/execute` | POST | 执行 AI-Native 应用插件；服务端为应用矩阵七类应用注入 `runtimeControl`，插件不能反向依赖 Prisma；材料不足、插件拒绝低价值成品时统一返回 `422 CONTENT_NOT_READY`；信息图 execute 内联生图（provider 走 `infographic-image-provider.ts`），专属超时 `APP_EXEC_INFOGRAPHIC_TIMEOUT_MS` 默认 300s |
| `/api/apps/teach-back/evaluate` | POST | 讲给同桌听的四象限核对：请求体携带讲述目标 + 讲述记录 + 课堂转录（证据由客户端携带，与 execute 同契约），委托 `teach-back-eval-service.ts` 对照课堂转录判 coverage × confidence，quadrant 由服务端映射推导 |
| `/api/apps/teach-back/cover-check` | POST | 讲课过程中的轻量覆盖检测，委托 `teach-back-cover-service.ts`。2026-08 语音讲课下线后暂无前端调用方，保留可用 |
| `/api/apps/teach-back/respond` | POST | 半双工语音版「讲给同桌听」的同桌应答：请求体携带讲述目标 + 到目前为止的讲述记录（允许空数组），委托 `teach-back-respond-service.ts` 让同桌（AI 学生）决定开口说一句话（`say`）还是继续安静听（`say: null`，也属成功）；任何失败收为 `say: null`，绝不打断讲课流 |
| `/api/apps/teach-back/turn` | POST（SSE） | **连续讲述版（2026-09-10）的评委回合**：学生每停下来一段（客户端能量 VAD + ASR 句末判定）调一次，请求体 `{ targets, turns[{role,text,judgeId?}], segment, transcript(slim), metadata?, mode: 'turn' \| 'check-in' }`（证据由客户端携带，与 evaluate 同契约；`check-in` = 他 40s 没说话，评委问一句要不要先到这），委托 `teach-back-panel-service.ts` 让评委席（直言 / 引导 / 追问三位 AI 同学）决定谁开口说什么。响应 `text/event-stream`，每条 `data: <json>`：`{type:'judge',judgeId}` 谁开口（先于正文）→ `{type:'delta',text}` 流式增量 → `{type:'done',judgeId,text}` 说完（全文）；或 `{type:'silent'}` 谁都不开口（也是成功）；`{type:'error',message}` 客户端视同 silent；结尾 `data: [DONE]`。单条 ≤220 字（服务端截断）。**为什么不扩展 respond**：respond 是"一句或安静"的 JSON 一问一答，评委回合要流式文字（气泡边说边长、首句即送 TTS）和"谁在说"，传输与契约都不同；respond 原样保留给半双工版回退。限流桶单独成 `teachBackTurn`（40/分 · 400/时 · 1500/天：一场十分钟几十个回合，不与 appsExecute 抢）；公开路由（`public-routes.ts`）。模型 `TEACH_BACK_PANEL_MODEL`（默认 workshop，thinking 关；prompt 见 `src/lib/prompts/teach-back-panel-prompt.ts`） |
| `/api/apps/plugins` | GET | 获取已注册插件列表 |
| `/api/apps/catalog` | GET | 获取应用目录（分类/标签） |
| `/api/apps/infographic/generate-image` | POST | 生成信息图图片（provider 判定走 `infographic-image-provider.ts`：默认 DashScope，`IMAGE_PROVIDER=gemini` 退回 Gemini）；写 `public/uploads/infographic/` 返回 HTTP URL |

## 文件清单

```
src/app/api/apps/
├── execute/route.ts                     # tier / readiness / 插件执行与统一错误契约
├── teach-back/turn/route.ts             # 评委回合 SSE（zod 校验 → streamTeachBackPanel 逐事件写出；request.signal 中止即停）
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
