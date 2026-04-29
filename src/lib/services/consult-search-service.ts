/**
 * consult-search-service —— 真实联网搜索
 *
 * 实现路径（经过实测验证的唯一可行路径）：
 *   - DashScope 原生端点 /api/v1/services/aigc/text-generation/generation
 *   - 模型：qwen-max （qwen3.x 系列目前不返回结构化 search_info）
 *   - parameters.enable_search = true + search_options
 *
 * 为什么不在主 chat 的 streamText 里开 enable_search：
 *   1. OpenAI 兼容端点（/compatible-mode/v1）不会回传 search_info
 *   2. 主 chat 已经用了 qwen3.6-plus + tool-calling；再同时 force search 会冲突
 *   3. 做成独立工具：模型显式选择何时需要真实数据，可观测、可缓存
 *
 * 关键字段：
 *   - output.search_info.search_results[]：真实的搜索结果（title / url / site_name / index / icon）
 *   - output.choices[0].message.content：qwen-max 基于 citations 给的总结（含 [1] [2] 引用标记）
 */

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com';
const SEARCH_MODEL = process.env.DASHSCOPE_SEARCH_MODEL || 'qwen-max';

export interface SearchCitation {
  index: number;
  title: string;
  url: string;
  site?: string;
  icon?: string;
}

export interface SearchResult {
  query: string;
  answer: string;
  citations: SearchCitation[];
  costMs: number;
  note?: string;
  ok: boolean;
}

export type ProgramSearchFocus = 'requirements' | 'deadline' | 'funding' | 'curriculum' | 'faculty';

export interface ProgramRequirementSearchArgs {
  query?: string;
  school?: string;
  schools?: string[];
  program?: string;
  field?: string;
  degree?: string;
  intakeYear?: number;
  region?: string;
  focus?: ProgramSearchFocus;
  maxResults?: number;
}

interface DashScopeNativeResponse {
  code?: string;
  message?: string;
  request_id?: string;
  output?: {
    choices?: Array<{
      message?: { role?: string; content?: string };
      finish_reason?: string;
    }>;
    search_info?: {
      search_results?: Array<{
        site_name?: string;
        icon?: string;
        index?: number;
        title?: string;
        url?: string;
      }>;
    };
  };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

const ADVISOR_SEARCH_SCHOOLS = [
  { name: 'Nanyang Technological University', tokens: ['ntu', 'nanyang technological university'], site: 'ntu.edu.sg' },
  { name: 'National University of Singapore', tokens: ['nus', 'national university of singapore'], site: 'nus.edu.sg' },
  { name: 'Hong Kong University of Science and Technology', tokens: ['hkust', 'hong kong university of science and technology'], site: 'hkust.edu.hk' },
  { name: 'University of Hong Kong', tokens: ['hku', 'university of hong kong'], site: 'hku.hk' },
  { name: 'Stanford University', tokens: ['stanford'], site: 'stanford.edu' },
] as const;

export function planAcademicSearchQueries(query: string): string[] {
  const normalized = query.toLowerCase();
  const isAdvisorSearch = /advisor|professor|faculty|导师|教授|实验室|lab|pi\b/.test(normalized);
  if (!isAdvisorSearch) return [query];

  const schools = ADVISOR_SEARCH_SCHOOLS.filter((school) =>
    school.tokens.some((token) => normalized.includes(token)),
  );
  const field = /nlp|natural language|language model|语言/.test(normalized)
    ? 'natural language processing language models'
    : /robot|机器人/.test(normalized)
      ? 'robotics machine learning'
      : 'machine learning artificial intelligence';

  if (schools.length > 1) {
    return schools.slice(0, 4).map((school) =>
      `${school.name} ${field} faculty professor lab recent publications 2025 2026 site:${school.site}`,
    );
  }

  if (schools.length === 1) {
    const school = schools[0];
    return [
      `${school.name} ${field} faculty professor lab recent publications 2025 2026 site:${school.site}`,
    ];
  }

  return [`${query} official faculty lab recent publications 2025 2026`];
}

function normalizeSearchTerms(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, ' '));
}

function focusTerms(focus: ProgramSearchFocus | undefined): string {
  switch (focus) {
    case 'deadline':
      return 'application deadline admissions timeline';
    case 'funding':
      return 'funding scholarship tuition stipend assistantship';
    case 'curriculum':
      return 'curriculum degree requirements courses milestones';
    case 'faculty':
      return 'faculty research groups supervisors labs';
    case 'requirements':
    default:
      return 'application requirements admissions eligibility materials';
  }
}

export function planProgramRequirementQueries(args: ProgramRequirementSearchArgs): string[] {
  const rawQuery = args.query?.trim();
  const schools = normalizeSearchTerms([...(args.schools ?? []), args.school]).slice(0, 4);
  const subject = normalizeSearchTerms([args.program, args.field]).join(' ') || rawQuery || 'graduate program';
  const degree = args.degree?.trim() || 'graduate';
  const year = args.intakeYear ? `${args.intakeYear}` : '';
  const region = args.region?.trim() ? `${args.region} ` : '';
  const terms = focusTerms(args.focus);
  const official = 'official site';

  if (schools.length > 0) {
    return schools.map((school) =>
      normalizeSearchTerms([
        school,
        subject,
        degree,
        `${region}${terms}`,
        year,
        official,
      ]).join(' '),
    );
  }

  return [
    normalizeSearchTerms([
      rawQuery ?? subject,
      degree,
      `${region}${terms}`,
      year,
      official,
    ]).join(' '),
  ];
}

