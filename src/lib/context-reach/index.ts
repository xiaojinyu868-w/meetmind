import { parseVideoLink } from '@/lib/utils/video-link';

export type ContextReachKind = 'text' | 'link' | 'file';

export type ContextReachChannel =
  | 'quick-note'
  | 'video-link'
  | 'web-link'
  | 'audio-file'
  | 'video-file'
  | 'image-file'
  | 'document-file'
  | 'unsupported-file';

export interface ContextReachDetection {
  kind: ContextReachKind;
  channel: ContextReachChannel;
  label: string;
  description: string;
  shouldAutoIngest: boolean;
  url?: string;
  providerLabel?: string;
}

const AUDIO_FILE_PATTERN = /\.(mp3|wav|webm|ogg|m4a|aac|flac)$/i;
const VIDEO_FILE_PATTERN = /\.(mp4|mov|m4v|avi|mkv|webm)$/i;
const IMAGE_FILE_PATTERN = /\.(png|jpg|jpeg|webp|gif|bmp|heic|heif)$/i;
const DOCUMENT_FILE_PATTERN = /\.(txt|md|markdown|csv|json|html?|pdf|docx|ppt|pptx)$/i;
const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

export const CONTEXT_REACH_CHANNELS: Array<{
  id: ContextReachChannel;
  label: string;
  description: string;
}> = [
  { id: 'quick-note', label: '随手记录', description: '一句话、一个想法，先放进收集流。' },
  { id: 'video-link', label: '视频链接', description: '发送后自动解析，并接入当前学习上下文。' },
  { id: 'web-link', label: '网页链接', description: '先作为一条线索留下，后面再继续解析。' },
  { id: 'audio-file', label: '音频文件', description: '转写后接入当前学习主线。' },
  { id: 'video-file', label: '视频文件', description: '提取声音和时间轴后接进复习链路。' },
  { id: 'image-file', label: '图片材料', description: '识别图片里的文字和结构，作为上下文接入。' },
  { id: 'document-file', label: '材料文件', description: '课件、文档解析后作为补充上下文加入。' },
  { id: 'unsupported-file', label: '其他文件', description: '当前版本还不能自动接入这种文件。' },
];

export function extractFirstReachUrl(rawText: string): string | null {
  const match = rawText.match(URL_PATTERN);
  return match?.[1]?.trim() || null;
}

export function isAudioReachFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name);
}

export function isVideoReachFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('video/') || VIDEO_FILE_PATTERN.test(file.name);
}

export function isImageReachFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name);
}

export function isDocumentReachFile(file: Pick<File, 'name'>): boolean {
  return DOCUMENT_FILE_PATTERN.test(file.name);
}

export function detectReachFromText(rawText: string): ContextReachDetection {
  const trimmed = rawText.trim();
  const url = extractFirstReachUrl(trimmed);

  if (!url) {
    return {
      kind: 'text',
      channel: 'quick-note',
      label: '随手记录',
      description: '像聊天一样先记下来，不急着马上整理。',
      shouldAutoIngest: false,
    };
  }

  const parsed = parseVideoLink(url);
  if (parsed && parsed.provider !== 'generic') {
    return {
      kind: 'link',
      channel: 'video-link',
      label: parsed.providerLabel,
      description: '发送后会自动解析，并接进当前收集流。',
      shouldAutoIngest: true,
      url,
      providerLabel: parsed.providerLabel,
    };
  }

  return {
    kind: 'link',
    channel: 'web-link',
    label: '网页链接',
    description: '会先作为一条网页线索留在这里，后面再继续解析。',
    shouldAutoIngest: false,
    url,
    providerLabel: '网页',
  };
}

export function detectReachFromFile(file: Pick<File, 'type' | 'name'>): ContextReachDetection {
  if (isAudioReachFile(file)) {
    return {
      kind: 'file',
      channel: 'audio-file',
      label: '音频文件',
      description: '转写后接进当前学习主线。',
      shouldAutoIngest: true,
    };
  }

  if (isVideoReachFile(file)) {
    return {
      kind: 'file',
      channel: 'video-file',
      label: '视频文件',
      description: '会先提取声音，再接进当前复习链路。',
      shouldAutoIngest: true,
    };
  }

  if (isImageReachFile(file)) {
    return {
      kind: 'file',
      channel: 'image-file',
      label: '图片材料',
      description: '会识别图片里的内容，再作为学习上下文接入。',
      shouldAutoIngest: true,
    };
  }

  if (isDocumentReachFile(file)) {
    return {
      kind: 'file',
      channel: 'document-file',
      label: '材料文件',
      description: '课件、文档解析后作为补充上下文加入。',
      shouldAutoIngest: true,
    };
  }

  return {
    kind: 'file',
    channel: 'unsupported-file',
    label: '其他文件',
    description: '当前版本还不能自动接入这种文件。',
    shouldAutoIngest: false,
  };
}
