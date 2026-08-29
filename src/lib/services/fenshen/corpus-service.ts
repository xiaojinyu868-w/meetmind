/**
 * 私有轨语料管线（P2）—— 把用户自己的老师素材变成 nuwa 的纯本地语料。
 *
 * bilibili：B站链接 → resolveBilibiliUrl / fetchViewMeta → 官方字幕完整则直接
 *   用作语料（免下载免 ASR）；否则 fetchPlayurlAudio → downloadBiliAudio →
 *   ffmpeg 转 16k 单声道 mp3 → DashScope filetrans 异步转写 → 逐句 txt。
 * upload：/api/upload-audio 的产物（public/temp-audio/<fileName>，sourceRef
 *   可以是 fileName 或完整 fileUrl）→ 转 mp3 → 同上 filetrans 转写。
 *   原始上传文件保留（temp-audio 自有过期清理），只删转码中间产物。
 *
 * 统一产出：data/fenshen-codex/<egoId>/work/sources/transcripts/<来源>.txt
 * （nuwa 纯本地语料目录约定；distill 启动消息已声明"素材在 sources/transcripts/"）。
 *
 * 长音频转写是分钟级操作：路由不直接 await prepareCorpus，而是 fire-and-forget
 * runPrivateCorpusPipeline（POST 先返回 ego status=learning；后台 语料→蒸馏，
 * 语料失败置 ego failed + failReason + SSE error 事件）。
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import {
  BilibiliImportError,
  downloadBiliAudio,
  fetchPlayerSubtitle,
  fetchPlayurlAudio,
  fetchViewMeta,
  resolveBilibiliUrl,
  type BilibiliSubtitleResult,
} from '../bilibili-import-service';
import {
  MediaToolError,
  resolvePublicBaseUrl,
  safeUnlink,
  transcodeToMp3,
} from '../media-tooling';
import { submitAsyncTask, waitForTask } from '../qwen-asr-tasks';
import { publishFenshenEvent, type FenshenStreamEvent } from './event-bus';
import { egoPaths } from './fenshen-config';
import { startDistillation } from './distill-service';
import * as store from './thread-store';

const log = createLogger('fenshen-corpus');

/**
 * 语料中间产物目录：必须与 /api/upload-audio 同一处（public/temp-audio），
 * 因为 DashScope filetrans 需要经 PUBLIC_DOMAIN 公网 URL 拉取音频，
 * 而 public/ 下的文件按 /temp-audio/<name> 暴露。
 */
const UPLOAD_DIR =
  process.env.FENSHEN_UPLOAD_AUDIO_DIR || path.join(process.cwd(), 'public', 'temp-audio');

/** filetrans 轮询上限（长讲座转写是分钟级，默认 30 分钟） */
const ASR_MAX_WAIT_MS = Number.parseInt(
  process.env.FENSHEN_ASR_MAX_WAIT_MS || `${30 * 60 * 1000}`,
  10,
);

const MIN_AUDIO_BYTES = 10 * 1024; // 小于 10KB 的音频必然坏了

export interface TranscriptSentence {
  text: string;
  beginTime: number;
  endTime: number;
}

export type CorpusProgress = (note: string) => void;

// ---------- 纯函数（单测直接覆盖） ----------

/** upload 的 sourceRef 可以是裸 fileName 或完整 fileUrl；防路径遍历 */
export function resolveUploadFileName(sourceRef: string): string {
  const raw = sourceRef.trim();
  if (!raw) {
    throw new store.FenshenServiceError('corpus-upload-empty', '缺少上传文件引用（sourceRef）', 400);
  }
  let name = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      name = decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? '');
    } catch {
      throw new store.FenshenServiceError('corpus-upload-invalid', '无法解析上传文件地址', 400);
    }
  }
  const base = path.basename(name);
  if (!base || base !== name || base.startsWith('.')) {
    throw new store.FenshenServiceError('corpus-upload-invalid', '上传文件名不合法', 400);
  }
  return base;
}

/**
 * 官方字幕可用性（照 video/import 的兜底策略，简化版）：
 * 段数够 + 时间覆盖率够才算完整，避免概述型字幕被误当完整转录。
 */
export function subtitleUsable(
  subtitle: BilibiliSubtitleResult | null,
  durationSec?: number,
): boolean {
  const segments = subtitle?.segments ?? [];
  if (segments.length === 0) return false;
  if (!durationSec || durationSec <= 0) return segments.length >= 4;
  const minCount = durationSec > 60 ? Math.max(6, Math.floor(durationSec / 18)) : 4;
  if (segments.length < minCount) return false;
  const spanMs = Math.max(0, segments[segments.length - 1].endMs - segments[0].startMs);
  const coverage = spanMs / (durationSec * 1000);
  return coverage >= (durationSec > 120 ? 0.7 : 0.55);
}

