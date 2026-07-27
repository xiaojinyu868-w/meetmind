/**
 * recorder-audio-source — 录音来源采集
 *
 * 三种模式：
 *   - 'mic'    : navigator.mediaDevices.getUserMedia（环境里的声音）
 *   - 'system' : navigator.mediaDevices.getDisplayMedia（电脑扬声器输出）
 *   - 'mixed'  : mic + system 通过 Web Audio 合并到一个 MediaStream
 *
 * 关键设计：
 *   1. 所有模式统一返回 { stream, cleanup }：上游只处理 MediaStream，不用关心细节
 *   2. getDisplayMedia 必须请求 video，否则 Chrome 不给 audio。拿到后立刻 stop video track
 *   3. 'system' 如果用户没勾"分享系统音频/标签页音频"，track 数为 0 → 抛错让上游降级
 *   4. 'mixed' 用 AudioContext 的 MediaStreamAudioDestinationNode 做硬合并，
 *      下游不用改：MediaRecorder / Analyser / ScriptProcessor 仍然只认一路 stream
 *   5. cleanup() 负责 stop 掉所有原始 track + 关闭合并用的 AudioContext
 *
 * 为什么不在 Recorder.tsx 里直接 if/else：
 *   Recorder.tsx 已经 ~1700 行，把"哪儿来的音频"这件事封成黑盒，
 *   对 startRecording 的修改就只剩一行 `await acquireAudioStream(...)`。
 */

import type { RecorderAudioSource } from './recorder-types';

export interface AcquiredAudioStream {
  stream: MediaStream;
  /** 实际生效的来源（可能因用户行为从 system/mixed 降级到 mic） */
  effectiveSource: RecorderAudioSource;
  /**
   * system / mixed 模式下保留下来的屏幕视频轨（getDisplayMedia 必须请求 video）。
   * 不 stop 它的原因：课中「截取这一页」要从这条轨抓当前帧，
   * 与录音共用同一根时间轴；cleanup 时会一并释放。
   */
  screenTrack?: MediaStreamTrack;
  /** 释放所有底层资源——必须在录音结束或出错时调用 */
  cleanup: () => void;
}

export interface AcquireOptions {
  source: RecorderAudioSource;
  /**
   * 浏览器 getUserMedia 的 audio constraint——由 `buildAudioConstraints()`
   * 中心化生成，外层直接传 MediaTrackConstraints 即可。
   *
   * system / mixed 模式下的"系统音频"一路会强制关闭 AEC/NS/AGC（见
   * acquireSystemAudioStream），本 constraints 只作用于 mic 一路。
   */
  micConstraints: MediaTrackConstraints;
}

/** 拿一条麦克风 stream。永远只有一个 audio track。 */
async function acquireMicStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: constraints });
}

/**
 * 拿一条"电脑发出的声音"stream。
 *
 * 必须同时请求 video（Chrome 限制）。视频轨**保留并随返回值带出**——
 * 课中「截取这一页」要从它抓当前屏幕帧（用户主动意图锚点，见
 * roadmap/v4.0-everywhere-capture.md）。如果用户没勾"分享音频"，
 * audio track 数为 0，抛错。
 */
async function acquireSystemAudioStream(): Promise<{
  stream: MediaStream;
  screenTrack?: MediaStreamTrack;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('当前浏览器不支持采集电脑声音。请升级到最新版 Chrome / Edge。');
  }

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // 必须要，否则 Chrome 不会给 audio track；保留用于课中抓帧
    audio: {
      // 系统声源应保持原声：不做回声消除、不做降噪、不自动增益——
      // 否则讲课的连续语音会被当成"本机说话者的回声"抵消掉
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } as MediaTrackConstraints,
  });

  if (displayStream.getAudioTracks().length === 0) {
    // 用户没勾选"分享音频"
    throw new Error(
      '没收到电脑声音。下次弹窗时请勾选"分享系统音频"或"分享标签页音频"。'
    );
  }

  return { stream: displayStream, screenTrack: displayStream.getVideoTracks()[0] };
}

/**
 * 把 mic + system 两路合并成一路 MediaStream，下游统一消费。
 *
 * 用 Web Audio 的 MediaStreamAudioDestinationNode 做"硬合并"——
 * 下游拿到的就是一个单 track 的 stream，ScriptProcessor / Analyser / MediaRecorder
 * 全都按单路 mono 走，不用动。
 */
function mixTwoStreams(
  micStream: MediaStream,
  systemStream: MediaStream
): { stream: MediaStream; audioContext: AudioContext } {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  // 两路各建一个 source，统一连到 destination
  const micSource = audioContext.createMediaStreamSource(micStream);
  const systemSource = audioContext.createMediaStreamSource(systemStream);

  // 可以用 GainNode 做一些简单的电平平衡——
  // 系统声音普遍比麦克风输入更响，这里稍微压一点系统轨，让麦克风声音不至于被盖死
  const micGain = audioContext.createGain();
  micGain.gain.value = 1.0;
  const systemGain = audioContext.createGain();
  systemGain.gain.value = 0.85;

  micSource.connect(micGain).connect(destination);
  systemSource.connect(systemGain).connect(destination);

  return { stream: destination.stream, audioContext };
}

/**
 * 统一入口——按需求拿到最终给下游用的 MediaStream。
 *
 * 降级行为（"我想要电脑声音但失败了"）：
 *   - source='system' 失败 → 抛错，让上游以错误提示呈现（不静默降级，用户需要知道）
 *   - source='mixed' 失败（系统声采集失败）→ 降级为纯 mic，effectiveSource='mic'，不抛错
 *     理由：mixed 模式里麦克风拿到了就已经"能录"，系统声只是锦上添花
 */
export async function acquireAudioStream(opts: AcquireOptions): Promise<AcquiredAudioStream> {
  const { source, micConstraints } = opts;

  if (source === 'mic') {
    const stream = await acquireMicStream(micConstraints);
    return {
      stream,
      effectiveSource: 'mic',
      cleanup: () => {
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  if (source === 'system') {
    // 只要电脑声——失败就往上抛
    const { stream, screenTrack } = await acquireSystemAudioStream();
    return {
      stream,
      effectiveSource: 'system',
      screenTrack,
      cleanup: () => {
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  // 'mixed'
  const micStream = await acquireMicStream(micConstraints);
  let systemStream: MediaStream | null = null;
  let screenTrack: MediaStreamTrack | undefined;
  try {
    const acquired = await acquireSystemAudioStream();
    systemStream = acquired.stream;
    screenTrack = acquired.screenTrack;
  } catch (err) {
    // 系统声采集失败 → 默默降级到纯 mic。不影响录音主流程，打个 warn 让开发看到。
    console.warn('[Recorder] mixed mode: system audio acquisition failed, falling back to mic only:', err);
  }

  if (!systemStream) {
    return {
      stream: micStream,
      effectiveSource: 'mic',
      cleanup: () => {
        micStream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  const { stream: mixed, audioContext } = mixTwoStreams(micStream, systemStream);

  return {
    stream: mixed,
    effectiveSource: 'mixed',
    screenTrack,
    cleanup: () => {
      micStream.getTracks().forEach((t) => t.stop());
      systemStream!.getTracks().forEach((t) => t.stop());
      mixed.getTracks().forEach((t) => t.stop());
      audioContext.close().catch(() => { /* ignore */ });
    },
  };
}
