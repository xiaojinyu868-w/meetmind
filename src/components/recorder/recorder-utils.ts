import type { TranscriptSegment } from '@/types';
import { calculateSimilarity } from '@/lib/utils/transcript-utils';
import { DEDUP_SIMILARITY, DEDUP_GAP_MS } from './recorder-types';

/** 标准化文本用于去重比较：NFKC + 小写 + 去除标点/空白 */
export function normalizeCompareText(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:"""'（）()【】\[\]-]/g, '');
}

/** 判断新 segment 是否应替换最后一个（去重逻辑） */
export function shouldReplaceLastSegment(last: TranscriptSegment, next: TranscriptSegment): boolean {
  const gap = Math.max(0, next.startMs - last.endMs);
  const overlap = next.startMs <= last.endMs;
  const similarity = calculateSimilarity(last.text, next.text);

  if (similarity >= DEDUP_SIMILARITY && (overlap || gap <= DEDUP_GAP_MS)) {
    return true;
  }

  const lastKey = normalizeCompareText(last.text);
  const nextKey = normalizeCompareText(next.text);
  return !!lastKey && lastKey === nextKey && (overlap || gap <= DEDUP_GAP_MS);
}

/** 将内部错误信息转换为用户友好文案 */
export interface ErrorHint {
  message: string;
  /** 给用户的"下一步该做什么"——不是全部错误都有 */
  action?: string;
}

const ERROR_PATTERNS: Array<{ match: RegExp; hint: ErrorHint }> = [
  {
    match: /NotAllowedError|Permission denied|拒绝授权|麦克风权限/i,
    hint: {
      message: '浏览器挡住了麦克风。',
      action: '点地址栏左边的锁/权限图标，把麦克风改成"允许"，再回来点一次录音。',
    },
  },
  {
    match: /NotFoundError|Requested device not found|没有检测到麦克风/i,
    hint: {
      message: '没找到可用的麦克风。',
      action: '插上耳机/麦克风，或检查系统声音设置里的输入设备；选好再点录音。',
    },
  },
  {
    match: /NotReadableError|device in use|麦克风被占用/i,
    hint: {
      message: '麦克风被别的程序占着。',
      action: '关掉其他正在录音的 App（Zoom / 腾讯会议 / 飞书等），再回来试。',
    },
  },
  {
    match: /session already started or finished or failed/i,
    hint: { message: '实时转写刚刚在重连，稍等一秒再继续录就好。' },
  },
  {
    match: /公网地址|可访问的公网地址|PUBLIC_DOMAIN|PUBLIC_HOST|ASR_PUBLIC_HOST_MISSING/i,
    hint: {
      message: '当前环境没配公网转写地址，这段原声先留住，但暂时还转不成文字。',
    },
  },
  {
    match: /ASR_API_KEY_MISSING|API Key|401 Unauthorized|apikey/i,
    hint: {
      message: '转写服务密钥没配或失效。',
      action: '联系管理员检查 DASHSCOPE_API_KEY；原录音不会丢。',
    },
  },
  {
    match: /429|rate limit|Too Many Requests/i,
    hint: {
      message: '转写请求太频繁了。',
      action: '等 30 秒再试；录音本身还在，不用重录。',
    },
  },
  {
    match: /NetworkError|Failed to fetch|ECONNRESET|ETIMEDOUT|network/i,
    hint: {
      message: '网络抖了一下。',
      action: '检查一下连接再试；如果还录着，这段原声会保留。',
    },
  },
  {
    match: /413|too large|文件过大|ASR_AUDIO_TOO_LARGE/i,
    hint: {
      message: '录音太长，转写服务吃不下。',
      action: '当前上限 500MB / ~10 小时；分段或剪短后重试。',
    },
  },
  {
    match: /FFMPEG_NOT_FOUND|ffprobe/i,
    hint: {
      message: '服务端缺 ffmpeg/ffprobe，暂时处理不了音频。',
      action: '联系管理员装上依赖即可。',
    },
  },
];

/**
 * 把裸错误文案映射为"看得懂 + 知道怎么办"的双段提示。
 * UI 侧可选择渲染 message / action 两行，也可以 join 成单段。
 */
export function normalizeRecorderErrorDetail(message: string): ErrorHint {
  const text = (message || '').trim();
  if (!text) return { message: '录音出了点问题，请再试一次。' };
  for (const entry of ERROR_PATTERNS) {
    if (entry.match.test(text)) return entry.hint;
  }
  return { message: text };
}

/** 兼容旧接口——单字符串版本。新组件请用 normalizeRecorderErrorDetail */
export function normalizeRecorderErrorMessage(message: string): string {
  const hint = normalizeRecorderErrorDetail(message);
  return hint.action ? `${hint.message} ${hint.action}` : hint.message;
}

/** 格式化毫秒为 MM:SS 或 HH:MM:SS */
export function formatRecorderTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
  }
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

/** 音频重采样（线性插值）：将 Float32Array 从 fromRate 转换到 toRate */
export function resamplePcm(inputData: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return inputData;
  const ratio = fromRate / toRate;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const t = srcIndex - srcIndexFloor;
    result[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
  }
  return result;
}

/** 将 Float32Array PCM 数据转换为 Int16Array（供 ASR WebSocket 发送） */
export function float32ToInt16(input: Float32Array): Int16Array {
  const pcmData = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(input[i] * 32768)));
  }
  return pcmData;
}
