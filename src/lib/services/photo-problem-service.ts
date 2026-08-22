/**
 * Photo Problem 服务 —— 拍题开讲第一步：审题（VLM 结构化提取）。
 *
 * 架构依据 docs/BOARD_TUTOR_ARCHITECTURE.md L2「拍题开讲」：
 * 图片 → 结构化题目（题干 LaTeX + 图形描述 + 学生已写尝试）→ 独立解题锚定
 * → BoardScript。本文件只负责第一段。
 *
 * 模型：默认 qwen3.7-plus（2026-06，百炼当前最强多模态；env
 * BOARD_PHOTO_VL_MODEL 可覆盖，A/B 时切 qwen3-vl-plus）。走 llm-service
 * chat（OpenAI 兼容 image_url），复用 DASHSCOPE_API_KEY。
 */

import { createLogger } from '@/lib/logger';
import { chat } from './llm-service';

const log = createLogger('photo-problem');

/** 拍题审题用多模态模型（优先级：BOARD_PHOTO_VL_MODEL > DASHSCOPE_VL_MODEL > qwen3.7-plus） */
const PHOTO_VL_MODEL =
  process.env.BOARD_PHOTO_VL_MODEL?.trim() ||
  process.env.DASHSCOPE_VL_MODEL?.trim() ||
  'qwen3.7-plus';

const MAX_STATEMENT_CHARS = 1200;
const MAX_FIELD_CHARS = 400;
const MAX_SPEC_CHARS = 800;

export interface PhotoProblem {
  /** 学科（数学/物理/化学/英语/语文/其他） */
  subject: string;
  /** 题目完整文本，公式用 LaTeX（$...$） */
  statement: string;
  /** 图形/图表描述（无图则为空） */
  figureDesc?: string;
  /** 结构化图形档案（几何/函数题）：关键点与坐标、线/角关系、标注的量 */
  figureSpec?: string;
  /** 照片里学生已经写下的尝试/草稿（没有则为空） */
  studentAttempt?: string;
}

export function getPhotoVlModel(): string {
  return PHOTO_VL_MODEL;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 解析审题 VLM 输出（纯函数，可单测）：
 * 容错剥围栏取第一个 JSON 对象；isProblem=false / statement 为空 → null
 * （调用方按"这张照片里没有题"处理）。
 */
export function parsePhotoProblemResponse(raw: string): PhotoProblem | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (parsed.isProblem === false) return null;

  const statement = clip(parsed.statement, MAX_STATEMENT_CHARS);
  if (!statement) return null;

  return {
    subject: clip(parsed.subject, 20) || '数学',
    statement,
    figureDesc: clip(parsed.figureDesc, MAX_FIELD_CHARS) || undefined,
    figureSpec: clip(parsed.figureSpec, MAX_SPEC_CHARS) || undefined,
    studentAttempt: clip(parsed.studentAttempt, MAX_FIELD_CHARS) || undefined,
  };
}

const EXTRACT_PROMPT = [
  '你是一位老师，学生拍了一张照片向你请教。请看清照片内容，只输出一个 JSON 对象（不要 markdown 代码围栏）：',
  '{"isProblem":true|false,"subject":"数学|物理|化学|英语|语文|其他","statement":"题目完整文本","figureDesc":"图形或图表的一句话描述","figureSpec":"结构化图形档案","studentAttempt":"照片里学生已经写下的解答尝试"}',
  '要求：',
  '1. statement 必须逐字忠实于照片（数学公式用 LaTeX，行内 $...$）；印刷体与手写体都要认；看不清的字符用 ? 标出，绝不编造。',
  '2. 照片里有图形（几何图、函数图、图表）时，figureDesc 用一句话说清图形内容；同时给 figureSpec 结构化档案（纯文本，尽量精确）：关键点及坐标/位置、线段与角度关系（平行/垂直/相等/相切等）、图上标注的量（长度、角度、函数式）。没有图就两个字段都留空字符串。',
  '3. 照片里除了题目还有学生手写的解题过程/草稿/答案时，逐字转录到 studentAttempt（公式同样 LaTeX）；没有就留空字符串。',
  '4. 照片里根本没有题目（风景、人物、纯笔记页等），只输出 {"isProblem":false}。',
].join('\n');

export interface ExtractProblemParams {
  /** data:image/...;base64,... */
  imageDataUrl: string;
  model?: string;
}

export async function extractProblemFromImage(params: ExtractProblemParams): Promise<PhotoProblem | null> {
  const startedAt = Date.now();
  const model = params.model?.trim() || PHOTO_VL_MODEL;
  const response = await chat(
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: params.imageDataUrl } },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      },
    ],
    model,
    { temperature: 0.1, maxTokens: 1500, responseFormat: 'json_object' },
  );
  const problem = parsePhotoProblemResponse(response.content);
  log.info('photo-problem.extracted', {
    model: response.model,
    ms: Date.now() - startedAt,
    isProblem: Boolean(problem),
    subject: problem?.subject,
    hasFigure: Boolean(problem?.figureDesc),
    hasAttempt: Boolean(problem?.studentAttempt),
  });
  return problem;
}
