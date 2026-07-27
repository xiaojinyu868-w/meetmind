# Keyframe — 录课「屏幕观察」关键帧检测

> 翻页检测纯逻辑层：1fps 缩略帧 pHash → 稳定结算 → 关键帧带录音时间轴锚点。
> 调研依据与三层架构定位见 `roadmap/v4.0-everywhere-capture.md`。

## 依赖规则

```
frame-capture.ts → phash.ts（DOM/Canvas 只在 frame-capture）
detector.ts → phash.ts（纯逻辑，可单测）
调用方（录课 hook）→ detector + frame-capture
```

- ✅ 纯逻辑（phash / detector）不得 import DOM 相关 API
- ❌ 不 import components/、不直接调 API（上传由调用方走 `/api/workspace/upload-image` + artifacts）

## 文件索引

| 文件 | 职责 |
|------|------|
| `phash.ts` | 64 位 DCT 感知哈希 + 汉明距离 + RGBA→灰度 |
| `detector.ts` | KeyframeDetector：画面切换检测、稳定期结算、翻回旧页去重、结束 flush |
| `frame-capture.ts` | 浏览器侧：video 元素抓帧 → 32x32 pHash / 1280px JPEG |

## 参数基线（调研值）

- 采样 1fps；画面切换阈值 12/64；翻页去重阈值 6/64；稳定期 2.5s
- 关键帧 JPEG 长边 1280px（文字 OCR 像素下限），约 150-300KB/帧
- 一节课预期 40-80 关键帧，上传为 `WorkspaceCaptureArtifact(kind='keyframe')`
