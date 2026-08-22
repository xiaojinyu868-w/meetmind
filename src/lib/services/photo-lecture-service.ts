/**
 * Photo Lecture 服务 —— 拍题开讲生成管线。
 *
 * 链路（docs/BOARD_TUTOR_ARCHITECTURE.md Phase 1）：
 *   照片 → extractProblemFromImage（Qwen3.7-Plus 审题）
 *        → solveReferenceProblem（DeepSeek V4 Pro 独立解题 = 数学锚，L0）
 *        → generatePhotoLecture（DeepSeek V4 Flash 按参考解写板书脚本）
 *        → sanitizeBoardScript（坏动作跳过，一页都留不住按失败）
 *
 * "先独立解题、再按标准解生成讲解"对应洋葱十年复盘与 Khanmigo math agent
 * 的共同结论：数学判断锚定在独立通道，讲解模型只做表达。
 */

import { createLogger } from '@/lib/logger';
import { chat, DEFAULT_MODEL_ID } from './llm-service';
import { extractProblemFromImage, getPhotoVlModel, type PhotoProblem } from './photo-problem-service';
import { directBoardScript, isDirectorAvailable } from './board-director-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { sanitizeBoardScript, type BoardScript } from '@/lib/ai-native/plugins/board-script';
import {
  buildPhotoLectureSystemPrompt,
  buildPhotoLectureUserPrompt,
  buildPhotoOneShotSystemPrompt,
  buildPhotoOneShotUserPrompt,
} from '@/lib/ai-native/plugins/photo-lecture-prompts';

const log = createLogger('photo-lecture');

/** 独立解题用深度模型（思考开启，数学正确性优先于速度） */
const SOLVE_MODEL = process.env.BOARD_PHOTO_SOLVE_MODEL?.trim() || 'DeepSeek-V4-Pro';
/** 板书脚本生成模型（与 explainer 同款默认） */
const LECTURE_MODEL = process.env.BOARD_PHOTO_LECTURE_MODEL?.trim() || 'DeepSeek-V4-Flash';

const MAX_SOLUTION_CHARS = 4000;

/**
 * 独立解题：不看学生尝试、不为讲解服务，只把题做对。
 * 产出的参考解答是后续讲解的数学锚。
 */
export async function solveReferenceProblem(
  problem: PhotoProblem,
  model: string = SOLVE_MODEL,
): Promise<string> {
  const sections = [
    `学科：${problem.subject}`,
    `题目：${problem.statement}`,
    problem.figureDesc ? `图形：${problem.figureDesc}` : '',
    problem.figureSpec ? `图形档案：${problem.figureSpec}` : '',
    '',
    '请完整解出这道题。输出：最终答案（明确标出）+ 关键步骤（每步一行，写清用了什么公式或定理）。控制在 600 字内，不要寒暄。',
  ].filter(Boolean).join('\n');

  const response = await chat(
    [{ role: 'user', content: sections }],
    model,
    { temperature: 0.2, maxTokens: 8192 },
  );
  const solution = response.content.trim().slice(0, MAX_SOLUTION_CHARS);
  if (!solution) {
    throw new Error('解题通道没有产出参考解答');
  }
  log.info('photo-lecture.solved', { model: response.model, chars: solution.length });
  return solution;
}

function hasPlayableContent(script: BoardScript): boolean {
  return script.pages.some((page) =>
    page.segments.some((segment) =>
      segment.type === 'checkpoint' ? segment.demoActions.length > 0 : segment.actions.length > 0,
    ),
  );
}

/** 按参考解答生成板书脚本；清洗后无内容 → null（调用方按失败处理）。 */
export async function generatePhotoLecture(params: {
  problem: PhotoProblem;
  referenceSolution: string;
  model?: string;
}): Promise<{ script: BoardScript; dropped: number } | null> {
  const model = params.model?.trim() || LECTURE_MODEL || DEFAULT_MODEL_ID;
  const response = await chat(
    [
      { role: 'system', content: buildPhotoLectureSystemPrompt() },
      {
        role: 'user',
        content: buildPhotoLectureUserPrompt({
          subject: params.problem.subject,
          statement: params.problem.statement,
          figureDesc: params.problem.figureDesc,
          studentAttempt: params.problem.studentAttempt,
          referenceSolution: params.referenceSolution,
        }),
      },
    ],
    model,
    // thinking:false 显式关闭——DeepSeek V4 API 默认思考开启，32k JSON 生成会拖过 180s HTTP 超时（实测 502）
    { temperature: 0.5, maxTokens: 32000, responseFormat: 'json_object', thinking: false },
  );

  const llmOutput = parseJsonResponse<unknown>(response.content);
  if (!llmOutput) return null;

  const { script, dropped } = sanitizeBoardScript(llmOutput);
  if (!hasPlayableContent(script)) return null;
  log.info('photo-lecture.generated', {
    model: response.model,
    pages: script.pages.length,
    dropped,
  });
  return { script, dropped };
}

