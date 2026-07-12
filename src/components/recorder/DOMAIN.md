# Recorder — 录音组件拆分子模块

> 从 `Recorder.tsx`（1750 行）提取的类型、工具函数和音频源采集。

## 文件索引

| 文件 | 职责 |
|------|------|
| `recorder-types.ts` | 录音器配置/状态/props 类型（含 process.env 默认值、`RecorderAudioSource` 重导出）；`headless` 只挂载录音引擎，不输出隐藏的可聚焦 UI |
| `recorder-utils.ts` | 录音器工具函数（纯函数；含实时 ASR final 合并器、批量转写端点选择，处理回滚重复窗口和异常重复时间戳） |
| `recorder-audio-source.ts` | 音频源采集黑盒：`acquireAudioStream({source})` 统一封装 mic / system（getDisplayMedia）/ mixed（双路 AudioContext 合并）三种模式，返回 `{stream, effectiveSource, cleanup}` |

## 音频源（RecorderAudioSource）

三档音源，类型定义在 `stores/capture-editor-store.ts`，由 `recorder-types.ts` 重导出：

| 值 | 场景 | 实现 |
|---|---|---|
| `'mic'` | 线下课（默认） | `getUserMedia` |
| `'system'` | 在家听网课 | `getDisplayMedia({video:true, audio:关闭三件套})` → 立刻 stop video track，audio track 为空时抛错 |
| `'mixed'` | 网课+自己提问 | mic + system 通过 `MediaStreamAudioDestinationNode` 合并（mic 1.0 / system 0.85）；system 拿不到时静默降级为 mic |

**浏览器兼容性注意**：macOS Chrome `getDisplayMedia` 只能拿标签页音频（需用户勾选"分享系统音频"）；Safari 支持有限，失败时 system 抛错、mixed 降级 mic。UI 层（`ClassroomLeftPanel` 的 `AudioSourcePicker`）负责展示 hint 引导用户勾选。

**清理**：`Recorder.tsx` 用 `audioCleanupRef` 在 catch / stop / restart / unmount 四处统一调用 `cleanup()`，回收 AudioContext 和 extra tracks，不泄漏。

## 依赖方向

`Recorder.tsx` → `recorder/`（单向依赖）

`recorder-types.ts` → `stores/capture-editor-store`（仅类型重导出 `RecorderAudioSource`）
