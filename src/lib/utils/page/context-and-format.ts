/**
 * ASR/Tutor 上下文构建、视频洞察、格式化工具、API 调用辅助。
 */

import type { TranscriptSegment } from '@/types';
import type { SupportReferenceItem, WorkspaceEchoMessage } from '@/types/page-types';
import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import { compactText, compactMultilineText, VIDEO_INSIGHT_COLORS } from './text-and-constants';

// ── API helpers ───────────────────────────────────────────────────

export async function readJsonApiResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = compactText(raw.replace(/\s+/g, ' ').trim(), 200);
    const _detail = snippet ? `：${snippet}` : '';
    throw new Error(`${errorPrefix}（接口返回非 JSON，HTTP ${response.status}）${_detail}`);
  }
}

// ── ASR / Tutor context builders ──────────────────────────────────

export function buildASRContextHint(params: {
  manualHint: string;
  recentSegments: TranscriptSegment[];
  importedReferences?: string[];
  maxChars?: number;
}): string {
  const manualHint = compactText(params.manualHint || '', 800);
  const importedReferences = (params.importedReferences || [])
    .map((item) => compactText(item, 1000))
    .filter(Boolean)
    .slice(0, 3);
  const recentContext = compactText(
    params.recentSegments
      .slice(-30)
      .map((segment) => segment.text)
      .join(' '),
    1400
  );

  const parts = [
    manualHint ? `课程主题/术语：${manualHint}` : '',
    importedReferences.length > 0 ? `参考资料：${importedReferences.join('\n')}` : '',
    recentContext ? `已识别课堂上下文：${recentContext}` : '',
  ].filter(Boolean);

  if (parts.length === 0) return '';
  return compactText(parts.join('\n\n'), params.maxChars ?? 3000);
}

export function buildTutorSupportContextText(
  supportReferences: SupportReferenceItem[],
  workspaceEchoes: WorkspaceEchoMessage[] = [],
  maxChars: number = 6500
): string {
  const references = (supportReferences || [])
    .map((item) => ({
      title: compactText(item.title, 80),
      snippet: compactText(item.snippet, 1400),
    }))
    .filter((item) => item.snippet.length > 0)
    .slice(0, 6);

  const echoes = (workspaceEchoes || [])
    .map((item) => ({
      title: compactText(item.title, 80),
      body: compactText(item.body, 220),
      chips: Array.isArray(item.chips) ? item.chips.filter(Boolean).slice(0, 3) : [],
    }))
    .filter((item) => item.body.length > 0)
    .slice(0, 4);

  if (references.length === 0 && echoes.length === 0) return '';

  const sections: string[] = [];

  if (references.length > 0) {
    const labeledReferences = references
      .map((item, index) => `[资料${index + 1}] 标题：${item.title}\n摘录：${item.snippet}`)
      .join('\n\n');

    sections.push(
      [
        '以下是用户主动加入的补充材料，请在回答时优先参考。',
        '如果引用了这些材料，请在对应句子后标注 [资料N]。',
        '如果材料与课堂转录冲突，请明确指出冲突。',
        '',
        labeledReferences,
      ].join('\n')
    );
  }

  if (echoes.length > 0) {
    const labeledEchoes = echoes
      .map((item, index) => {
        const chips = item.chips.length > 0 ? `\n标签：${item.chips.join(' / ')}` : '';
        return `[回声${index + 1}] 标题：${item.title}\n内容：${item.body}${chips}`;
      })
      .join('\n\n');

    sections.push(
      [
        '以下是系统基于近期学习上下文生成的回声，可用于理解用户最近更在意什么、卡在什么层次、适合怎样的解释方式。',
        '这些回声是理解线索，不是硬事实；不要生硬复述，要把它们用在更贴近用户状态的表达里。',
        '',
        labeledEchoes,
      ].join('\n')
    );
  }

  return compactMultilineText(sections.join('\n\n'), maxChars);
}

export function buildTutorQuestionFromEcho(
  params: {
    title: string;
    body: string;
    chips?: string[];
  },
  _mode: 'explore' | 'review' = 'explore'
): string {
  return compactMultilineText(
    `顺着这条回声继续带我学：\n${params.body}`,
    280
  );
}

// ── Video insight helpers ─────────────────────────────────────────

export function buildSeedVideoInsights(segments: TranscriptSegment[]): VideoInsightItem[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const valid = segments.filter((seg) => seg && typeof seg.text === 'string' && seg.text.trim().length > 0);
  if (valid.length === 0) return [];

  const maxPoints = 5;
  const step = Math.max(1, Math.floor(valid.length / maxPoints));
  const timestamps: number[] = [];
  for (let index = 0; index < valid.length && timestamps.length < maxPoints; index += step) {
    timestamps.push(Math.max(0, valid[index].startMs));
  }

  if (timestamps.length === 0) {
    timestamps.push(Math.max(0, valid[0].startMs));
  }

  return [
    {
      id: 'seed-overview',
      prompt: '导入完成，已生成时间轴预览',
      summary: compactText(valid.slice(0, 3).map((seg) => seg.text).join(' '), 120),
      timestamps: Array.from(new Set(timestamps)).sort((a, b) => a - b),
      color: VIDEO_INSIGHT_COLORS[0],
    },
  ];
}

