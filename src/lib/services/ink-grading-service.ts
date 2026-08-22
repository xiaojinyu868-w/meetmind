/**
 * Ink Grading 服务 —— 学生板演批改（Practice 场景闭环，对齐 AmIWrite 的
 * practice：学生独立解题 → 导师 in-situ 打勾叉 + 口头点评）。
 *
 * 链路：板面笔迹栅格化（客户端，叠 6×4 网格）→ qwen3.7-plus 多模态
 * （复用 DASHSCOPE_API_KEY，走 llm-service chat）→ 严格 JSON → 清洗
 * （cell 越界/未知类型丢弃，marks 上限 4）。
 *
 * 空间定位策略：不让 VLM 给像素坐标（不可靠，AmIWrite 也把这列为头号
 * future work），而是给网格 cell（AmIWrite 的 grid referencing 同款思路，
 * 粗粒度换可靠性）；cell → 虚拟坐标在客户端换算（ink-grading.ts）。
 */

import { createLogger } from '@/lib/logger';
import { chat } from './llm-service';

const log = createLogger('ink-grading');

/** 批改用多模态模型（百炼 qwen3.7-plus，图片输入已在注册表标注多模态） */
const GRADE_MODEL = process.env.DASHSCOPE_VL_MODEL?.trim() || 'qwen3.7-plus';

export const INK_GRID_COLS = 6;
export const INK_GRID_ROWS = 4;
const MAX_MARKS = 4;
const MAX_COMMENT_CHARS = 60;

export type InkGradeVerdict = 'correct' | 'partial' | 'wrong' | 'unknown';

export interface InkGradeMark {
  type: 'check' | 'cross';
  /** 网格 cell：行字母 + 列数字，如 "B2" = 第 B 行第 2 列 */
  cell: string;
}

export interface InkGradeResult {
  verdict: InkGradeVerdict;
  comment: string;
  marks: InkGradeMark[];
  /** 老师示范：学生写错的那几步的正确写法（短板书行，0-3 行；correct/unknown 为空） */
  corrections: string[];
}

/** cell 合法性：行字母在网格行范围内、列数字在网格列范围内。 */
export function isValidCell(cell: string, cols: number, rows: number): boolean {
  const match = /^([A-Z])(\d{1,2})$/.exec(cell);
  if (!match) return false;
  const row = match[1].charCodeAt(0) - 65; // A → 0
  const col = Number(match[2]) - 1; // 1 → 0
  return row >= 0 && row < rows && col >= 0 && col < cols;
}

/**
 * 解析 VLM 批改输出（纯函数，可单测）：容错剥围栏取第一个 JSON 对象；
 * verdict 白名单、comment 截断、marks 逐条校验（类型/cell 越界丢弃、上限 4）。
 * 完全不可解析时返回 unknown 空结果（调用方按"不批改也能继续"降级）。
 */
export function parseInkGradeResponse(
  raw: string,
  cols: number = INK_GRID_COLS,
  rows: number = INK_GRID_ROWS,
): InkGradeResult {
  const fallback: InkGradeResult = { verdict: 'unknown', comment: '', marks: [], corrections: [] };
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return fallback;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return fallback;
  }

  const verdictRaw = typeof parsed.verdict === 'string' ? parsed.verdict : '';
  const verdict: InkGradeVerdict =
    verdictRaw === 'correct' || verdictRaw === 'partial' || verdictRaw === 'wrong'
      ? verdictRaw
      : 'unknown';

  const comment =
    typeof parsed.comment === 'string' ? parsed.comment.trim().slice(0, MAX_COMMENT_CHARS) : '';

  const marks: InkGradeMark[] = [];
  if (Array.isArray(parsed.marks)) {
    for (const item of parsed.marks) {
      if (marks.length >= MAX_MARKS) break;
      if (!item || typeof item !== 'object') continue;
      const mark = item as Record<string, unknown>;
      const type = mark.type === 'check' || mark.type === 'cross' ? mark.type : null;
      const cell = typeof mark.cell === 'string' ? mark.cell.trim().toUpperCase() : '';
      if (!type || !isValidCell(cell, cols, rows)) continue;
      marks.push({ type, cell });
    }
  }

  // 老师示范（仅学生有错时）：0-3 行短板书，逐行截断 20 字
  const corrections: string[] = [];
  if (verdict === 'partial' || verdict === 'wrong') {
    if (Array.isArray(parsed.corrections)) {
      for (const item of parsed.corrections) {
        if (corrections.length >= 3) break;
        if (typeof item !== 'string') continue;
        const line = item.trim().slice(0, 20);
        if (line) corrections.push(line);
      }
    }
  }

  return { verdict, comment, marks, corrections };
}

function buildGradePrompt(question: string, answer: string): string {
  return [
    '你是一位耐心的老师，正在批改学生的板演。图片是黑板截图：学生的粉笔蓝笔迹叠在网格上（行 A-D 从上到下，列 1-6 从左到右，格线旁有标注）。',
    `黑板上的题目：${question}`,
    `参考答案/正确做法：${answer}`,
    '要求：',
    '1. 看学生的解题思路和结果对不对。手写潦草、笔顺乱都没关系，看内容；笔迹没写完或明显只写了一点就停，按现有内容判断。',
    '2. 只输出一个 JSON 对象（不要 markdown 代码围栏）：',
    '{"verdict":"correct|partial|wrong","comment":"一句口语化点评，像老师当面说话，先肯定再指出问题，不超过40字","marks":[{"type":"check|cross","cell":"B2"}],"corrections":["正确写法的第一行","第二行"]}',
    '3. marks 最多 4 个：做对的步骤旁给 check，出错的位置给 cross；cell 是格子坐标（行字母+列数字，如 "A3"、"C5"），必须在网格范围内；拿不准位置就少给或不给。',
    '4. corrections：只有学生有错（partial/wrong）时给——把写错的那几步的正确写法拆成 1-3 行短板书（每行不超过 16 字，公式用 LaTeX 行内 $...$，像老师在学生旁边示范时写的那样，只写关键步骤不抄全题）；学生全对或看不清时给空数组。给 corrections 时 comment 里自然地带一句"看黑板旁边的示范"。',
    '5. 如果图里几乎没有笔迹或完全看不清，verdict 用 "wrong"，comment 老实说没看清写了什么，marks 和 corrections 都给空数组。',
  ].join('\n');
}

export interface GradeStudentInkParams {
  /** data:image/png;base64,...（叠好网格的板面笔迹图） */
  imageDataUrl: string;
  question: string;
  answer: string;
}

export async function gradeStudentInk(params: GradeStudentInkParams): Promise<InkGradeResult> {
  const startedAt = Date.now();
  const response = await chat(
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: params.imageDataUrl } },
          { type: 'text', text: buildGradePrompt(params.question, params.answer) },
        ],
      },
    ],
    GRADE_MODEL,
    { temperature: 0.3, maxTokens: 800, responseFormat: 'json_object' },
  );
  const result = parseInkGradeResponse(response.content);
  log.info('ink-grading.done', {
    model: response.model,
    ms: Date.now() - startedAt,
    verdict: result.verdict,
    marks: result.marks.length,
  });
  return result;
}
