/**
 * dashscope-podcast — 用百炼 qwen3-tts 把双主播脚本逐句合成并拼接成一期播客。
 *
 * 背景：火山 podcasttts 一键出成品的路由在账号未开通资源时直接 403
 * （requested resource not granted）。DashScope 没有"整期播客"的一键 API，
 * 但有按句 TTS——脚本是结构化 {speaker, text}[]，逐句换音色合成 + ffmpeg
 * 拼接，效果等价，且复用已付费的 DASHSCOPE_API_KEY，零新增凭证。
 *
 * 合成复用 teach 线实测过的 qwen3-tts-instruct-flash（选型见 out/tts-spike/REPORT.md：
 * 1 元/万字符、单句 1-3s）；双主播音色 Cherry / Ethan，env 可覆盖。
 *
 * 拼接：逐句 wav 写临时目录 → ffmpeg concat → 单文件 mp3 → 持久化到
 * public/uploads/podcast/，经 /api/podcast/audio/{file} 路由交付（运行时生成的
 * 文件走 public 静态会 404，与信息图同一理由）。
 */

import { createLogger } from '@/lib/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const log = createLogger('dashscope-podcast');
const execFileAsync = promisify(execFile);

const QWEN_TTS_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const TTS_MODEL = (process.env.PODCAST_TTS_MODEL || 'qwen3-tts-instruct-flash').trim();
const HOST_A_VOICE = (process.env.PODCAST_TTS_VOICE_A || 'Cherry').trim();
const HOST_B_VOICE = (process.env.PODCAST_TTS_VOICE_B || 'Ethan').trim();
const PER_LINE_TIMEOUT_MS = 30_000;
const MAX_LINE_CHARS = 300;
/** 逐句合成串行闸：对齐 teach-tts 的 428 教训，突发并发会吃上游惩罚性限流 */
const INTER_LINE_GAP_MS = 150;

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'podcast');

export interface PodcastScriptLine {
  speaker: string;
  text: string;
}

export interface DashscopePodcastResult {
  audioUrl: string;
  audioBytes: number;
  lines: PodcastScriptLine[];
  failedLines: number;
}

export function isDashscopePodcastEnabled(): boolean {
  return Boolean((process.env.DASHSCOPE_API_KEY || '').trim());
}

/** 把脚本里的说话人映射到两个音色：第一个出现的说话人 → 音色 A，第二个 → B。 */
function buildVoiceMap(lines: PodcastScriptLine[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const speaker = line.speaker.trim() || 'Host';
    if (!map.has(speaker)) {
      map.set(speaker, map.size % 2 === 0 ? HOST_A_VOICE : HOST_B_VOICE);
    }
  }
  return map;
}

async function synthesizeLine(
  apiKey: string,
  text: string,
  voice: string,
): Promise<Buffer | null> {
  try {
    const response = await fetch(QWEN_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: {
          text,
          voice,
          language_type: 'Chinese',
          instruct: '你在录制一期轻松的学习对谈播客，语气自然、像聊天，不要播音腔',
        },
      }),
      signal: AbortSignal.timeout(PER_LINE_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn('tts http 失败', { status: response.status, voice });
      return null;
    }
    const data = (await response.json()) as {
      output?: { audio?: { url?: string } };
      message?: string;
      code?: string;
    };
    const url = data.output?.audio?.url;
    if (!url) {
      log.warn('tts 无音频 url', { error: data.message ?? data.code });
      return null;
    }
    const audioResponse = await fetch(url, { signal: AbortSignal.timeout(PER_LINE_TIMEOUT_MS) });
    if (!audioResponse.ok) return null;
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    return audio.length > 0 ? audio : null;
  } catch (cause) {
    log.warn('tts 请求异常', { error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/**
 * 合成一期播客：逐句合成 → ffmpeg 拼接 → 持久化。
 * 任一句合成失败即整期失败（半成品播客比明确报错更糟——前端契约是"不出音频不算好"）。
 */
export async function generateDashscopePodcast(
  lines: PodcastScriptLine[],
): Promise<DashscopePodcastResult> {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');

  const usable = lines
    .map((line) => ({ speaker: line.speaker.trim() || 'Host', text: line.text.trim() }))
    .filter((line) => line.text && line.text.length <= MAX_LINE_CHARS)
    .slice(0, 42);
  if (usable.length < 2) throw new Error('播客脚本为空或单句过长');

  const voiceMap = buildVoiceMap(usable);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-tts-'));
  const partPaths: string[] = [];

  try {
    for (let i = 0; i < usable.length; i += 1) {
      const line = usable[i];
      const voice = voiceMap.get(line.speaker) || HOST_A_VOICE;
      let audio: Buffer | null = null;
      for (const waitMs of [0, 1000, 2000]) {
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        audio = await synthesizeLine(apiKey, line.text, voice);
        if (audio) break;
      }
      if (!audio) {
        throw new Error(`第 ${i + 1} 句合成失败（共 ${usable.length} 句）`);
      }
      const partPath = path.join(tmpDir, `part-${String(i).padStart(3, '0')}.wav`);
      fs.writeFileSync(partPath, audio);
      partPaths.push(partPath);
      if (INTER_LINE_GAP_MS > 0 && i < usable.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, INTER_LINE_GAP_MS));
      }
    }

    const listFile = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(
      listFile,
      partPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    );
    const outFile = path.join(tmpDir, 'podcast.mp3');
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-codec:a', 'libmp3lame', '-q:a', '4', outFile,
    ], { timeout: 60_000 });

    const merged = fs.readFileSync(outFile);
    if (merged.length === 0) throw new Error('ffmpeg 拼接产物为空');

    const filename = `podcast-${Date.now()}.mp3`;
    fs.mkdirSync(BASE_DIR, { recursive: true });
    fs.writeFileSync(path.join(BASE_DIR, filename), merged);

    return {
      audioUrl: `/api/podcast/audio/${filename}`,
      audioBytes: merged.length,
      lines: usable,
      failedLines: 0,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
