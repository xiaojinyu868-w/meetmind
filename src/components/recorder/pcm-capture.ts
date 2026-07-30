/**
 * pcm-capture — 统一 PCM 捕获封装
 *
 * 为什么存在：旧实现用 ScriptProcessorNode，onaudioprocess 跑在主线程。
 * 页面一忙（实时转录渲染、React 更新）音频回调就被饿住，输入缓冲被音频
 * 引擎直接丢弃——表现为转录"吞段"。系统音频（网课/视频这种连续高能量
 * 内容）下尤其明显。
 *
 * AudioWorklet 跑在音频渲染线程，主线程再忙也不丢帧；不支持时兜底
 * ScriptProcessor（行为与旧实现一致）。worklet 源码用 Blob URL 内联，
 * 不依赖任何静态资源路径（网页版/桌面壳/本地 dev 都能跑）。
 */

export interface PcmCapture {
  /** 断开并释放（幂等） */
  stop: () => void;
}

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length > 0) {
      const ch0 = channels[0];
      if (ch0 && ch0.length > 0) {
        let mono;
        if (channels.length > 1 && channels[1] && channels[1].length === ch0.length) {
          const ch1 = channels[1];
          mono = new Float32Array(ch0.length);
          for (let i = 0; i < ch0.length; i += 1) mono[i] = (ch0[i] + ch1[i]) * 0.5;
        } else {
          mono = ch0.slice(0);
        }
        this.port.postMessage(mono, [mono.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

export async function createPcmCapture(params: {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  bufferSize: number;
  onChunk: (mono: Float32Array) => void;
}): Promise<PcmCapture> {
  const { audioContext, source, bufferSize, onChunk } = params;

  if (audioContext.audioWorklet) {
    try {
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await audioContext.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(audioContext, 'pcm-capture');
      node.port.onmessage = (event) => {
        onChunk(event.data as Float32Array);
      };
      source.connect(node);
      node.connect(audioContext.destination);
      let stopped = false;
      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          node.port.onmessage = null;
          try { node.disconnect(); } catch { /* ignore */ }
        },
      };
    } catch (error) {
      console.warn('[pcm-capture] AudioWorklet 初始化失败，退回 ScriptProcessor:', error);
    }
  }

  // 兜底：ScriptProcessor（旧路径）
  const node = audioContext.createScriptProcessor(bufferSize, 1, 1);
  node.onaudioprocess = (e) => {
    onChunk(e.inputBuffer.getChannelData(0));
  };
  source.connect(node);
  node.connect(audioContext.destination);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      node.onaudioprocess = null;
      try { node.disconnect(); } catch { /* ignore */ }
    },
  };
}
