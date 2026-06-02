# components/realtime — 实时语音通话视觉模板（v7 呼吸光晕）

> M11：抽出一套通话视觉模板，复习态语音同桌 + 「聊聊你想要的」打电话模式共用一套 UI。

## 这一域做的事

承载所有"实时语音通话"的视觉壳：呼吸光晕、状态映射、底部 FAB 控制条。  
逻辑（WebSocket / DashScope realtime）由 `src/hooks/useOmniRealtimeCall.ts` 提供，这一域只做视觉。

## 文件清单

| 文件 | 职责 |
|---|---|
| `RealtimeOrb.tsx` | v7 呼吸光晕组件。pine 主光环 + vermilion 响应点缀 + 中央声纹条。状态：idle / listening / thinking / responding / muted。 |
| `IntentVoiceCallScreen.tsx` | 「聊聊你想要的」打电话模式的全屏壳。复用 useOmniRealtimeCall + RealtimeOrb。 |

`src/components/tutor/TutorRealtimeCallScreen.tsx` 也使用 `RealtimeOrb`（M11 之前是它本地的 `VoiceOrb`，已废弃并迁移）。

## 设计宪法

通话是 v7 设计宪法 6 个仪式时刻白名单之一：
- 米白纸感主底（不是黑底科技感）
- 多层 radial gradient 光晕（外/中/内）
- pine `#2D4F3E` 作 AI 沉淀主调；vermilion `#B5483C` 作"AI 在说"响应色
- thinking 状态：内圈环 6s 旋转
- muted 状态：呼吸停止 + 颜色降饱和（#8E8B82）

## 抗噪 / 抗打断

`server.js` 的 `/api/tutor-call` 在 M11 升级了 turn detection：
- `turn_detection.type='semantic_vad'`（默认，可通过 `DASHSCOPE_OMNI_TURN_DETECTION` 切回 `server_vad`）
- `input_audio_noise_reduction.type='near_field'`（默认，远场用 `far_field`，关闭用 `off`）
- `silence_duration_ms` 默认 1500（旧版 1100），缓冲附和声 / 短暂背景音
- `vad_threshold` 默认 0.5（嘈杂环境可调高到 0.6-0.7）

环境变量见 `.env.example` 「实时语音同桌」段。
