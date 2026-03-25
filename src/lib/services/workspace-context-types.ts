/**
 * Workspace Context Service — 类型 + 纯工具函数
 *
 * 从 workspace-context-service.ts 提取，无 Prisma 依赖。
 */

import path from 'path';
import type { EchoMemorySummary, EchoRecommendation } from '@/lib/services/workspace-echo-service';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type WorkspaceCaptureStatus = 'active' | 'archived' | 'deleted';

export interface WorkspaceCaptureSummary {
  id: string;
  sourceKey: string;
  sourceType: string;
  status: WorkspaceCaptureStatus;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  tutorContext?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface WorkspaceEchoSummary {
  id: string;
  sourceKey: string;
  kind?: string | null;
  generatedDateKey?: string | null;
  title: string;
  body: string;
  chips: string[];
  recommendations: EchoRecommendation[];
  memory: EchoMemorySummary | null;
  sourceCaptureIds: string[];
  sourceKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkspaceCaptureInput {
  sourceType: string;
  sourceKey: string;
  role: string;
  contentType: string;
  title: string;
  previewText?: string;
  normalizedText?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  tutorContext?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkspaceCaptureContentInput extends WorkspaceCaptureLookupInput {
  title?: string | null;
  previewText?: string | null;
  normalizedText?: string | null;
  tutorContext?: string | null;
}

export interface WorkspaceCaptureLookupInput {
  captureId?: string;
  sourceKey?: string;
}

/* ------------------------------------------------------------------ */
/*  Pure helper functions                                              */
/* ------------------------------------------------------------------ */

export function compactText(value: string, limit: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

export function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export function parseJsonObject(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeCaptureStatus(value?: string | null): WorkspaceCaptureStatus {
  if (value === 'archived' || value === 'deleted') return value;
  return 'active';
}

export function normalizeOptionalCaptureText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

/* ------------------------------------------------------------------ */
/*  Wechat helper functions                                           */
/* ------------------------------------------------------------------ */

export function inferWechatContentType(message: {
  msgType: string;
  reachChannel?: string | null;
}): string {
  if (message.msgType === 'voice') return 'audio';
  if (message.msgType === 'image') return 'image';
  if (message.reachChannel === 'video-link') return 'video';
  if (message.msgType === 'link') return 'link';
  return 'text';
}

export function buildWechatCaptureTitle(message: {
  title?: string | null;
  msgType: string;
}): string {
  if (message.title?.trim()) return compactText(message.title.trim(), 60);
  if (message.msgType === 'voice') return '微信语音';
  if (message.msgType === 'image') return '微信图片';
  if (message.msgType === 'link') return '微信链接';
  if (message.msgType === 'event') return '微信服务号消息';
  return '微信随手记';
}

export function mimeTypeFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.amr') return 'audio/amr';
  return 'application/octet-stream';
}
