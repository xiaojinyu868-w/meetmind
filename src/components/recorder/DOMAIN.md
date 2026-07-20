# Recorder — 录音组件拆分子模块

> 从 `Recorder.tsx`（1750 行）提取的类型、工具函数和音频源采集。

## 文件索引

| 文件 | 职责 |
|------|------|
| `recorder-types.ts` | 录音器配置/状态/props 类型（含 process.env 默认值、`RecorderAudioSource` 重导出）；`headless` 只挂载录音引擎，不输出隐藏的可聚焦 UI；`recorderRef` 用普通 prop 传递 imperative handle |
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

## 实时 ASR 与说话人边界

- Qwen 是用户主链路唯一默认实时 ASR；课堂首页与录课中不暴露“单人 / 多人”供应商开关，避免用户为底层模型做决定，也避免切到较低准确率通道。
- `speakerDiarization` 和腾讯 speaker proxy 暂时只作为内部实验兼容能力保留；若实验调用录中切换，仍必须通过 active + pending 双 client 同步发送 PCM，pending ready 后才替换 active，禁止先断旧连接再等新连接。
- 面向用户的说话人信息在完整原声 batch 定稿之后静默补充，并且只有至少两位稳定发言者的证据成立才显示。
- PCM ScriptProcessor 使用 2048 帧，兼顾 Qwen 延迟与腾讯约 40ms 音频粒度；`StreamingPcmResampler` 跨 callback 保留插值相位，避免 44.1kHz 手机每个音频块独立取整造成丢样/重复采样。
- 停止后立即把 Recorder 释放回 `idle`；完整原声定稿作为 detached job 运行，并在第一个 `await` 前捕获 recordingId/sessionId。realtime 草稿只服务课中反馈，定稿前不发布为标题 / 摘要 / 应用输入；后台结果只通过外层 pending-audio + session isolation 回填，禁止再写 Recorder 的 transcript ref，用户可以立刻开始下一节课。
- realtime 停止不再固定 sleep 1.5 秒后硬关连接：正常等待 proxy 的 `session.finished`，异常最多 5 秒释放，避免尾句在网络往返稍慢时被客户端主动截断。