/** 语料文件名：<sourceType>-<hint>.txt（保留中英文/数字/._-，其余折叠） */
export function buildTranscriptFileName(sourceType: 'bilibili' | 'upload', hint: string): string {
  const safe = hint.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 80);
  return `${sourceType}-${safe || 'corpus'}.txt`;
}

/** txt 正文：# 开头的来源头 + 逐句一行（nuwa 纯本地语料直接读） */
export function buildTranscriptText(header: string[], sentences: TranscriptSentence[]): string {
  const lines = sentences.map((s) => s.text.trim()).filter(Boolean);
  const head = header.map((line) => `# ${line}`).join('\n');
  return `${head}\n\n${lines.join('\n')}\n`;
}

// ---------- 内部步骤 ----------

async function writeTranscript(
  egoId: string,
  fileName: string,
  text: string,
): Promise<string> {
  const dir = path.join(egoPaths(egoId).workDir, 'sources', 'transcripts');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), text, 'utf8');
  log.info('transcript written', { egoId, fileName, chars: text.length });
  return fileName;
}

/** DashScope filetrans 异步转写（整文件一个任务，不切分）；失败抛人可读错误 */
async function transcribeAudioFile(audioPath: string): Promise<TranscriptSentence[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new store.FenshenServiceError(
      'corpus-asr-no-key',
      '未配置 DASHSCOPE_API_KEY，无法转写音频',
      500,
    );
  }
  const pub = resolvePublicBaseUrl();
  if (!pub.ok || !pub.baseUrl) {
    throw new store.FenshenServiceError(
      'corpus-asr-no-public-url',
      `转写服务需要公网可访问的音频地址（${pub.error ?? 'PUBLIC_DOMAIN 未配置'}）`,
      500,
    );
  }
  const fileUrl = `${pub.baseUrl}/temp-audio/${encodeURIComponent(path.basename(audioPath))}`;

  const submit = await submitAsyncTask(fileUrl, apiKey, 'zh');
  if (!submit.success || !submit.taskId) {
    throw new store.FenshenServiceError(
      'corpus-asr-submit-failed',
      `转写任务提交失败：${(submit.error ?? '未知原因').slice(0, 120)}`,
      502,
    );
  }

  const result = await waitForTask(submit.taskId, apiKey, undefined, ASR_MAX_WAIT_MS);
  if (!result.success || result.sentences.length === 0) {
    throw new store.FenshenServiceError(
      'corpus-asr-failed',
      `转写失败：${(result.error ?? '结果为空').slice(0, 120)}`,
      502,
    );
  }
  return result.sentences.map((s) => ({
    text: s.text,
    beginTime: s.beginTime,
    endTime: s.endTime,
  }));
}

