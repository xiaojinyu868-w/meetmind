/**
 * Board Director 服务 —— 导演 pass：第二次 LLM 调用，只做节奏标注。
 *
 * 管线位置：BoardScript 生成 + sanitize 之后、交付播放器之前。
 * 输入一页的 narration + 动作清单，输出每个动作的 cue（字位锚点）与
 * 段后呼吸 breathMs；校验合并（越界丢弃、actionIndex 去重、breath clamp），
 * 任何一页失败/超时都保留原脚本——导演是增强项不是正确性项。
 *
 * 模型：env BOARD_DIRECTOR_MODEL（默认 kimi-k3，用户拍板；实时链路延迟
 * 敏感可换 kimi-k2.7-code-highspeed / DeepSeek-V4-Flash）。
 * 延迟架构：按页并行（Skeleton-of-Thought 模式）+ 每页硬超时降级。
 */

import { createLogger } from '@/lib/logger';
import { chat, getModelConfig } from './llm-service';
import type { BoardCue, BoardPage, BoardScript } from '@/lib/ai-native/plugins/board-script';
import { segmentDisplayText } from '@/lib/ai-native/plugins/board-script';
import {
  buildDirectorSystemPrompt,
  buildDirectorUserPrompt,
  type DirectorSegmentInput,
} from '@/lib/ai-native/plugins/board-director-prompts';

const log = createLogger('board-director');

/** 默认导演模型（仅 BOARD_DIRECTOR_MODEL 未显式配置时的展示值；导演默认关闭，见 isDirectorAvailable） */
const DIRECTOR_MODEL = process.env.BOARD_DIRECTOR_MODEL?.trim() || 'kimi/kimi-k3';
const MAX_BREATH_MS = 2500;

/** 导演可用性：仅当 BOARD_DIRECTOR_MODEL 显式配置才启用。
 *  2026-08-18 实测：K3 主生成内联节奏标注已足够好（31 cue + 2 checkpoint
 *  一次产出），再跑 K3 导演是双倍成本零增量——导演 pass 退化为可选增强，
 *  弱生成模型（V4 Flash 等）需要节奏补强时显式打开。 */
export function isDirectorAvailable(model?: string): boolean {
  const explicit = model?.trim() || process.env.BOARD_DIRECTOR_MODEL?.trim();
  return explicit !== undefined && explicit !== '' && getModelConfig(explicit) !== undefined;
}

// ── 输出校验（纯函数，可单测） ──────────────────────────────────────────────

export interface SegmentDirection {
  cues: BoardCue[];
  breathMs?: number;
}

interface RawCue {
  actionIndex?: unknown;
  charIndex?: unknown;
}

interface RawSegmentDirection {
  segment?: unknown;
  cues?: unknown;
  breathMs?: unknown;
}

/**
 * 校验导演输出并映射回页内 segment（纯函数）：
 * - segment 下标必须存在且是 narration 段；
 * - cue：actionIndex 有效、charIndex 在 [0, display 长度]、按 actionIndex 去重（先赢）；
 * - breathMs：数字 clamp 到 [0, 2500]。
 * 返回 Map<segmentIndex, SegmentDirection>（只含有效条目）。
 */
export function parseDirectorResponse(raw: string, page: BoardPage): Map<number, SegmentDirection> {
  const result = new Map<number, SegmentDirection>();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return result;

  let parsed: { segments?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as { segments?: unknown };
  } catch {
    return result;
  }
  if (!Array.isArray(parsed.segments)) return result;

  for (const item of parsed.segments as RawSegmentDirection[]) {
    const segmentIndex = typeof item.segment === 'number' ? item.segment : -1;
    const segment = page.segments[segmentIndex];
    if (!segment || segment.type === 'checkpoint') continue;

    const display = segmentDisplayText(segment);
    const cues: BoardCue[] = [];
    const seen = new Set<number>();
    if (Array.isArray(item.cues)) {
      for (const rawCue of item.cues as RawCue[]) {
        const actionIndex = typeof rawCue.actionIndex === 'number' ? rawCue.actionIndex : -1;
        const charIndex = typeof rawCue.charIndex === 'number' ? rawCue.charIndex : -1;
        if (actionIndex < 0 || actionIndex >= segment.actions.length) continue;
        if (seen.has(actionIndex)) continue;
        if (charIndex < 0 || charIndex > display.length) continue;
        seen.add(actionIndex);
        cues.push({ actionIndex, charIndex: Math.round(charIndex) });
      }
    }

    let breathMs: number | undefined;
    if (typeof item.breathMs === 'number' && Number.isFinite(item.breathMs)) {
      breathMs = Math.min(MAX_BREATH_MS, Math.max(0, Math.round(item.breathMs)));
    }

    if (cues.length > 0 || breathMs !== undefined) {
      result.set(segmentIndex, { cues, breathMs });
    }
  }
  return result;
}

