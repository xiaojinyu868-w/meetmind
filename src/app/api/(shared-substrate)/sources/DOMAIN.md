# Sources API Routes — 内容接入接口

> Sources 是内容进入系统的入口，将各类外部内容（视频/音频/文档/图片）转化为系统内部统一格式。

## 依赖规则

```
sources route.ts → lib/services/workspace-context-service.ts + 对应解析器
sources route.ts → lib/utils/page-utils.ts（formatTime 等工具）
```

## 路由清单

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/sources/ingest` | POST | 通用数据源接入（文档/文本/音频/视频） |
| `/api/sources/ingest-image` | POST | 图片接入（OCR + 多模态 LLM 解析） |

## 文件清单

```
src/app/api/sources/
├── ingest/route.ts          # 553行 ⚠️ 超标
└── ingest-image/route.ts    # 待确认
```

## ingest 处理流程

1. 解析请求体（url / file / text content）
2. 识别内容类型（audio/video/document/image/text）
3. 调用对应解析器：
   - 音频/视频 → 转录服务（ASR）
   - 文档 → 文本提取
   - 图片 → OCR
   - 纯文本 → 直接入库
4. 生成 `SourceIngestItem`，写入 Workspace

## 类型参考

`SourceIngestItem` 定义在 `src/types/index.ts`，包含：
- `id`, `sourceKey`, `type`, `role`
- `title`, `preview`, `mediaUrl`, `attachmentUrl`
- `segmentCount`, `durationMs`
- `status`, `reviewable`

## 关联路由

- 视频导入专用管线 → `/api/video/import`（已独立，详细见 `../video/import/DOMAIN.md`）
- 图文导入（公众号/小红书/知乎）→ `/api/article/import`
