/**
 * teach-agent 工具集 —— 原子板书工具 + 环境反馈（「课 = agent 的工具调用轨迹」）。
 *
 * 设计（pi 哲学 + coding agent harness 红利）：
 * - 工具少而原子：9 个板书原语 + new_column / flip_page / ask / finish，共 13 个
 * - 每次调用就地改 BoardEnv（页码 / 栏号 / wN 清单 / 动作计数），result 回环境
 *   观测——wN 引用合法性立即校验（circle 一个不存在的 w9，当场报错让 agent
 *   自纠，而不是等 sanitize 静默丢弃）；本页密度提示随结果回灌
 * - 讲稿不进工具参数：agent 的自然文本输出就是老师说的话（streamText 文本流）
 * - v31 白纸讲义：一页两栏（new_column 换栏），公式走 write role='formula'
 *   （LaTeX → KaTeX 块级排版），==重点== 马克笔高亮保留
 */

import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PAGES, MAX_PAUSE_MS } from '@/lib/ai-native/plugins/board-script';

/** 单页动作数软上限：超过后 result 里带翻页提示（不硬拒，信任模型判断）。
 *  v31 双栏讲义密度翻倍：14 ≈ 标题 + 每栏 6 行正文 + 1 标注 */
const PAGE_ACTION_NUDGE = 14;
/** 一页最多 2 栏（参考图形态：左右两栏讲义） */
const MAX_COLUMNS = 2;

export interface BoardEnv {
  /** 当前页码（1-based） */
  page: number;
  /** 当前栏号（1-based，一页最多 MAX_COLUMNS 栏） */
  column: number;
  /** 当前页 write 清单（wN = 下标 + 1） */
  writes: string[];
  /** 当前页板书动作总数（密度提示用） */
  pageActions: number;
  /** finish 已调用 */
  finished: boolean;
  finishSummary?: string;
}

export function createBoardEnv(): BoardEnv {
  return { page: 1, column: 1, writes: [], pageActions: 0, finished: false };
}

/** 环境观测 digest：每次 tool result 都带上，agent 随时知道讲义现状 */
function digest(env: BoardEnv): string {
  const board = env.writes.map((text, i) => `w${i + 1}「${text}」`).join(' ');
  return `第${env.page}页 · 第${env.column}栏 · ${board || '（空栏）'}`;
}

function ok(env: BoardEnv, extra: Record<string, unknown> = {}) {
  const nudge =
    env.pageActions >= PAGE_ACTION_NUDGE ? '本页动作偏多，讲完后考虑 flip_page 翻页' : undefined;
  return { ok: true as const, board: digest(env), ...(nudge ? { nudge } : {}), ...extra };
}

function fail(env: BoardEnv, error: string) {
  return { ok: false as const, error, board: digest(env) };
}

/** 'w3' / ['w2','w4'] 校验：必须指向本页已存在的 write */
function validTargets(env: BoardEnv, target: unknown): boolean {
  const list = Array.isArray(target) ? target : [target];
  return list.every((item) => {
    const match = /^w([1-9]\d*)$/.exec(String(item));
    return match !== null && Number(match[1]) <= env.writes.length;
  });
}

const targetSchema = z
  .union([z.string(), z.array(z.string()).min(1)])
  .describe("'w3' 或 ['w2','w4']（含两端），引用本页 write 序号");

const writeRoleSchema = z
  .enum(['title', 'term', 'step', 'note', 'formula'])
  .describe(
    'title=课题大标题（页首一次） term=节标题（紫底高亮块） step=正文短句 note=缩进注释/口诀 formula=块级公式（text 写 LaTeX，KaTeX 排版）',
  );

/** checkpoint 看解析时的示范动作（write/circle/underline/arrow/mark/pause 子集） */
const demoActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('write'), text: z.string(), role: writeRoleSchema }),
  z.object({ type: z.literal('circle'), target: targetSchema }),
  z.object({ type: z.literal('underline'), target: targetSchema }),
  z.object({
    type: z.literal('arrow'),
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  }),
  z.object({ type: z.literal('mark'), mark: z.enum(['check', 'cross']), target: z.string() }),
  z.object({ type: z.literal('pause'), ms: z.number().int().min(0).max(MAX_PAUSE_MS) }),
]);

/** 模型偶发把 LaTeX 反斜杠双重转义（\\cdot 应为 \cdot）：formula 文本把字母前的
 *  连续反斜杠收敛为一个（短公式不会出现 \\ 换行紧跟字母的合法情形）。
 *  同时剥掉展示数学定界符（\[ \] / $$ / $）——role=formula 本身就是块级公式，
 *  定界符传进 KaTeX 会解析失败、整段以报错红字原样上板（2026-08-21 黎曼猜想实测） */
export function normalizeFormulaText(text: string): string {
  return text
    .replace(/\\{2,}(?=[A-Za-z])/g, '\\')
    .replace(/^\s*\\\[|\\\]\s*$/g, '')
    .replace(/^\s*\$\$?|\$\$?\s*$/g, '')
    .trim();
}

