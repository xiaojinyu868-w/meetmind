/**
 * audio-peaks-service —— 服务端波形峰值预生成
 *
 * 问题：wavesurfer 加载长录音时要整段解码才能画波形，
 * 一节 45 分钟的课解码要好几秒——用户看到的是「卡在加载音频 100%」。
 *
 * 解法：服务端用 ffmpeg 预解码一次，生成 800 个峰值点存成 .peaks.json，
 * 前端拿到 peaks 后跳过整段解码，几乎即时出波形。
 *
 * 触发：上传成功后异步生成；peaks 接口 404 时后台补生成（下次访问即命中）。
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('audio-peaks');

const PEAK_COUNT = 800;
const SAMPLE_RATE = 8_000;
const FFMPEG_TIMEOUT_MS = 120_000;

export interface AudioPeaksData {
  peaks: number[];
  durationSec: number;
}

export function peaksPathFor(audioPath: string): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}.peaks.json`);
}

export function readAudioPeaks(audioPath: string): AudioPeaksData | null {
  try {
    const raw = fs.readFileSync(peaksPathFor(audioPath), 'utf-8');
    const parsed = JSON.parse(raw) as AudioPeaksData;
    if (!Array.isArray(parsed.peaks) || parsed.peaks.length === 0) return null;
    return { peaks: parsed.peaks, durationSec: parsed.durationSec };
  } catch {
    return null;
  }
}

function runFfmpegPcm(audioPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function generateAudioPeaks(audioPath: string): Promise<AudioPeaksData | null> {
  try {
    const pcm = await runFfmpegPcm(audioPath);
    const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
    if (samples.length === 0) return null;

    const bucketSize = Math.max(1, Math.ceil(samples.length / PEAK_COUNT));
    const peaks: number[] = [];
    for (let i = 0; i < PEAK_COUNT; i += 1) {
      const start = i * bucketSize;
      if (start >= samples.length) {
        peaks.push(0);
        continue;
      }
      let max = 0;
      const end = Math.min(start + bucketSize, samples.length);
      for (let j = start; j < end; j += 1) {
        const abs = Math.abs(samples[j]);
        if (abs > max) max = abs;
      }
      peaks.push(Math.min(1, Math.round(max * 1000) / 1000));
    }

    const data: AudioPeaksData = {
      peaks,
      durationSec: Math.round((samples.length / SAMPLE_RATE) * 100) / 100,
    };
    fs.writeFileSync(peaksPathFor(audioPath), JSON.stringify(data));
    return data;
  } catch (error) {
    log.warn('peaks generation failed', {
      audioPath: path.basename(audioPath),
      message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return null;
  }
}

const inFlight = new Set<string>();

/**
 * 有缓存直接返回；没有则后台补生成（返回 null，下次访问命中）。
 * 同一路径只并发生成一次。
 */
export function ensureAudioPeaks(audioPath: string): AudioPeaksData | null {
  const cached = readAudioPeaks(audioPath);
  if (cached) return cached;
  if (inFlight.has(audioPath)) return null;
  inFlight.add(audioPath);
  void generateAudioPeaks(audioPath)
    .catch(() => null)
    .finally(() => inFlight.delete(audioPath));
  return null;
}
