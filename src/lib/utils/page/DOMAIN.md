# Page Utils — page.tsx 工具函数子模块

> 从 `page-utils.ts`（原 1133 行）拆分的 5 个子模块。
> `page-utils.ts` 现为 10 行 barrel re-export，消费者 import 路径不变。

## 依赖规则

```
page.tsx → page-utils.ts (barrel) → page/*.ts (子模块)
```

子模块之间无循环依赖。`text-and-constants.ts` 是基础层，其他模块可 import 它。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `text-and-constants.ts` | 66 | 基础层：常量 + compactText + compactMultilineText + 键生成器 + normalizeWorkshopWindows |
| `segment-and-support.ts` | 93 | 转录片段辅助 + 补充材料合并 |
| `echo-display-utils.ts` | 214 | Echo 显示：mergeWorkspaceEchoes, resolveEchoDisplayTime, buildManualEchoFeedbackFromPayload |
| `capture-source-utils.ts` | ~400 | Capture/Source：mergeWorkspaceCaptures, buildWorkspaceCaptureSourceItem, buildWechatCaptureSourceItem；恢复课中板书的 session + `capturedAtMs` 时间锚点；归一化录音转写失败文案 |
| `context-and-format.ts` | 368 | ASR/Tutor 上下文 + 视频洞察 + formatTime + transcribeAudioFile/parseDocumentFile/parseImageFile；默认 ASR 热词覆盖 AI/Agent/模型/行业概念，并带常见误识别别名提示 |
