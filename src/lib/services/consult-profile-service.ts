/**
 * consult-profile-service —— 学生画像读写 + 场景会话 + CTA 线索
 *
 * 对应 Prisma 模型：ConsultStudent / ConsultLead。
 * 职责：
 *   - 按 (orgId, studentKey) 读写画像（upsert）
 *   - 字段白名单：只接受 student-profile.md 规定的 key；其它丢到 institution_tags 里
 *   - 合并策略：浅合并 + 数组去重（按 id/name/deep equality）
 *   - 快照读取：CTA 生成时取画像快照写入 Lead
 */

import { prisma } from '@/lib/prisma';

// ──────────────── 字段白名单（对齐 platform-skills 的 student-profile.md） ────────────────

export const PROFILE_ALLOWED_KEYS = new Set([
  // Goals
  'target_country',
  'target_region',
  'target_degree',
  'target_field',
  'target_start_term',
  'target_schools',
  'target_programs',
  // Background
  'cv',
  'gpa',
  'test_scores',
  // Advisor / program hunting
  'advisor_candidates',
  // Positioning / story
  'strengths',
  'weaknesses',
  'narrative_angle',
  'tone_preference',
  // Session artifacts
  'artifacts',
  // Concerns
  'worries',
  // Institution-specific escape hatch
  'institution_tags',
]);

export const PROFILE_READONLY_KEYS = new Set([
  'studentId',
  'nickname',
  'email',
  'wechatId',
  'sessions_count',
  'mock_interview_attempts',
  'cold_emails_drafted',
]);

export function isAllowedProfileKey(key: string): boolean {
  // 支持 dot-path，如 "cv.text"；只校验根字段
  const root = key.split('.')[0];
  return PROFILE_ALLOWED_KEYS.has(root);
}

// ──────────────── 读 ────────────────

interface RawStudent {
  id: string;
  orgId: string;
  studentKey: string;
  profileJson: string;
}

async function findOrCreateStudent(orgId: string, studentKey: string): Promise<RawStudent> {
  const existing = await prisma.consultStudent.findUnique({
    where: { orgId_studentKey: { orgId, studentKey } },
  });
  if (existing) return existing as RawStudent;
  return (await prisma.consultStudent.create({
    data: { orgId, studentKey, profileJson: '{}' },
  })) as RawStudent;
}

function parseProfile(raw: RawStudent): Record<string, unknown> {
  try {
    const obj = JSON.parse(raw.profileJson);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
  } catch {}
  return {};
}

function resolvePath(profile: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let v: unknown = profile;
  for (const p of parts) {
    if (v && typeof v === 'object' && !Array.isArray(v) && p in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return v;
}

export async function readProfile(
  orgId: string,
  studentKey: string,
  keys: string[],
): Promise<{ profile: Record<string, unknown>; missing: string[]; rejected: string[] }> {
  const student = await findOrCreateStudent(orgId, studentKey);
  const profile = parseProfile(student);

  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  const rejected: string[] = [];

  for (const k of keys) {
    if (!isAllowedProfileKey(k) && !PROFILE_READONLY_KEYS.has(k.split('.')[0])) {
      rejected.push(k);
      continue;
    }
    const v = resolvePath(profile, k);
    if (v === undefined) missing.push(k);
    else out[k] = v;
  }

  return { profile: out, missing, rejected };
}

// ──────────────── 写 ────────────────

export async function writeProfile(
  orgId: string,
  studentKey: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; writtenKeys: string[]; rejectedKeys: string[] }> {
  const student = await findOrCreateStudent(orgId, studentKey);
  const current = parseProfile(student);

  const written: string[] = [];
  const rejected: string[] = [];

  for (const [rawKey, value] of Object.entries(patch)) {
    const rootKey = rawKey.split('.')[0];
    const nextValue = rootKey === 'advisor_candidates' ? normalizeAdvisorCandidates(value) : value;
    if (PROFILE_READONLY_KEYS.has(rootKey)) {
      rejected.push(rawKey);
      continue;
    }
    if (!isAllowedProfileKey(rawKey)) {
      // 不在白名单 → 塞到 institution_tags 而不是丢弃（对机构有用）
      const tags = (current.institution_tags as Record<string, unknown> | undefined) ?? {};
      tags[rawKey] = nextValue;
      current.institution_tags = tags;
      written.push(`institution_tags.${rawKey}`);
      continue;
    }

    if (rawKey.includes('.')) {
      // dot-path：深合并到对应子对象
      const parts = rawKey.split('.');
      let cursor: Record<string, unknown> = current;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (!cursor[p] || typeof cursor[p] !== 'object') cursor[p] = {};
        cursor = cursor[p] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]] = nextValue;
      written.push(rawKey);
    } else if (Array.isArray(current[rootKey]) && Array.isArray(nextValue)) {
      // 数组：deep merge 去重（按 JSON.stringify）
      const before = current[rootKey] as unknown[];
      const seen = new Set(before.map((x) => JSON.stringify(x)));
      const merged = [...before];
      for (const v of nextValue) {
        const key = JSON.stringify(v);
        if (!seen.has(key)) {
          merged.push(v);
          seen.add(key);
        }
      }
      current[rootKey] = merged;
      written.push(rawKey);
    } else {
      current[rootKey] = nextValue;
      written.push(rawKey);
    }
  }

  await prisma.consultStudent.update({
    where: { id: student.id },
    data: { profileJson: JSON.stringify(current) },
  });

  return { ok: true, writtenKeys: written, rejectedKeys: rejected };
}

function normalizeAdvisorCandidates(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const record = candidate as Record<string, unknown>;
    return {
      status: 'mentioned',
      starred: false,
      ...record,
    };
  });
}

// ──────────────── 快照（给 CTA 用） ────────────────

export async function snapshotProfile(
  orgId: string,
  studentKey: string,
): Promise<{ studentId: string; profile: Record<string, unknown> }> {
  const student = await findOrCreateStudent(orgId, studentKey);
  return { studentId: student.id, profile: parseProfile(student) };
}