export interface PhotoLectureResult {
  problem: PhotoProblem;
  referenceSolution: string;
  script: BoardScript;
  models: { vision: string; solve: string; lecture: string; director?: string };
}

/** 链路模式：oneshot（默认，单次多模态调用）| staged（审题→解题→生成 三段） */
const PHOTO_MODE = process.env.BOARD_PHOTO_MODE?.trim() || 'oneshot';
/** one-shot 用多模态模型（看照片 + 解题 + 写脚本 + 节奏标注一次完成）。
 *  2026-08-18 实测对比：kimi/kimi-k3 质量更好（2 checkpoint、28/28 cue、
 *  讲解更像真人）但 7.2 分钟/份杀死实时 AHA；qwen3.7-plus 38s 质量够用——
 *  实时链路默认 qwen，K3 留 env 给"极致质量不在乎等"的场景 */
const ONESHOT_MODEL = process.env.BOARD_PHOTO_ONESHOT_MODEL?.trim() || 'qwen3.7-plus';

/** one-shot 生成：单次调用出 BoardScript；照片无题 → null，产出不可用 → null。 */
async function generateOneShotLecture(imageDataUrl: string): Promise<BoardScript | null> {
  const response = await chat(
    [
      { role: 'system', content: buildPhotoOneShotSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: buildPhotoOneShotUserPrompt() },
        ],
      },
    ],
    ONESHOT_MODEL,
    { temperature: 0.5, maxTokens: 32000, responseFormat: 'json_object' },
  );

  const llmOutput = parseJsonResponse<unknown>(response.content);
  if (!llmOutput || typeof llmOutput !== 'object') return null;
  if ('error' in llmOutput) return null; // {"error":"not_a_problem"}

  const { script, dropped } = sanitizeBoardScript(llmOutput);
  if (!hasPlayableContent(script)) return null;
  log.info('photo-lecture.oneshot', { model: response.model, pages: script.pages.length, dropped });
  return script;
}

/** 拍题开讲全链路（one-shot：图片进、带节奏标注的 BoardScript 出）。无题 → null。 */
export async function explainPhotoProblem(imageDataUrl: string): Promise<PhotoLectureResult | null> {
  if (PHOTO_MODE !== 'staged') {
    const script = await generateOneShotLecture(imageDataUrl);
    if (!script) return null;
    return {
      problem: { subject: '', statement: '' },
      referenceSolution: '',
      script,
      models: { vision: ONESHOT_MODEL, solve: ONESHOT_MODEL, lecture: ONESHOT_MODEL },
    };
  }

  const visionModel = getPhotoVlModel();
  const problem = await extractProblemFromImage({ imageDataUrl, model: visionModel });
  if (!problem) return null;

  const referenceSolution = await solveReferenceProblem(problem);
  const lecture = await generatePhotoLecture({ problem, referenceSolution });
  if (!lecture) {
    throw new Error('板书脚本生成失败');
  }

  // 导演 pass（staged 模式专属：one-shot 的脚本自带节奏标注，不再二次标注）
  let script = lecture.script;
  let directorModel: string | undefined;
  if (isDirectorAvailable()) {
    const directed = await directBoardScript(script, { perPageTimeoutMs: 8_000 });
    script = directed.script;
    if (directed.directedPages > 0) directorModel = directed.model;
  }

  return {
    problem,
    referenceSolution,
    script,
    models: { vision: visionModel, solve: SOLVE_MODEL, lecture: LECTURE_MODEL, ...(directorModel ? { director: directorModel } : {}) },
  };
}