async function prepareBilibiliCorpus(
  ego: store.FenshenEgoRow,
  onProgress: CorpusProgress,
): Promise<string[]> {
  onProgress('正在解析 B 站链接…');
  const resolved = await resolveBilibiliUrl(ego.sourceRef);
  const meta = await fetchViewMeta(resolved.bvid, resolved.page);

  // 1. 官方字幕捷径：完整字幕直接当语料，免下载免 ASR
  try {
    const subtitle = await fetchPlayerSubtitle(meta.bvid, meta.cid);
    if (subtitleUsable(subtitle, meta.durationSec)) {
      onProgress('检测到完整官方字幕，直接作为语料');
      const fileName = buildTranscriptFileName('bilibili', `${meta.bvid}-p${meta.page}`);
      await writeTranscript(
        ego.id,
        fileName,
        buildTranscriptText(
          [
            `来源：B站 ${meta.title ?? meta.bvid}（${meta.resolvedUrl}）`,
            `字幕：${subtitle?.language ?? 'unknown'}，转写时间：${new Date().toISOString()}`,
          ],
          subtitle?.segments.map((s) => ({
            text: s.text,
            beginTime: s.startMs,
            endTime: s.endMs,
          })) ?? [],
        ),
      );
      return [fileName];
    }
  } catch (cause) {
    log.info('subtitle unavailable, fallback to ASR', {
      egoId: ego.id,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }

  // 2. 音频 → ASR
  onProgress('正在下载音频…');
  const audio = await fetchPlayurlAudio(meta.bvid, meta.cid);
  const baseName = `fenshen_${ego.id}_${Date.now()}`;
  const rawPath = path.join(UPLOAD_DIR, `${baseName}_raw${audio.ext || '.m4s'}`);
  const mp3Path = path.join(UPLOAD_DIR, `${baseName}.mp3`);
  try {
    await downloadBiliAudio(audio.audioUrl, rawPath);
    const rawStat = await stat(rawPath).catch(() => null);
    if (!rawStat || rawStat.size < MIN_AUDIO_BYTES) {
      throw new store.FenshenServiceError('corpus-bili-audio-incomplete', 'B站音频下载不完整', 502);
    }
    await transcodeToMp3(rawPath, mp3Path);
    onProgress('正在转写音频（分钟级，请耐心等待）…');
    const sentences = await transcribeAudioFile(mp3Path);
    const fileName = buildTranscriptFileName('bilibili', `${meta.bvid}-p${meta.page}`);
    await writeTranscript(
      ego.id,
      fileName,
      buildTranscriptText(
        [
          `来源：B站 ${meta.title ?? meta.bvid}（${meta.resolvedUrl}）`,
          `ASR 转写，转写时间：${new Date().toISOString()}`,
        ],
        sentences,
      ),
    );
    return [fileName];
  } finally {
    safeUnlink(rawPath);
    safeUnlink(mp3Path);
  }
}

async function prepareUploadCorpus(
  ego: store.FenshenEgoRow,
  onProgress: CorpusProgress,
): Promise<string[]> {
  const fileName = resolveUploadFileName(ego.sourceRef);
  const srcPath = path.join(UPLOAD_DIR, fileName);
  const srcStat = await stat(srcPath).catch(() => null);
  if (!srcStat || !srcStat.isFile()) {
    throw new store.FenshenServiceError(
      'corpus-upload-missing',
      '录音文件不存在或已过期，请重新上传',
      404,
    );
  }
  if (srcStat.size < 1024) {
    throw new store.FenshenServiceError('corpus-upload-broken', '录音文件过小或已损坏', 400);
  }

  const mp3Path = path.join(UPLOAD_DIR, `fenshen_${ego.id}_${Date.now()}.mp3`);
  try {
    onProgress('正在处理录音…');
    await transcodeToMp3(srcPath, mp3Path);
    onProgress('正在转写录音（分钟级，请耐心等待）…');
    const sentences = await transcribeAudioFile(mp3Path);
    const outName = buildTranscriptFileName('upload', fileName.replace(/\.[^.]+$/, ''));
    await writeTranscript(
      ego.id,
      outName,
      buildTranscriptText(
        [`来源：上传录音 ${fileName}`, `ASR 转写，转写时间：${new Date().toISOString()}`],
        sentences,
      ),
    );
    return [outName];
  } finally {
    safeUnlink(mp3Path); // 原始上传文件保留
  }
}

/** 语料就绪主入口：按 sourceType 分派，返回写入 transcripts/ 的文件名列表 */
export async function prepareCorpus(
  ego: store.FenshenEgoRow,
  onProgress: CorpusProgress = () => {},
): Promise<string[]> {
  if (ego.sourceType === 'bilibili') return prepareBilibiliCorpus(ego, onProgress);
  if (ego.sourceType === 'upload') return prepareUploadCorpus(ego, onProgress);
  throw new store.FenshenServiceError(
    'corpus-source-unsupported',
    `语料管线不支持 sourceType=${ego.sourceType}`,
    400,
  );
}

/** 归一化为人可读错误（Bilibili/MediaTool 错误本身已是中文消息） */
function toReadableError(cause: unknown): Error {
  if (cause instanceof store.FenshenServiceError) return cause;
  if (cause instanceof BilibiliImportError || cause instanceof MediaToolError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new store.FenshenServiceError(
    'corpus-internal',
    `语料准备失败：${message.slice(0, 120)}`,
    500,
  );
}

/**
 * 私有轨后台管线（fire-and-forget）：语料就绪 → 起蒸馏线程。
 * 语料失败：ego status=failed + failReason 落库 + SSE error 事件（人可读）；
 * 蒸馏启动失败由 startDistillation 内部自行落 failed + 发事件。
 */
export async function runPrivateCorpusPipeline(egoId: string): Promise<void> {
  const ego = await store.getEgo(egoId);
  if (!ego) return;

  const emit = (event: FenshenStreamEvent) => {
    publishFenshenEvent(egoId, event);
    store.appendEgoEvent(egoId, event).catch((cause) => {
      log.warn('event append failed', {
        egoId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  };
  const progress: CorpusProgress = (note) => emit({ type: 'distill-progress', note });

  try {
    progress('正在准备语料…');
    const files = await prepareCorpus(ego, progress);
    progress(`语料就绪（${files.length} 份转录），开始蒸馏`);
    log.info('corpus ready', { egoId, files });
  } catch (cause) {
    const error = toReadableError(cause);
    await store
      .setEgoStatus(egoId, 'failed', { failReason: error.message.slice(0, 200) })
      .catch(() => {});
    emit({ type: 'error', message: error.message.slice(0, 120) });
    log.warn('corpus pipeline failed', { egoId, error: error.message });
    return;
  }

  try {
    await startDistillation(egoId);
  } catch (cause) {
    // startDistillation 内部已置 failed + 发 error 事件，这里只记账
    log.warn('distill kickoff after corpus failed', {
      egoId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
