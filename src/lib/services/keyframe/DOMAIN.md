# Keyframe — 课中「截取这一页」关键帧

> 产品决策（2026-07-28 确认）：**主动截图是主链路，自动检测是远期备选**。
> 用户按下截图那一刻 = 主动意图锚点，准确率 100%、零误检、不需要 VLM 筛帧——
> 与 AirJelly「Enter 键主动锚点优于全量自动」是同一结论。
> 架构定位见 `roadmap/v4.0-everywhere-capture.md`。

## 数据流

```
录课（system/mixed，屏幕流存在）
  recorder-audio-source 保留屏幕视频轨（screenTrack）
  → Recorder 调 registerScreenTrack(track) + armDesktopCaptureHook(sessionId/时间轴)
  → 用户三处入口触发：
      ① 课中视图「截取这一页」按钮（ClassroomRecordingView → page.tsx）
      ② 桌面全局热键 Cmd/Ctrl+Shift+M（screenshot.js 录制感知分流，
         先调 window.__meetmindCaptureFrame 钩子，不在录才走收集线截图）
  → captureCurrentFrame() 抓当前帧 → db.keyframes（timestampMs 与转录同轴）
课后
  → persistCaptureToWorkspace 返回 captureId
  → upload-recording-keyframes：upload-image → artifacts(kind='keyframe')
  → 音频上传成功点是天然重试入口；失败帧本地 uploaded=false 保留
复习页
  → useSessionKeyframes(sessionId) 懒加载（blob→objectURL / mediaUrl）
  → TranscriptFlowView keyframes prop 按时间轴插入缩略图条（可点击回跳）
```

## 依赖规则

```
frame-capture.ts → phash.ts（DOM/Canvas 只在 frame-capture）
detector.ts → phash.ts（纯逻辑，可单测）
screen-frame-grabber.ts → frame-capture + lib/db/keyframes（帧源注册表，DOM 在这里）
upload-recording-keyframes.ts → lib/db/keyframes + fetch API
```

- ❌ 不 import components/；UI 通过 hooks/props 消费（useSessionKeyframes）

## 文件索引

| 文件 | 职责 |
|------|------|
| `screen-frame-grabber.ts` | 帧源注册表（模块单例）：registerScreenTrack / captureCurrentFrame / 桌面热键钩子 arm·disarm |
| `frame-capture.ts` | 浏览器抓帧：video 元素 → 32x32 pHash / 1280px JPEG |
| `phash.ts` | 64 位 DCT 感知哈希 + 汉明距离（带死区防纯色同值簇失稳） |
| `detector.ts` | 自动翻页检测器（稳定期结算 + 翻回旧页去重）——**远期备选**，当前未接入 |
| `../upload-recording-keyframes.ts` | 课后上传：IndexedDB 未上传帧 → upload-image → artifacts 批量 upsert |

相关：`src/lib/db/keyframes.ts`（Dexie v8 `keyframes` 表 CRUD）、
`src/hooks/useSessionKeyframes.ts`（复习页懒加载）。

## 参数基线

- 关键帧 JPEG 长边 1280px（文字 OCR 像素下限），约 150-300KB/帧
- artifacts payload：`{ mediaUrl, timestampSec }`，artifactKey `kf-{localId}` 幂等
- 自动检测（备用）参数：1fps；切换阈值 12/64；去重阈值 6/64；稳定期 2.5s