export function createTeachTools(env: BoardEnv) {
  return {
    write: tool({
      description:
        '在讲义上写一行。一行一个要点，短句分行，是给学生看的成品讲义，不是草稿。公式一律 role=formula、text 写裸 LaTeX（\\frac{a}{b}、\\sqrt{x} 等全套可用，KaTeX 排版；不要带 \\[ \\] 或 $$ 定界符，role 本身已是块级公式；JSON 里反斜杠只需一次转义）；step/note 写人话，数学符号用 Unicode（Δ、b²-4ac、x₁），不写反斜杠命令；正文里的 ==重点== 给关键词上马克笔高亮。',
      inputSchema: z.object({
        text: z.string().min(1).max(160),
        role: writeRoleSchema,
      }),
      execute: async ({ text, role }) => {
        env.writes.push(text);
        env.pageActions += 1;
        return ok(env, { ref: `w${env.writes.length}`, wrote: text, role });
      },
    }),

    new_column: tool({
      description: `开新栏（一页最多 ${MAX_COLUMNS} 栏）。左栏写满后调用，后续 write 进右栏。`,
      inputSchema: z.object({}),
      execute: async () => {
        if (env.column >= MAX_COLUMNS)
          return fail(env, `本页已是第${MAX_COLUMNS}栏（一页最多${MAX_COLUMNS}栏），写满请 flip_page 翻页`);
        env.column += 1;
        env.pageActions += 1;
        return ok(env, { newColumn: env.column });
      },
    }),

    circle: tool({
      description: '用朱砂圈出本页已有内容的重点（讲到哪圈到哪）。',
      inputSchema: z.object({ target: targetSchema }),
      execute: async ({ target }) => {
        if (!validTargets(env, target)) return fail(env, 'target 指向不存在的 write，请按 board 清单里的 wN 引用');
        env.pageActions += 1;
        return ok(env, { circled: target });
      },
    }),

    underline: tool({
      description: '在本页已有板书下面划横线强调。',
      inputSchema: z.object({ target: targetSchema }),
      execute: async ({ target }) => {
        if (!validTargets(env, target)) return fail(env, 'target 指向不存在的 write，请按 board 清单里的 wN 引用');
        env.pageActions += 1;
        return ok(env, { underlined: target });
      },
    }),

    arrow: tool({
      description: '在两个已有板书之间画箭头（推导、对应关系），可带简短标签。',
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().max(12).optional(),
      }),
      execute: async ({ from, to, label }) => {
        if (!validTargets(env, from) || !validTargets(env, to))
          return fail(env, 'from/to 必须指向本页已存在的 write');
        env.pageActions += 1;
        return ok(env, { arrow: `${from} → ${to}`, ...(label ? { label } : {}) });
      },
    }),

    mark: tool({
      description: '在已有板书旁打勾（check）或打叉（cross），用于对错判断、结论确认。',
      inputSchema: z.object({ mark: z.enum(['check', 'cross']), target: z.string() }),
      execute: async ({ mark, target }) => {
        if (!validTargets(env, target)) return fail(env, 'target 指向不存在的 write');
        env.pageActions += 1;
        return ok(env, { marked: `${mark} on ${target}` });
      },
    }),

    pause: tool({
      description: '停顿留白（毫秒），给学生消化时间。用于讲完一个难点后。',
      inputSchema: z.object({ ms: z.number().int().min(200).max(MAX_PAUSE_MS) }),
      execute: async ({ ms }) => {
        env.pageActions += 1;
        return ok(env, { pausedMs: ms });
      },
    }),

    ref: tool({
      description: '引用之前某一页的板书（切页脉冲高亮后淡回），用于"还记得前面讲的……"。',
      inputSchema: z.object({
        page: z.number().int().min(1),
        target: z.string(),
      }),
      execute: async ({ page, target }) => {
        if (page >= env.page) return fail(env, `只能引用已翻过的页（当前第${env.page}页）`);
        env.pageActions += 1;
        return ok(env, { ref: `p${page} ${target}` });
      },
    }),

    image: tool({
      description:
        '在讲义当前位置嵌一张插图（像老师把打印图贴进讲义）。给出生成图的画面描述；图片在课后生成回填。',
      inputSchema: z.object({
        prompt: z.string().min(4).max(200).describe('画面描述，供图像模型生成'),
        caption: z.string().max(20).optional(),
      }),
      execute: async ({ prompt }) => {
        env.pageActions += 1;
        return ok(env, { imageQueued: prompt });
      },
    }),

    flip_page: tool({
      description: `翻到新的一页讲义（最多 ${MAX_PAGES} 页）。一页讲透一个板块再翻。`,
      inputSchema: z.object({}),
      execute: async () => {
        if (env.page >= MAX_PAGES) return fail(env, `讲义已满（${MAX_PAGES}页上限），请用 finish 收束本课`);
        env.page += 1;
        env.column = 1;
        env.writes = [];
        env.pageActions = 0;
        return ok(env, { flippedTo: env.page });
      },
    }),

    ask: tool({
      description:
        '向学生提问并等待回答（checkpoint）。先说提问口述（作为正常文本输出），再调用本工具把题目写上讲义。',
      inputSchema: z.object({
        question: z.string().min(1).max(60).describe('写上讲义的题目'),
        role: z.enum(['term', 'step']),
        hints: z
          .array(z.string())
          .length(3)
          .describe('三级递进提示：方向→一半→差一步（恰好 3 条）'),
        answer: z.string().min(1).describe('看解析时的口述答案'),
        demoActions: z.array(demoActionSchema).max(16).describe('看解析时的板书示范'),
      }),
      execute: async ({ question }) => {
        env.pageActions += 1;
        return ok(env, { checkpoint: question });
      },
    }),

    finish: tool({
      description: '结束本课（做完总结后调用）。',
      inputSchema: z.object({ summary: z.string().max(120).optional() }),
      execute: async ({ summary }) => {
        env.finished = true;
        env.finishSummary = summary;
        return ok(env, { finished: true });
      },
    }),
  };
}

export type TeachTools = ReturnType<typeof createTeachTools>;
