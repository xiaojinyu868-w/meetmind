# Context Reach — 输入内容智能分流

> 用户在收集流输入文本/链接时，自动识别内容类型并路由到对应处理管线。
> 比如输入 B 站链接 → 识别为 `video-link` → 自动触发视频导入。

## 数据流

```
用户输入 → detectReachFromText/detectReachFromFile
  → 返回 { kind, channel, url, ... }
  → page.tsx 根据 channel 决定自动导入还是手动确认
```

## Channel 类型

| Channel | 触发条件 | 自动导入 | 目标路由 |
|---------|----------|----------|----------|
| `video-link` | B站/YouTube/小宇宙/抖音 URL | ✅ | `/api/video/import` |
| `article-link` | 小红书/知乎/公众号/通用 URL | ✅ | `/api/article/import` |
| `file-upload` | 文件拖拽/选择 | 否 | 前端处理 |

## 文件索引

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `index.ts` | 183 | 检测引擎 + channel 定义 | `detectReachFromText`, `detectReachFromFile`, `CONTEXT_REACH_CHANNELS` |
| `link-provider.ts` | 68 | URL 平台识别（域名→平台名映射） | `detectLinkProvider`, `LinkProviderInfo` |