export async function runWebSearch(args: {
  query: string;
  freshness?: 'day' | 'week' | 'month' | 'year';
  maxResults?: number;
}): Promise<SearchResult> {
  const started = Date.now();
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();

  if (!apiKey) {
    return {
      query: args.query,
      answer: '',
      citations: [],
      ok: false,
      costMs: Date.now() - started,
      note: '未配置 DASHSCOPE_API_KEY',
    };
  }

  const plannedQueries = planAcademicSearchQueries(args.query).slice(0, 4);
  if (plannedQueries.length > 1) {
    const perQueryLimit = Math.max(2, Math.ceil((args.maxResults ?? 5) / plannedQueries.length));
    const results = await Promise.all(
      plannedQueries.map((query) => runSingleSearch({ query, apiKey, maxResults: perQueryLimit })),
    );
    const citations: SearchCitation[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      for (const citation of result.citations) {
        if (seen.has(citation.url)) continue;
        seen.add(citation.url);
        citations.push(citation);
      }
    }
    return {
      query: args.query,
      answer: results
        .map((result) => `【${result.query}】${result.answer || result.note || '未检索到有效结果'}`)
        .join('\n'),
      citations: citations.slice(0, args.maxResults ?? 5).map((citation, index) => ({ ...citation, index: index + 1 })),
      ok: results.some((result) => result.ok),
      costMs: Date.now() - started,
      note: citations.length === 0 ? '已按学校拆分检索，但未返回结构化引用' : `已拆分为 ${plannedQueries.length} 个精准查询`,
    };
  }

  const result = await runSingleSearch({
    query: plannedQueries[0] ?? args.query,
    apiKey,
    maxResults: args.maxResults ?? 5,
  });
  return { ...result, query: args.query, costMs: Date.now() - started };
}

export async function runProgramRequirementSearch(args: ProgramRequirementSearchArgs): Promise<SearchResult> {
  const started = Date.now();
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  const plannedQueries = planProgramRequirementQueries(args).slice(0, 4);
  const originalQuery = args.query?.trim() || plannedQueries.join(' | ');

  if (!apiKey) {
    return {
      query: originalQuery,
      answer: '',
      citations: [],
      ok: false,
      costMs: Date.now() - started,
      note: '未配置 DASHSCOPE_API_KEY',
    };
  }

  const perQueryLimit = Math.max(2, Math.ceil((args.maxResults ?? 6) / Math.max(plannedQueries.length, 1)));
  const results = await Promise.all(
    plannedQueries.map((query) => runSingleSearch({ query, apiKey, maxResults: perQueryLimit })),
  );
  const citations: SearchCitation[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const citation of result.citations) {
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      citations.push(citation);
    }
  }

  return {
    query: originalQuery,
    answer: results
      .map((result) => `【${result.query}】${result.answer || result.note || '未检索到有效结果'}`)
      .join('\n'),
    citations: citations.slice(0, args.maxResults ?? 6).map((citation, index) => ({ ...citation, index: index + 1 })),
    ok: results.some((result) => result.ok),
    costMs: Date.now() - started,
    note: citations.length === 0 ? '已按项目/学校检索，但未返回结构化引用' : `已拆分为 ${plannedQueries.length} 个项目要求查询`,
  };
}

async function runSingleSearch(args: {
  query: string;
  apiKey: string;
  maxResults: number;
}): Promise<SearchResult> {
  const started = Date.now();

  const systemPrompt = [
    '你是一个检索助手。严格按以下要求输出：',
    '1. 只基于搜索到的结果回答，不要凭记忆；若没有相关结果，明确说"未检索到"。',
    '2. 用中文作答，控制在 3-5 句；每个关键事实后面用 [数字] 引用对应来源。',
    '3. 不要给学习/申请建议；只回答查询本身。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(
      `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/text-generation/generation`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: SEARCH_MODEL,
          input: {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: args.query },
            ],
          },
          parameters: {
            result_format: 'message',
            temperature: 0.2,
            enable_search: true,
            search_options: {
              forced_search: true,
              enable_source: true,
              enable_citation: true,
              citation_format: '[<number>]',
              search_strategy: 'standard',
            },
          },
        }),
      },
    );
    clearTimeout(timer);

    const body = (await res.json()) as DashScopeNativeResponse;

    if (!res.ok || body.code) {
      return {
        query: args.query,
        answer: '',
        citations: [],
        ok: false,
        costMs: Date.now() - started,
        note: `${body.code ?? 'HTTP ' + res.status}: ${body.message ?? 'unknown'}`,
      };
    }

    const answer = body.output?.choices?.[0]?.message?.content?.trim() ?? '';
    const raw = body.output?.search_info?.search_results ?? [];
    const limit = args.maxResults;
    const citations: SearchCitation[] = raw
      .filter((r) => r.url && r.title)
      .slice(0, limit)
      .map((r) => ({
        index: typeof r.index === 'number' ? r.index : 0,
        title: String(r.title ?? '').trim(),
        url: String(r.url ?? '').trim(),
        site: r.site_name?.trim(),
        icon: r.icon?.trim(),
      }));

    return {
      query: args.query,
      answer,
      citations,
      ok: true,
      costMs: Date.now() - started,
      note: citations.length === 0 ? '检索完成但未返回结构化引用' : undefined,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      query: args.query,
      answer: '',
      citations: [],
      ok: false,
      costMs: Date.now() - started,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}
