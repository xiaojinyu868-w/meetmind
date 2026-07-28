/**
 * 课中「截取这一页」的帧源注册表（模块级单例）。
 *
 * 数据流：
 *   Recorder 拿到 screenTrack（recorder-audio-source 保留的屏幕视频轨）
 *   → registerScreenTrack() 挂到一个隐藏 video 元素上
 *   → 课中按钮/快捷键按下 → captureCurrentFrame(sessionId, timestampMs)
 *   → 从流里抓当前帧存 IndexedDB（与转录同一根录音时间轴）
 *   → 课后 upload-recording-keyframes 上传服务端 artifacts
 *
 * 为什么走"共享屏幕流抓帧"而不是再开一次截图：
 *   像素级精准、零额外权限、和录音天然同轴。
 */

import { grabFrameJpeg } from './frame-capture';
import { addKeyframe } from '@/lib/db/keyframes';

let activeVideo: HTMLVideoElement | null = null;
let activeTrack: MediaStreamTrack | null = null;

/** 录音开始、拿到屏幕视频轨后调用；传 undefined 表示本节课没有屏幕流 */
export function registerScreenTrack(track: MediaStreamTrack | undefined): void {
  releaseScreenTrack();
  if (!track || typeof document === 'undefined') return;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => {
    // 自动播放被拒时抓帧会拿到黑帧——captureCurrentFrame 里按尺寸判空兜底
  });
  activeVideo = video;
  activeTrack = track;
}

/** 当前是否存在可用的屏幕帧源（决定课中是否露出「截取这一页」入口） */
export function hasActiveScreenTrack(): boolean {
  return Boolean(activeTrack && activeTrack.readyState === 'live' && activeVideo);
}

/**
 * 通过 Recorder 武装的录制钩子抓帧（时间戳取自 Recorder 的录音时钟，
 * 与转录段 startMs 严格同根——课中按钮应走这里而不是视图层的 seconds）。
 */
export async function captureFrameViaRecordingHook(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const hook = (window as HookWindow)[HOOK_NAME];
  if (typeof hook !== 'function') return false;
  return hook();
}

/**
 * 抓当前帧并存入 IndexedDB。timestampMs 必须来自录音时间轴
 * （Recorder 的 startTimeRef 同根）。成功返回 true。
 */
export async function captureCurrentFrame(sessionId: string, timestampMs: number): Promise<boolean> {
  if (!activeVideo || !sessionId) return false;
  // 用户中途停止屏幕共享后 track 变 ended，抓到的只是定格的最后一帧，没价值
  if (!activeTrack || activeTrack.readyState !== 'live') return false;
  if (activeVideo.videoWidth === 0 || activeVideo.videoHeight === 0) return false;
  try {
    const blob = await grabFrameJpeg(activeVideo);
    await addKeyframe(sessionId, timestampMs, blob);
    return true;
  } catch {
    return false;
  }
}

/** 录音结束/出错时调用：只释放引用，track 的 stop 由录音 cleanup 统一负责 */
export function releaseScreenTrack(): void {
  if (activeVideo) {
    activeVideo.srcObject = null;
  }
  activeVideo = null;
  activeTrack = null;
  disarmDesktopCaptureHook();
}

// ── 桌面壳全局热键的录制感知钩子 ──────────────────────────────────
// 桌面端 Cmd/Ctrl+Shift+M 触发时，主进程先问网页「正在录屏类课吗」：
// 在录 → 调 window.__meetmindCaptureFrame() 把当前帧挂到课堂时间轴；
// 没在录 → 走原来的「截图收进收集线」。同一个键，按场景分流。

interface CaptureFrameGetters {
  getSessionId: () => string;
  getElapsedMs: () => number;
}

const HOOK_NAME = '__meetmindCaptureFrame';

type HookWindow = Window & { [HOOK_NAME]?: () => Promise<boolean> };

/** 录音进行中由 Recorder 武装钩子 */
export function armDesktopCaptureHook(getters: CaptureFrameGetters): void {
  if (typeof window === 'undefined') return;
  (window as HookWindow)[HOOK_NAME] = async () => {
    if (!hasActiveScreenTrack()) return false;
    return captureCurrentFrame(getters.getSessionId(), getters.getElapsedMs());
  };
}

function disarmDesktopCaptureHook(): void {
  if (typeof window === 'undefined') return;
  delete (window as HookWindow)[HOOK_NAME];
}
