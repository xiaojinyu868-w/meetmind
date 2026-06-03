/**
 * ASR LLM 后校对（M5 T5.2）
 *
 * 策略：对"低置信片段"才调 qwen3.7-plus 复核（性价比 + 效果平衡，max 按需切）。
 *   1. 按 confidence 阈值筛选；confidence 缺失时按文本特征启发式判断
 *   2. 单次调用只复核 ≤ 10 条，避免 prompt 超长
 *   3. 返回的"高置信纠正"才接受（LLM 给出 {original, corrected, confidence}）
 *   4. 失败静默降级——不返回原始，返回已校对 + 未校对混合
 *
 * 不要对整段转写都做——成本和延迟都不值。
 *
 * Prompt 固定版本（PROMPT_VERSIONS.asrPostEdit），变化时新版号。
 */

import { createLogger } from '@/lib/logger';
import { PROMPT_VERSIONS } from '@/lib/prompts/tutor-prompts';

const log = createLogger('asr-post-edit');

export interface PostEditSegment {
  id: string;
  text: string;
  confidence?: number;
  /** 可选：用于让 LLM 了解上下文（不参与校对） */
  contextBefore?: string;
  contextAfter?: string;
}

export interface PostEditResult {
  id: string;
  /** 可能被修改过的文本 */
  text: string;
  /** 是否被 LLM 修改 */
  modified: boolean;
  /** 若修改，原文备份 */
  originalText?: string;
}

export interface PostEditOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** confidence 低于此值的才复核。默认 0.85 */
  confidenceThreshold?: number;
  /** 单次复核最多 N 条。默认 10 */
  batchSize?: number;
  /** 可选：课堂热词/术语，作为复核参考 */
  hotwords?: string[];
  /** 可选：课程主题 */
  courseTitle?: string;
  /** LLM 请求超时（ms）。默认 20s */
  timeoutMs?: number;
}

export const POST_EDIT_PROMPT_VERSION = PROMPT_VERSIONS.asrPostEdit;

const SYSTEM_PROMPT = `你是 ASR 文本的校对员。你的任务：判断 ASR 识别出的文本是否正确，
  如果有明显错误（同音字/别字/专有名词错写）才修正，否则保持原样。

严格规则：
1. 不要"润色"——不要把口语改成书面语
2. 不要添加/删除内容，只做错别字级别的修正
3. 只有 95% 以上确信是错的才改；不确定就保持原样
4. 专有名词、人名、品牌名按标准写法修正
5. 返回 JSON 数组，每项包含 {id, text, modified}`;

function shouldReview(seg: PostEditSegment, threshold: number): boolean {
  if (typeof seg.confidence === 'number' && seg.confidence < threshold) return true;
  // 启发式：文本里含有已知易错字的，也复核
  return /[嗯啊哦呃]{2,}|(.)\1{2,}/.test(seg.text);
}

function buildUserPrompt(
  segs: PostEditSegment[],
  hotwords: string[],
  courseTitle?: string,
): string {
  const parts: string[] = [];
  if (courseTitle) parts.push(`课程：${courseTitle}`);
  if (hotwords.length > 0) {
    parts.push(
      `课程术语（若 ASR 写成相近的字，按这个标准写法修正）：${hotwords.slice(0, 30).join('、')}`,
    );
  }
  parts.push('');
  parts.push('请校对下列 ASR 片段。只改明显错别字；按严格规则不得润色。');
  parts.push('');
  parts.push('输入 JSON:');
  parts.push(
    JSON.stringify(
      segs.map((s) => ({
        id: s.id,
        text: s.text,
        confidence: s.confidence,
        contextBefore: s.contextBefore,
        contextAfter: s.contextAfter,
      })),
    ),
  );
  parts.push('');
  parts.push('输出 JSON 数组，字段 {id, text, modified}。只输出 JSON。');
  return parts.join('\n');
}

export async function postEditSegments(
  segments: PostEditSegment[],
  opts: PostEditOptions,
): Promise<PostEditResult[]> {
  if (segments.length === 0) return [];
  const threshold = opts.confidenceThreshold ?? 0.85;
  const batchSize = opts.batchSize ?? 10;
  const hotwords = opts.hotwords ?? [];

  // 按 shouldReview 分层：needs review / passthrough
  const needsReview = segments.filter((s) => shouldReview(s, threshold)).slice(0, batchSize);
  const reviewIds = new Set(needsReview.map((s) => s.id));
  const passthrough = segments.filter((s) => !reviewIds.has(s.id));

  const baseResult: PostEditResult[] = passthrough.map((s) => ({
    id: s.id,
    text: s.text,
    modified: false,
  }));

  if (needsReview.length === 0) return baseResult;

  const baseURL = opts.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = opts.model ?? 'qwen3.7-plus';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);

  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(needsReview, hotwords, opts.courseTitle) },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      log.warn('post-edit API failed, falling back to original', { status: resp.status });
      return [...baseResult, ...needsReview.map((s) => ({ id: s.id, text: s.text, modified: false }))];
    }

    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    // qwen3.7-plus with response_format=json_object 返回的是一个 object，
    // 里面的 array 通常在某个字段下；我们尝试几种形态
    let arr: unknown = null;
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) arr = parsed;
      else if (Array.isArray((parsed as { segments?: unknown }).segments)) arr = (parsed as { segments: unknown }).segments;
      else if (Array.isArray((parsed as { result?: unknown }).result)) arr = (parsed as { result: unknown }).result;
      else if (Array.isArray((parsed as { data?: unknown }).data)) arr = (parsed as { data: unknown }).data;
    } catch (err) {
      log.warn('post-edit JSON parse failed', { err: (err as Error).message });
    }

    if (!arr || !Array.isArray(arr)) {
      return [...baseResult, ...needsReview.map((s) => ({ id: s.id, text: s.text, modified: false }))];
    }

    const byId = new Map<string, { text: string; modified: boolean }>();
    for (const item of arr) {
      const it = item as { id?: string; text?: string; modified?: boolean };
      if (typeof it.id === 'string' && typeof it.text === 'string') {
        byId.set(it.id, { text: it.text, modified: Boolean(it.modified) });
      }
    }

    const reviewed: PostEditResult[] = needsReview.map((s) => {
      const r = byId.get(s.id);
      if (!r) return { id: s.id, text: s.text, modified: false };
      const changed = r.modified && r.text !== s.text && r.text.length > 0;
      return {
        id: s.id,
        text: changed ? r.text : s.text,
        modified: changed,
        originalText: changed ? s.text : undefined,
      };
    });

    return [...baseResult, ...reviewed];
  } catch (err) {
    log.warn('post-edit fetch failed', { err: (err as Error).message });
    return [...baseResult, ...needsReview.map((s) => ({ id: s.id, text: s.text, modified: false }))];
  } finally {
    clearTimeout(timer);
  }
}
