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
| `/api/sources/ingest-image` | POST | 图片接入：Qwen-OCR（qwen-vl-ocr）提取的结构化文本直接作为上下文；低产出/失败回退多模态 vision |

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
   - 文档 → DashScope 文件提取（qwen-doc-turbo；docx 失败时本地 mammoth 兜底）
   - 图片 → OCR
   - 纯文本 → 直接入库
4. 生成 `SourceIngestItem`，写入 Workspace

## 关键闸门（ingest/route.ts）

- 文件大小上限 `INGEST_MAX_FILE_MB`（默认 100MB，下游 DashScope 单文件支持 150MB）
- 文档提取低于 `INGEST_MIN_EXTRACTED_CHARS`（默认 50 字）返回 422 `LOW_TEXT_YIELD`，防止扫描件 PDF 只返回一句说明被当作成功
- `ingest-image` 主链路为 `qwen-ocr-service`（`DASHSCOPE_OCR_MODEL`，默认 qwen-vl-ocr，DashScope multimodal-generation 同步接口，自定义 prompt 输出 Markdown + LaTeX + 图表数据）；OCR 结构化文本即为最终上下文，不再过 LLM 整理（2026-08 决策：qwen-vl-ocr 产出已是干净 Markdown，整理步骤是多余成本）
- `ingest-image` OCR 有效字符低于 `IMAGE_OCR_MIN_CHARS`（默认 20，去空白计数）或 OCR 调用失败时，自动回退原多模态 vision 链路（`LLMConfig.defaultVisionModel`）；响应契约不变
- `ingest-image` 对纯数字文件名（Android 相机 epoch 毫秒命名）回退标题为「图片材料」

## 类型参考

`SourceIngestItem` 定义在 `src/types/index.ts`，包含：
- `id`, `sourceKey`, `type`, `role`
- `title`, `preview`, `mediaUrl`, `attachmentUrl`
- `segmentCount`, `durationMs`
- `status`, `reviewable`

## 关联路由

- 视频导入专用管线 → `/api/video/import`（已独立，详细见 `../video/import/DOMAIN.md`）
- 图文导入（公众号/小红书/知乎）→ `/api/article/import`
