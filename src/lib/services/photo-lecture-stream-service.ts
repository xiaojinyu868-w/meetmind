/**
 * Photo Lecture Stream 服务 —— 流式讲解单元生成（Skeleton-of-Thought）。
 *
 * 管线：大纲调用（宏观把控：title + 解题思路 + 单元计划）→ 全部单元并行
 * 生成（内部把控：每单元一次调用、逐单元 sanitize）→ 按下标顺序流式产出。
 * 第一单元就绪即可开播，其余边生成边播——拍题等待从"整份 40s~7min"
 * 变成"~15s 开讲"。任何单元失败跳过该单元（其余照播），大纲失败/无题 → error 事件。
 */

import { createLogger } from '@/lib/logger';
import { chat } from './llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { sanitizeBoardScript, type BoardPage } from '@/lib/ai-native/plugins/board-script';
import {
  buildOutlineSystemPrompt,
  buildUnitSystemPrompt,
  buildUnitUserPrompt,
  type LessonOutline,
  type LessonOutlineUnit,
} from '@/lib/ai-native/plugins/photo-stream-prompts';

const log = createLogger('photo-stream');

const STREAM_MODEL = process.env.BOARD_PHOTO_STREAM_MODEL?.trim() || 'qwen3.7-plus';
const MAX_UNITS = 5;

export type PhotoStreamEvent =
  | { type: 'meta'; title: string; totalUnits: number }
  | { type: 'unit'; pageIndex: number; page: BoardPage }
  | { type: 'unit-error'; pageIndex: number }
  | { type: 'error'; error: 'not_a_problem' | 'failed' }
  | { type: 'done'; model: string };

/** 解析大纲输出（纯函数，可单测）：title/solution 非空、units 1-6 个、goal 非空。 */
export function parseOutlineResponse(raw: string): LessonOutline | null {
  const parsed = parseJsonResponse<Record<string, unknown>>(raw);
  if (!parsed || 'error' in parsed) return null;

  const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 30) : '';
  const solution = typeof parsed.solution === 'string' ? parsed.solution.trim().slice(0, 1500) : '';
  if (!title || !solution || !Array.isArray(parsed.units)) return null;

  const units: LessonOutlineUnit[] = [];
  let checkpoints = 0;
  for (const item of parsed.units) {
    if (units.length >= MAX_UNITS) break;
    if (!item || typeof item !== 'object') continue;
    const goal = typeof (item as Record<string, unknown>).goal === 'string'
      ? ((item as Record<string, unknown>).goal as string).trim().slice(0, 100)
      : '';
    if (!goal) continue;
    const checkpoint = (item as Record<string, unknown>).checkpoint === true;
    if (checkpoint) checkpoints += 1;
    units.push({ goal, ...(checkpoint ? { checkpoint: true } : {}) });
  }
  if (units.length === 0 || checkpoints > 2) return null;
  return { title, solution, units };
}

/** 单元输出 → sanitize 成单页（失败 → null）。 */
function sanitizeUnitPage(llmOutput: unknown): BoardPage | null {
  if (!llmOutput || typeof llmOutput !== 'object') return null;
  const { script } = sanitizeBoardScript({ title: '', pages: [llmOutput], quotes: [] });
  const page = script.pages[0];
  if (!page || page.segments.length === 0) return null;
  const hasContent = page.segments.some((segment) =>
    segment.type === 'checkpoint' ? segment.demoActions.length > 0 || true : segment.actions.length > 0,
  );
  return hasContent ? page : null;
}

async function generateUnit(
  imageDataUrl: string,
  outline: LessonOutline,
  unitIndex: number,
): Promise<BoardPage | null> {
  const response = await chat(
    [
      { role: 'system', content: buildUnitSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          {
            type: 'text',
            text: buildUnitUserPrompt({
              title: outline.title,
              solution: outline.solution,
              units: outline.units,
              unitIndex,
              pageNumber: unitIndex + 1,
            }),
          },
        ],
      },
    ],
    STREAM_MODEL,
    { temperature: 0.5, maxTokens: 12000, responseFormat: 'json_object' },
  );
  return sanitizeUnitPage(parseJsonResponse<unknown>(response.content));
}

/**
 * 拍题开讲流式生成：先产出 meta（大纲），单元按下标顺序逐个产出
 * （并行生成、有序下发）。第一单元到达即可开播。
 */
export async function* streamPhotoLecture(imageDataUrl: string): AsyncGenerator<PhotoStreamEvent> {
  // 1. 大纲（宏观把控）
  let outline: LessonOutline | null = null;
  try {
    const response = await chat(
      [
        { role: 'system', content: buildOutlineSystemPrompt() },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            { type: 'text', text: '这是学生拍来的照片。先解对，再给出这节课的骨架 JSON。' },
          ],
        },
      ],
      STREAM_MODEL,
      { temperature: 0.3, maxTokens: 4000, responseFormat: 'json_object' },
    );
    outline = parseOutlineResponse(response.content);
  } catch (cause) {
    log.error('photo-stream outline failed', { error: cause instanceof Error ? cause.message : String(cause) });
  }
  if (!outline) {
    yield { type: 'error', error: 'not_a_problem' };
    return;
  }

  yield { type: 'meta', title: outline.title, totalUnits: outline.units.length };

  // 2. 单元并行生成、有序下发
  const tasks = outline.units.map((_, index) =>
    generateUnit(imageDataUrl, outline, index).catch((cause) => {
      log.warn('photo-stream unit failed', { pageIndex: index, error: cause instanceof Error ? cause.message : String(cause) });
      return null;
    }),
  );
  for (let index = 0; index < tasks.length; index += 1) {
    const page = await tasks[index];
    if (page) {
      yield { type: 'unit', pageIndex: index, page };
    } else {
      yield { type: 'unit-error', pageIndex: index };
    }
  }

  yield { type: 'done', model: STREAM_MODEL };
}
