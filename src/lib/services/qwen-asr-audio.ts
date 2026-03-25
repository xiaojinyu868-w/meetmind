/**
 * Qwen ASR — 音频格式转换
 *
 * 从 qwen-asr-service.ts 提取，封装与 ffmpeg 交互的底层音频处理。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { resolveFfmpegPath, resolveFfprobePath } from '@/lib/services/media-tooling';
import { createLogger } from '@/lib/logger';

const log = createLogger('qwen-asr-audio');

// 单个分块的最大时长（秒），确保 WAV 转换后 base64 不超过 15MB
export const MAX_CHUNK_DURATION_SEC = 180; // 3分钟

/**
 * 获取 ffmpeg 路径
 */
function getFfmpegPath(): string {
  const ffmpegPath = resolveFfmpegPath();
  return ffmpegPath;
}

/**
 * 获取音频时长（秒）
 */
export function getAudioDuration(inputPath: string): number {
  const ffmpegPath = getFfmpegPath();
  try {
    const ffprobePath = resolveFfprobePath(ffmpegPath);
    const cmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    const output = execSync(cmd, { stdio: 'pipe' }).toString().trim();
    return parseFloat(output) || 0;
  } catch (e) {
    log.warn('[FFmpeg] Failed to get duration:', e);
    return 0;
  }
}

/**
 * 将音频分割成多个 WAV 分块
 */
export async function splitAudioToWavChunks(audioBlob: Blob): Promise<{ chunks: Buffer[]; durations: number[] }> {
  const ffmpegPath = getFfmpegPath();

  const arrayBuffer = await audioBlob.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp}.webm`);

  fs.writeFileSync(inputPath, inputBuffer);

  // 获取总时长
  const totalDuration = getAudioDuration(inputPath);

  const chunks: Buffer[] = [];
  const durations: number[] = [];

  try {
    if (totalDuration <= MAX_CHUNK_DURATION_SEC) {
      // 短音频，直接转换
      const outputPath = path.join(tempDir, `output_${timestamp}.wav`);
      const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}"`;
      execSync(cmd, { stdio: 'pipe' });
      chunks.push(fs.readFileSync(outputPath));
      durations.push(totalDuration);
      fs.unlinkSync(outputPath);
    } else {
      // 长音频，分块处理
      const numChunks = Math.ceil(totalDuration / MAX_CHUNK_DURATION_SEC);

      for (let i = 0; i < numChunks; i++) {
        const startTime = i * MAX_CHUNK_DURATION_SEC;
        const chunkDuration = Math.min(MAX_CHUNK_DURATION_SEC, totalDuration - startTime);
        const outputPath = path.join(tempDir, `output_${timestamp}_${i}.wav`);

        const cmd = `"${ffmpegPath}" -y -ss ${startTime} -t ${chunkDuration} -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}"`;
        execSync(cmd, { stdio: 'pipe' });

        chunks.push(fs.readFileSync(outputPath));
        durations.push(chunkDuration);
        fs.unlinkSync(outputPath);
      }
    }

    return { chunks, durations };
  } finally {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (e) {
      log.warn('[FFmpeg] Cleanup error:', e);
    }
  }
}

/**
 * 将音频转换为 MP3 格式（用于异步任务，更小的文件体积）
 */
export async function convertToMp3(audioBlob: Blob): Promise<{ buffer: Buffer; path: string }> {
  const ffmpegPath = getFfmpegPath();

  const arrayBuffer = await audioBlob.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp}.webm`);
  const outputPath = path.join(tempDir, `output_${timestamp}.mp3`);

  fs.writeFileSync(inputPath, inputBuffer);

  // 转换为 MP3 格式
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 -b:a 64k "${outputPath}"`;

  execSync(cmd, { stdio: 'pipe' });

  const mp3Buffer = fs.readFileSync(outputPath);

  // 清理输入文件，保留输出文件（异步任务需要）
  try {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  } catch (e) {
    log.warn('[FFmpeg] Cleanup error:', e);
  }

  return { buffer: mp3Buffer, path: outputPath };
}
