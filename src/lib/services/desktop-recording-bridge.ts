/**
 * desktop-recording-bridge — 桌面壳「旁听」的网页侧钩子
 *
 * 桌宠双击 → 主进程 IPC → 隐藏主窗口 executeJavaScript 调
 * `window.__meetmindDesktopRecording.toggle()`。本模块是钩子的唯一注册点：
 * 壳做身体（唤起/授权 loopback），网页做大脑（Recorder + ASR + 课后理解全复用）。
 *
 * toggle 语义：
 *   - 不在录 → 以 system（电脑声音）起录，最多等 4s 确认真的起来了
 *   - 在录 → 停录（走完整 stop 链路：原声上传 + 定稿 + 课后理解）
 */

export interface DesktopRecordingToggleResult {
  listening: boolean;
  reason?: 'start-failed' | 'not-ready';
}

export interface DesktopRecordingController {
  isRecording: () => boolean;
  /** 以系统声起录；返回是否真的进入录音态 */
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
}

interface DesktopRecordingHook {
  toggle: () => Promise<DesktopRecordingToggleResult>;
  isListening: () => boolean;
}

declare global {
  interface Window {
    __meetmindDesktopRecording?: DesktopRecordingHook;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function installDesktopRecordingBridge(controller: DesktopRecordingController): () => void {
  if (typeof window === 'undefined') return () => undefined;

  window.__meetmindDesktopRecording = {
    toggle: async () => {
      if (controller.isRecording()) {
        await controller.stop();
        return { listening: false };
      }
      const started = await controller.start();
      return started
        ? { listening: true }
        : { listening: false, reason: 'start-failed' as const };
    },
    isListening: () => controller.isRecording(),
  };

  return () => {
    delete window.__meetmindDesktopRecording;
  };
}

/** 等录音真正起来（autoStartSignal 是异步链路）：轮询最多 timeoutMs */
export async function waitForRecordingStart(isRecording: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRecording()) return true;
    await delay(120);
  }
  return isRecording();
}