// ── Format helpers ────────────────────────────────────────────────

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

export function formatRelativeCollectionTime(isoString?: string): string {
  if (!isoString) return '刚刚';
  const timestamp = new Date(isoString).getTime();
  if (!Number.isFinite(timestamp)) return '刚刚';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

export function buildSourcePreviewText(segments: TranscriptSegment[], maxLength = 160): string {
  return compactText(
    (segments || [])
      .map((segment) => segment.text || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength
  );
}

export function normalizeImportedVideoSegments(payload: {
  segments?: TranscriptSegment[];
  sentences?: Array<{
    id?: string;
    text?: string;
    beginTime?: number;
    endTime?: number;
    confidence?: number;
  }>;
}): TranscriptSegment[] {
  if (Array.isArray(payload.segments) && payload.segments.length > 0) {
    return payload.segments;
  }

  return (payload.sentences || []).map((item, index) => ({
    id: item.id || `video-seg-${index}`,
    text: String(item.text || ''),
    startMs: Number(item.beginTime || 0),
    endMs: Number(item.endTime || 0),
    confidence: Number(item.confidence || 0.95),
    isFinal: true,
  }));
}

// ── API call helpers ──────────────────────────────────────────────

/**
 * Transcribe an audio file via /api/transcribe-turbo or /api/transcribe with
 * automatic fallback. Files ≤ 12 MB prefer the turbo endpoint first.
 */
export async function transcribeAudioFile(
  file: File,
  contextHint: string,
): Promise<TranscriptSegment[]> {
  const createFormData = () => {
    const formData = new FormData();
    formData.append('audio', file);
    if (contextHint.trim()) {
      formData.append('context', contextHint.trim());
    }
    return formData;
  };

  const preferTurbo = file.size <= 12 * 1024 * 1024;
  const endpoints = preferTurbo
    ? (['/api/transcribe-turbo', '/api/transcribe'] as const)
    : (['/api/transcribe', '/api/transcribe-turbo'] as const);

  let response: Response | null = null;
  let payload: {
    success?: boolean;
    error?: string;
    code?: string;
    segments?: TranscriptSegment[];
    sentences?: Array<{
      id?: string;
      text: string;
      beginTime?: number;
      endTime?: number;
    }>;
  } = {};
  let lastErrorMessage = '音频转写失败';

  for (const endpoint of endpoints) {
    response = await fetch(endpoint, {
      method: 'POST',
      body: createFormData(),
    });

    payload = await readJsonApiResponse<typeof payload>(response, '音频转写');

    if (response.ok && !payload.error) break;

    lastErrorMessage = payload.error || `音频转写失败 (HTTP ${response.status})`;

    if (payload.code === 'RATE_LIMIT' || response.status === 429) {
      throw new Error(lastErrorMessage);
    }
  }

  if (!response?.ok || payload.error) {
    throw new Error(lastErrorMessage);
  }

  const rawSegments = payload.segments || [];
  if (rawSegments.length > 0) return rawSegments;

  return (payload.sentences || []).map((sentence, index) => ({
    id: sentence.id || `file-seg-${index}`,
    text: sentence.text,
    startMs: sentence.beginTime || 0,
    endMs: sentence.endTime || 0,
    confidence: 0.9,
    isFinal: true,
  }));
}

/**
 * Upload a document file for server-side parsing (text / PDF / docx …).
 */
export async function parseDocumentFile(
  file: File,
): Promise<{ title: string; fileType: string; segments: TranscriptSegment[] }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/sources/ingest', {
    method: 'POST',
    body: formData,
  });
  const payload = await readJsonApiResponse<{
    success?: boolean;
    error?: string;
    title?: string;
    fileType?: string;
    segments?: TranscriptSegment[];
  }>(response, '文档导入失败');
  if (!response.ok || !payload.success || !Array.isArray(payload.segments)) {
    throw new Error(payload.error || '文档导入失败');
  }
  return {
    title: payload.title || file.name,
    fileType: payload.fileType || 'document',
    segments: payload.segments,
  };
}

/**
 * Upload an image file for server-side OCR / analysis.
 */
export async function parseImageFile(
  file: File,
): Promise<{ title: string; fileType: string; segments: TranscriptSegment[] }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/sources/ingest-image', {
    method: 'POST',
    body: formData,
  });
  const payload = await readJsonApiResponse<{
    success?: boolean;
    error?: string;
    title?: string;
    fileType?: string;
    segments?: TranscriptSegment[];
  }>(response, '图片解析失败');
  if (!response.ok || !payload.success || !Array.isArray(payload.segments)) {
    throw new Error(payload.error || '图片解析失败');
  }
  return {
    title: payload.title || file.name,
    fileType: payload.fileType || 'image',
    segments: payload.segments,
  };
}
