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
| `/api/workspace/current` | GET | 获取当前用户的工作空间元信息 + captures / echoes 列表；读之前把超过 6h 没再收到检查点的「录制中」capture 翻成 completed（`finalizeStaleRecordingCaptures`）；同一 sessionId 的历史双行按 sessionId 折叠成一行 |
| `/api/workspace/local-migration` | POST | 把本地 IndexedDB 学习历史归属到当前账号工作区 |
| `/api/workspace/captures` | POST / PATCH / DELETE | 按 sourceKey 幂等写入 / 归档恢复改写 / 删除一条收集。POST 对课堂媒体按 `metadata.sessionId` 复用同一节课已有行（不再一课多行），零信息标题不覆盖具体标题，撞唯一键重试为更新；`metadata.recordingState='completed'` 是现场录音结束的标记 |
| `/api/workspace/recording-checkpoint` | POST | **录课中的检查点**（2026-09-10，登录）：`{ sessionId, kind: 'checkpoint' \| 'heartbeat', durationMs, startedAt?, title?, segments?, audioSource? }` → 同一把 sourceKey `live:{uid}:{sid}` 写一条 `metadata.recordingState='recording'` 的 capture（checkpoint 带已定稿分段快照；heartbeat 只更新时长 / 时刻，keepalive 友好），不带正文、不触发课后理解 / 回声；体积上限 2MB、分段上限 10000。返回 `{ success, captureId, sourceKey }`。另一台设备据此在列表看到「录制中 · 已 N 分钟」 |
| `/api/workspace/captures/[captureId]/evidence` | GET | 按课堂懒加载正规化转录、锚点、摘要、精选片段与笔记；仅工作区成员可读 |
| `/api/workspace/captures/stats` | GET | 获取 captures 统计（总数/时长/类型分布） |
| `/api/workspace/search` | POST | AI 语义检索（SSE 流式返回） |
| `/api/workspace/upload-audio` | POST | 登录态持久化录音原声，并按 sessionId 自动绑定对应 capture；落盘后异步预生成波形峰值（ffmpeg → 800 点 `.peaks.json`） |
| `/api/workspace/audio/[userId]/[fileName]` | GET | 鉴权读取运行期上传的课堂原声 |
| `/api/workspace/audio-peaks/[user]/[file]` | GET | 返回预生成波形峰值（800 点 + 时长），前端 wavesurfer 拿到后跳过整段解码；未生成时 404 并后台补生成 |
| `/api/workspace/echoes/daily-refresh` | POST | 触发每日回响新鲜度刷新 |

## 文件清单

```
src/app/api/workspace/
├── current/route.ts              # 45行
├── local-migration/route.ts      # 本地学习历史 → Workspace 归属迁移
├── captures/route.ts             # 230行
├── captures/[captureId]/evidence/route.ts # 跨设备课堂证据按需读取
├── recording-checkpoint/route.ts # 录课中检查点（录制中 capture）
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

课堂列表的 `metadata` 只保留 `sessionId`、视频播放信息与 `evidenceAvailable` 等轻量索引。
现场录音的 capture 另带 `recordingState`（`recording` = 另一台设备正在录 / `completed`）、`checkpointAt`、`finalizedBy`
（`server-timeout` 6h 无检查点由服务端收尾 / `client-recovery` 用户在恢复条点了「就到这里」/ `client-retry` 结束时写失败后的补传）。
sourceKey 约定：新录音 `live:{userId}:{sessionId}`（录课一开始就能算出，检查点 / 结束 / 原声回写 / 恢复 / 补传同一把）；
旧数据 `live:audio-<随机>` 与登录迁移的 `local-session:{userId}:{sessionId}` 继续有效，服务端按 `metadata.sessionId` 认成同一节课。
完整转录写入 `WorkspaceTranscriptSegment`，锚点/摘要/精选片段/笔记写入
`WorkspaceCaptureArtifact`，由 evidence 路由在用户打开课堂时读取。旧版仍内嵌在
`metadataJson` 的证据会在输出列表时被剥离，并可由 evidence 路由兼容读取。

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
