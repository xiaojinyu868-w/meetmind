/**
 * 浏览器音频采集约束（M5 T2.11 / T5.6）
 *
 * 课堂场景的工艺共识（来自飞书妙记 / WebRTC 最佳实践）：
 *   - AEC on — 浏览器 WebRTC AEC3 足够好
 *   - NS  on — 但不是 RNNoise 级别（RNNoise 会伤中文辅音）
 *   - AGC 可配 — 课堂老师远场收音可能需要关
 *
 * 这个文件把约束中心化，Recorder / OmniRealtimeCall 都走这里，防止散落各处。
 *
 * 之所以不引入 @ricky0123/vad-web（Silero wasm）：
 *   - 大依赖（~2MB）引入启动体感代价
 *   - Qwen Omni realtime 服务端已有 VAD
 *   - 当前价值不大，留作 M6+ 的专题；API 保持兼容，日后可换
 */

export interface AudioConstraintOptions {
  sampleRate?: number;
  channelCount?: 1 | 2;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  deviceId?: string;
}

const DEFAULTS: Required<Omit<AudioConstraintOptions, 'deviceId'>> = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * 生成 getUserMedia 可用的 MediaStreamConstraints。
 *
 * 读取环境变量覆盖（便于 A/B 测试）：
 *   - NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL (default "true")
 *   - NEXT_PUBLIC_ASR_ECHO_CANCELLATION (default "true")
 *   - NEXT_PUBLIC_ASR_NOISE_SUPPRESSION (default "true")
 */
export function buildAudioConstraints(opts: AudioConstraintOptions = {}): MediaStreamConstraints {
  const envFlag = (name: string, defaultValue: boolean): boolean => {
    if (typeof process === 'undefined' || !process.env) return defaultValue;
    const v = process.env[name];
    if (v === undefined) return defaultValue;
    return String(v).toLowerCase() !== 'false';
  };

  const merged = {
    ...DEFAULTS,
    echoCancellation: envFlag('NEXT_PUBLIC_ASR_ECHO_CANCELLATION', DEFAULTS.echoCancellation),
    noiseSuppression: envFlag('NEXT_PUBLIC_ASR_NOISE_SUPPRESSION', DEFAULTS.noiseSuppression),
    autoGainControl: envFlag('NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL', DEFAULTS.autoGainControl),
    ...opts,
  };

  const audio: MediaTrackConstraints = {
    sampleRate: { ideal: merged.sampleRate },
    channelCount: merged.channelCount,
    echoCancellation: merged.echoCancellation,
    noiseSuppression: merged.noiseSuppression,
    autoGainControl: merged.autoGainControl,
  };
  if (opts.deviceId) audio.deviceId = { exact: opts.deviceId };

  return { audio };
}

/**
 * 启发式 VAD：基于 RMS 能量判断。
 *
 * 不是 Silero 级别，但零依赖实时可用；课堂场景老师长段讲话 + 学生偶尔插话已足够分辨。
 * API 设计成可无缝替换：调用方只认 `{speaking, rms}`——日后换 Silero 无需改上层。
 */
export interface HeuristicVadOptions {
  frameMs?: number;
  rmsThreshold?: number;
  warmupFrames?: number;
}

export interface VadEvent {
  speaking: boolean;
  rms: number;
  timestamp: number;
}

export function computeRms(buffer: Float32Array | number[]): number {
  const len = buffer.length;
  if (len === 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / len);
}

export class HeuristicVad {
  private opts: Required<HeuristicVadOptions>;
  private noiseFloor = 0;
  private warmedFrames = 0;
  private speaking = false;
  private risingEdgeFrames = 0;
  private fallingEdgeFrames = 0;

  constructor(opts: HeuristicVadOptions = {}) {
    this.opts = {
      frameMs: opts.frameMs ?? 30,
      rmsThreshold: opts.rmsThreshold ?? 0.02,
      warmupFrames: opts.warmupFrames ?? 10,
    };
  }

  process(frame: Float32Array | number[], timestamp: number = Date.now()): VadEvent {
    const rms = computeRms(frame);

    if (this.warmedFrames < this.opts.warmupFrames) {
      this.noiseFloor = Math.max(this.noiseFloor, rms);
      this.warmedFrames += 1;
      return { speaking: false, rms, timestamp };
    }

    const threshold = Math.max(this.opts.rmsThreshold, this.noiseFloor * 1.8);
    const isLoud = rms > threshold;

    const ATTACK_FRAMES = 2;
    const RELEASE_FRAMES = 10;

    if (isLoud) {
      this.risingEdgeFrames += 1;
      this.fallingEdgeFrames = 0;
      if (!this.speaking && this.risingEdgeFrames >= ATTACK_FRAMES) {
        this.speaking = true;
      }
    } else {
      this.fallingEdgeFrames += 1;
      this.risingEdgeFrames = 0;
      if (this.speaking && this.fallingEdgeFrames >= RELEASE_FRAMES) {
        this.speaking = false;
      }
    }

    return { speaking: this.speaking, rms, timestamp };
  }

  reset(): void {
    this.noiseFloor = 0;
    this.warmedFrames = 0;
    this.speaking = false;
    this.risingEdgeFrames = 0;
    this.fallingEdgeFrames = 0;
  }
}
