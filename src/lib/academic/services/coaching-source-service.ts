/**
 * coaching-source-service: 老师辅导视频 → 结构化理解
 *
 * 端到端：
 *   1) 读 OrgAsset(video/audio) 到本地文件
 *   2) ffprobe 拿时长
 *   3) ffmpeg 按段切分（默认每段 60s，小样本一段即可）
 *   4) 每段抽关键帧（≤ 16 张）保存到 storage/orgs/<orgId>/frames/<sourceId>/seg_<i>_f_<j>.jpg
 *   5) 每段文本（若有转录）+ 关键帧 →（方案 A）如果 asset.publicUrl 可用且视频 ≤ 50MB，直接送 qwen3.5-plus 的 video_url；否则送帧数组
 *   6) 每段 LLM 返回 { questionPatterns, feedbackPatterns, judgmentCues, followUpCues, summary }
 *   7) 聚合成 CoachingSource.analysisJson，status=ready
 *
 * V0 简化：不做转录（若 transcript 为空就直接视觉理解视频段）。黄金样本 video1.mp4 走这条即可。
 * 后续 P3 可接 MeetMind 的 ASR。
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';
import { orgAssetService, STORAGE_ROOT } from './org-asset-service';
import { chat, type ChatMessage, type MultimodalContent } from '@/lib/services/llm-service';
import { VIDEO_UNDERSTAND_MODEL, SYNTHESIS_MODEL } from '../models';
import { resolveFfmpegPath, resolveFfprobePath, runCommand } from '@/lib/services/media-tooling';

// --------- 段级理解的 LLM 提示 ---------

const SEGMENT_SYSTEM_PROMPT = `你是一位教育服务机构的资深教研官，任务是看一段老师辅导学生的录像，提炼出「这位老师是怎么教的」。

严格按照下列 JSON 结构输出（不要任何 markdown 代码框）：
{
  "summary": "这段视频里老师做了什么（不超过 80 字）",
  "questionPatterns": ["这位老师提问方式的典型模式，每条一个具体例子（摘自视频）"],
  "followUpPatterns": ["老师如何追问、如何在学生答不上来时推进的具体做法"],
  "feedbackPatterns": ["老师给反馈的结构与语气示例"],
  "judgmentCues": ["老师用了哪些判断依据来评价学生（研究深度 / 表达清晰 / 动机匹配 等）"],
  "forbiddenSignals": ["老师表现出的边界——哪些判断他明确不替学生做"],
  "keyMoments": [{"at":"时间或片段标记","what":"发生了什么关键转折"}]
}

注意：
- 不要泛泛而谈，必须给出可复用的具体表达
- 如果视频很短，字段可以为空数组但不能省略
- 只从视频里提取，不要编造`;

const SOURCE_SYNTHESIS_SYSTEM_PROMPT = `你是一位 Coaching Persona 架构师。你将看到多段视频的分析结果，请把它们融合成一份「这位老师的完整辅导画像」。

严格输出 JSON：
{
  "teacherStyle": {
    "tone": "gentle/direct/probing/structured 中的一个",
    "style": "socratic/mentor/interviewer/reviewer 中的一个",
    "signatureOpening": "老师常用的开场表述（若有）",
    "voiceSummary": "用一段话概括这位老师的整体风格（不超过 100 字）"
  },
  "questionPatterns": ["综合所有段落提炼出的 3-7 条提问范式"],
  "feedbackPatterns": ["综合所有段落的反馈范式 3-7 条"],
  "judgmentCues": ["老师的核心判断依据 3-7 条"],
  "forbiddenZones": ["老师的边界/禁区"],
  "signaturePhrases": ["老师常用的 2-5 句招牌表达"]
}

只从给你的段级分析输入中聚合，不要编造。`;

interface SegmentAnalysis {
  summary: string;
  questionPatterns: string[];
  followUpPatterns: string[];
  feedbackPatterns: string[];
  judgmentCues: string[];
  forbiddenSignals: string[];
  keyMoments: { at: string; what: string }[];
}

export interface CoachingSourceAnalysis {
  segmentCount: number;
  segments: SegmentAnalysis[];
  teacherStyle: {
    tone: 'gentle' | 'direct' | 'probing' | 'structured';
    style: 'socratic' | 'mentor' | 'interviewer' | 'reviewer';
    signatureOpening: string;
    voiceSummary: string;
  };
  questionPatterns: string[];
  feedbackPatterns: string[];
  judgmentCues: string[];
  forbiddenZones: string[];
  signaturePhrases: string[];
  mediaMetadata: {
    durationSec: number;
    segmentSpans: { index: number; startSec: number; endSec: number; frameCount: number }[];
  };
}

// --------- 工具 ---------

async function getVideoDurationSec(abs: string): Promise<number> {
  const ffmpegPath = resolveFfmpegPath();

  // 先尝试 ffprobe（如果系统里有）
  try {
    const ffprobePath = resolveFfprobePath(ffmpegPath);
    const res = await runCommand(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      abs,
    ]);
    const sec = parseFloat((res.stdout || '').trim());
    if (Number.isFinite(sec) && sec > 0) return sec;
  } catch {
    // fall through
  }

  // Fallback：用 ffmpeg 自己解析 Duration 行
  // `ffmpeg -i <path>` 会把元信息打到 stderr，并以 exit code 1 退出（没有指定 -f null /dev/null），我们直接捕获 stderr
  try {
    const stderr = await new Promise<string>((resolve) => {
      const child = spawn(ffmpegPath, ['-i', abs], { windowsHide: true });
      let out = '';
      child.stderr.on('data', (c) => { out += c.toString(); });
      child.on('close', () => resolve(out));
      child.on('error', () => resolve(out));
    });
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      const h = parseInt(m[1], 10);
      const mi = parseInt(m[2], 10);
      const s = parseFloat(m[3]);
      return h * 3600 + mi * 60 + s;
    }
  } catch {}
  return 0;
}

async function extractFrames(opts: {
  ffmpegPath: string;
  inputPath: string;
  startSec: number;
  durationSec: number;
  outDir: string;
  fps: number;
  maxFrames: number;
}): Promise<string[]> {
  await fs.mkdir(opts.outDir, { recursive: true });
  const outPattern = path.join(opts.outDir, 'f_%03d.jpg');
  await runCommand(opts.ffmpegPath, [
    '-ss', String(opts.startSec),
    '-t', String(opts.durationSec),
    '-i', opts.inputPath,
    '-vf', `fps=${opts.fps}`,
    '-frames:v', String(opts.maxFrames),
    '-q:v', '5',
    '-y',
    outPattern,
  ]);
  const files = (await fs.readdir(opts.outDir)).filter((f) => f.endsWith('.jpg')).sort();
  return files.map((f) => path.join(opts.outDir, f));
}

async function readImageAsDataUrl(abs: string): Promise<string> {
  const buf = await fs.readFile(abs);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 尝试从 markdown 代码块里抽
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) {
      try {
        return JSON.parse(m[1]) as T;
      } catch {}
    }
    return fallback;
  }
}

// --------- 服务 ---------

export const coachingSourceService = {
  /**
   * 列出当前机构的所有 CoachingSource（基础版，前端列表用）
   */
  async listByOrg(orgId: string) {
    return prisma.coachingSource.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { id: true, nickname: true, username: true } } },
    });
  },

  async getById(orgId: string, id: string) {
    const row = await prisma.coachingSource.findUnique({ where: { id } });
    if (!row || row.orgId !== orgId) throw new AcademicError('NOT_FOUND', 'CoachingSource 不存在');
    return row;
  },

  /**
   * 从 asset 建立 CoachingSource（挂接而非复制）
   */
  async createFromAsset(orgId: string, uploadedBy: string, assetId: string, title?: string) {
    const asset = await orgAssetService.getById(orgId, assetId);
    if (asset.kind !== 'video' && asset.kind !== 'audio') {
      throw new AcademicError('INVALID_INPUT', 'CoachingSource 必须基于 video 或 audio 资产');
    }
    const row = await prisma.coachingSource.create({
      data: {
        orgId,
        uploadedBy,
        assetId: asset.id,
        title: (title || asset.title).trim(),
        mediaUrl: asset.publicUrl || null,
        status: 'pending',
      },
    });
    return row;
  },

  /**
   * 处理一个 CoachingSource：切段 → 抽帧 → 段级 LLM 分析 → 聚合风格
   */
  async analyze(orgId: string, sourceId: string): Promise<CoachingSourceAnalysis> {
    const source = await this.getById(orgId, sourceId);
    if (!source.assetId) throw new AcademicError('INVALID_INPUT', 'CoachingSource 没有关联 asset');
    const asset = await orgAssetService.getById(orgId, source.assetId);
    if (!asset.storagePath) throw new AcademicError('INVALID_INPUT', 'asset 不是文件类型，无法分析');

    await prisma.coachingSource.update({
      where: { id: sourceId },
      data: { status: 'analyzing' },
    });

    try {
      const abs = path.join(STORAGE_ROOT, asset.storagePath);
      const ffmpegPath = resolveFfmpegPath();

      const duration = await getVideoDurationSec(abs);
      if (duration <= 0) throw new AcademicError('INVALID_INPUT', '无法读取视频时长');

      // 切段策略：默认每段 60s，但短于 60s 只 1 段，总段数 ≤ 6（V0 控制成本）
      const SEG_SEC = 60;
      const MAX_SEGMENTS = 6;
      const segmentCount = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(duration / SEG_SEC)));
      const perSeg = duration / segmentCount;

      const framesRoot = path.join(STORAGE_ROOT, 'orgs', orgId, 'frames', sourceId);
      // 清理上次
      await fs.rm(framesRoot, { recursive: true, force: true });

      const segmentResults: SegmentAnalysis[] = [];
      const segmentSpans: CoachingSourceAnalysis['mediaMetadata']['segmentSpans'] = [];

      for (let i = 0; i < segmentCount; i++) {
        const startSec = Math.floor(i * perSeg);
        const durSec = Math.min(perSeg, duration - startSec);
        // 每 5s 抽 1 帧，最多 12 帧
        const fps = 1 / 5;
        const maxFrames = 12;
        const segDir = path.join(framesRoot, `seg_${i}`);
        const framePaths = await extractFrames({
          ffmpegPath,
          inputPath: abs,
          startSec,
          durationSec: durSec,
          outDir: segDir,
          fps,
          maxFrames,
        });
        if (framePaths.length === 0) continue;

        // 构造 vision 多模态输入：qwen3.5-plus 接受 image_url data URL 列表
        const imageParts: MultimodalContent[] = [];
        for (const fp of framePaths.slice(0, maxFrames)) {
          const dataUrl = await readImageAsDataUrl(fp);
          imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
        }

        const userMsg: ChatMessage = {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `这是一段老师辅导学生的视频的第 ${i + 1} / ${segmentCount} 段（从 ${startSec}s 到 ${startSec + durSec | 0}s）。请按 system 指令分析这位老师的教学方式。`,
            },
            ...imageParts,
          ],
        };

        const resp = await chat(
          [
            { role: 'system', content: SEGMENT_SYSTEM_PROMPT },
            userMsg,
          ],
          VIDEO_UNDERSTAND_MODEL,
          { temperature: 0.3, responseFormat: 'json_object', maxTokens: 1800 },
        );

        const seg = safeJsonParse<SegmentAnalysis>(resp.content, {
          summary: '',
          questionPatterns: [],
          followUpPatterns: [],
          feedbackPatterns: [],
          judgmentCues: [],
          forbiddenSignals: [],
          keyMoments: [],
        });
        segmentResults.push(seg);
        segmentSpans.push({
          index: i,
          startSec,
          endSec: startSec + durSec,
          frameCount: framePaths.length,
        });
      }

      // 段落合成：让 LLM 用纯文本聚合（不再看图片，节省成本）
      const synthesisInput = segmentResults
        .map(
          (s, i) =>
            `段 ${i + 1}: ${s.summary}\n提问：${(s.questionPatterns || []).join(' | ')}\n追问：${(s.followUpPatterns || []).join(' | ')}\n反馈：${(s.feedbackPatterns || []).join(' | ')}\n判断：${(s.judgmentCues || []).join(' | ')}\n边界：${(s.forbiddenSignals || []).join(' | ')}`,
        )
        .join('\n\n');

      const synthResp = await chat(
        [
          { role: 'system', content: SOURCE_SYNTHESIS_SYSTEM_PROMPT },
          { role: 'user', content: synthesisInput || '（无段级分析）' },
        ],
        SYNTHESIS_MODEL,
        { temperature: 0.3, responseFormat: 'json_object', maxTokens: 2000 },
      );
      const synth = safeJsonParse<Omit<CoachingSourceAnalysis, 'segments' | 'segmentCount' | 'mediaMetadata'>>(
        synthResp.content,
        {
          teacherStyle: { tone: 'direct', style: 'mentor', signatureOpening: '', voiceSummary: '' },
          questionPatterns: [],
          feedbackPatterns: [],
          judgmentCues: [],
          forbiddenZones: [],
          signaturePhrases: [],
        },
      );

      const analysis: CoachingSourceAnalysis = {
        segmentCount: segmentResults.length,
        segments: segmentResults,
        mediaMetadata: { durationSec: duration, segmentSpans },
        ...synth,
      };

      await prisma.coachingSource.update({
        where: { id: sourceId },
        data: {
          status: 'ready',
          analysisJson: JSON.stringify(analysis),
        },
      });

      // 自动把这段视频落成机构默认的 published 场景，学生端无需手动选/配
      // 故意不 await 阻塞返回——失败也不影响本次分析结果
      try {
        const { defaultScenarioService } = await import('./default-scenario-service');
        await defaultScenarioService.ensure(orgId, sourceId, analysis, source.title);
      } catch (ensureErr) {
        console.warn('[coaching-source] ensureDefaultScenario failed:', ensureErr);
      }

      return analysis;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.coachingSource.update({
        where: { id: sourceId },
        data: { status: 'failed' },
      });
      throw new AcademicError('INTERNAL', `视频理解失败：${msg}`);
    }
  },
};

export type CoachingSourceService = typeof coachingSourceService;