// ── 页级导演调用 ────────────────────────────────────────────────────────────

function summarizeActions(page: BoardPage, segmentIndex: number): DirectorSegmentInput | null {
  const segment = page.segments[segmentIndex];
  if (!segment || segment.type === 'checkpoint') return null;
  const KIND_LABEL: Record<string, string> = {
    write: '写', circle: '圈', underline: '下划线', arrow: '箭头', mark: '勾叉', pause: '停顿', ref: '回看',
  };
  return {
    index: segmentIndex,
    display: segmentDisplayText(segment),
    actions: segment.actions.map((action, index) => ({
      index,
      kind: KIND_LABEL[action.type] ?? action.type,
      summary:
        action.type === 'write'
          ? `${action.role}「${action.text.slice(0, 20)}」`
          : action.type === 'pause'
            ? `${action.ms}ms`
            : action.type === 'ref'
              ? `第${action.page}页 ${action.target}`
              : JSON.stringify('target' in action ? action.target : '').slice(0, 40),
    })),
    existingCues: (segment.cues ?? []).map((cue) => ({ actionIndex: cue.actionIndex, charIndex: cue.charIndex })),
  };
}

async function directPage(page: BoardPage, model: string): Promise<Map<number, SegmentDirection>> {
  const inputs = page.segments
    .map((_, index) => summarizeActions(page, index))
    .filter((input): input is DirectorSegmentInput => input !== null && input.actions.length > 0);
  if (inputs.length === 0) return new Map();

  const response = await chat(
    [
      { role: 'system', content: buildDirectorSystemPrompt() },
      { role: 'user', content: buildDirectorUserPrompt(inputs) },
    ],
    model,
    // thinking:false：DeepSeek V4 默认思考开启会吃掉 max_tokens（finish_reason=length）
    // 并拖过单页超时；K3 平台思考常开，maxTokens 给足推理余量
    { temperature: 0.3, maxTokens: 8000, responseFormat: 'json_object', thinking: false },
  );
  return parseDirectorResponse(response.content, page);
}

export interface DirectBoardScriptOptions {
  model?: string;
  /** 每页硬超时（默认 15s 离线；实时链路传 6-8s） */
  perPageTimeoutMs?: number;
}

export interface DirectBoardScriptResult {
  script: BoardScript;
  /** 导演成功标注的页数 / 总页数 */
  directedPages: number;
  totalPages: number;
  model: string;
}

/**
 * 对整份脚本跑导演 pass（按页并行，单页失败/超时保留原页）。
 * 合并规则：导演 cue 覆盖原 cue（该段至少有一个有效 cue 时）；breathMs 直接写入。
 */
export async function directBoardScript(
  script: BoardScript,
  options?: DirectBoardScriptOptions,
): Promise<DirectBoardScriptResult> {
  const model = options?.model?.trim() || DIRECTOR_MODEL;
  const timeoutMs = options?.perPageTimeoutMs ?? 15_000;

  const pages = await Promise.all(
    script.pages.map(async (page) => {
      try {
        const directions = await Promise.race([
          directPage(page, model),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('director timeout')), timeoutMs),
          ),
        ]);
        const segments = page.segments.map((segment, segmentIndex) => {
          if (segment.type === 'checkpoint') return segment;
          const direction = directions.get(segmentIndex);
          if (!direction) return segment;
          return {
            ...segment,
            cues: direction.cues.length > 0 ? direction.cues : segment.cues,
            ...(direction.breathMs !== undefined ? { breathMs: direction.breathMs } : {}),
          };
        });
        return { segments, directed: directions.size > 0 };
      } catch (cause) {
        log.warn('board director 单页失败，保留原节奏', {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return { segments: page.segments, directed: false };
      }
    }),
  );

  const directedPages = pages.filter((page) => page.directed).length;
  log.info('board-director.done', { model, directedPages, totalPages: pages.length });
  return {
    script: { ...script, pages: pages.map((page) => ({ segments: page.segments })) },
    directedPages,
    totalPages: pages.length,
    model,
  };
}
