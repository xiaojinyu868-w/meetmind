/**
 * Phase MVP 验收：模拟"机构主只上传一段视频"的完整闭环
 *
 *  1) 创建机构
 *  2) 上传视频 + 挂 CoachingSource
 *  3) 触发 analyze → 期望自动生成 published 的 defaultScenario
 *  4) 学生加入机构 → GET /api/academic/scenarios 能看到这个场景
 *  5) POST /api/academic/practice 拿 sessionId + realtimeInstructions
 *  6) 用 appendTurn 追加两条 transcript
 *  7) POST finish → 拿到 markdown-able feedback
 *
 *  运行：
 *    BASE_URL=http://127.0.0.1:3002 JWT_SECRET=... npx tsx scripts/verify-academic-mvp.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import crypto, { createHmac } from 'crypto';

const dbPath = path.resolve(process.cwd(), 'prisma/meetmind.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3002';
const JWT_SECRET = process.env.JWT_SECRET || 'meetmind-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || '7200', 10);

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwt(userId: string, username: string) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(
    JSON.stringify({
      sub: userId,
      username,
      role: 'student',
      permissions: ['read:own', 'write:own'],
      iat: now,
      exp: now + JWT_EXPIRES_IN,
    }),
  );
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${h}.${p}.${sig}`;
}

async function api<T>(p: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body && !(init.body instanceof FormData) && !init.headers) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${p}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  const json = (await res.json()) as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || json.ok === false) {
    const err = json.error ?? { code: 'HTTP', message: `${res.status}` };
    throw new Error(`${p} → ${err.code}: ${err.message}`);
  }
  return (json as { data: T }).data;
}

async function createUser(prefix: string) {
  const uname = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const user = await prisma.user.create({
    data: { username: uname, nickname: uname, email: `${uname}@test.local`, passwordHash: 'x', salt: 'x', role: 'student' },
  });
  return { user, token: signJwt(user.id, user.username) };
}

async function uploadVideo(token: string) {
  const buf = await fs.readFile(path.resolve('public/videos/video1.mp4'));
  const fd = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: 'video/mp4' });
  fd.append('file', blob, 'video1.mp4');
  fd.append('title', 'video1.mp4');
  fd.append('kind', 'video');
  const res = await fetch(`${BASE}/api/console/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(`upload → ${json.error?.message || res.status}`);
  return json.data.asset as { id: string };
}

async function main() {
  const log = (m: string) => console.log(`\n▶ ${m}`);
  const ok = (m: string) => console.log(`  ✓ ${m}`);
  const fail = (m: string): never => {
    throw new Error(`❌ ${m}`);
  };

  log('准备：创建机构主 + 学生');
  const owner = await createUser('mvp_owner');
  const student = await createUser('mvp_student');
  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { id: { in: [owner.user.id, student.user.id] } } });
  };

  try {
    log('[1] 机构主创建机构');
    const { org } = await api<{ org: { id: string } }>('/api/console/orgs', owner.token, {
      method: 'POST',
      body: JSON.stringify({ name: 'MVP 测试机构', contactEmail: 'mvp@test.local', industry: 'blank' }),
    });
    ok(`orgId=${org.id}`);

    log('[2] 上传一段老师视频 + 挂 CoachingSource');
    const asset = await uploadVideo(owner.token);
    const { source } = await api<{ source: { id: string } }>(
      '/api/console/coaching-sources',
      owner.token,
      { method: 'POST', body: JSON.stringify({ assetId: asset.id, title: 'MVP 视频' }) },
    );
    ok(`sourceId=${source.id}`);

    log('[3] 触发 analyze（完成后应自动 ensure default scenario）');
    await api(`/api/console/coaching-sources/${source.id}/analyze`, owner.token, { method: 'POST' });

    const { scenarios } = await api<{ scenarios: Array<{ id: string; status: string; coachingSourceRefs: string[] }> }>(
      '/api/console/scenarios',
      owner.token,
    );
    const publishedScenario = scenarios.find((s) => s.status === 'published');
    if (!publishedScenario) {
      throw new Error('❌ analyze 完成后没有自动创建 published scenario');
    }
    if (!publishedScenario.coachingSourceRefs.includes(source.id)) fail('默认 scenario 没有关联 source');
    ok(`自动发布 scenarioId=${publishedScenario.id}，已关联 source`);

    log('[4] 学生加入机构');
    const { invite } = await api<{ invite: { token: string } }>('/api/console/members', owner.token, {
      method: 'POST',
      body: JSON.stringify({ role: 'student' }),
    });
    await api('/api/console/invite', student.token, {
      method: 'POST',
      body: JSON.stringify({ token: invite.token }),
    });

    const learnRes = await api<{ scenarios: Array<{ id: string; name: string }> }>(
      '/api/academic/scenarios',
      student.token,
    );
    if (learnRes.scenarios.length === 0) fail('学生端看不到任何场景');
    ok(`学生端能看到 ${learnRes.scenarios.length} 个场景`);

    log('[5] 学生开启 voice 陪练，验证 realtimeInstructions 非空');
    const start = await api<{
      sessionId: string;
      realtimeInstructions: string;
      sourcesUsed: string[];
    }>('/api/academic/practice', student.token, {
      method: 'POST',
      body: JSON.stringify({ scenarioId: publishedScenario.id, mode: 'voice', studentInput: {} }),
    });
    if (!start.realtimeInstructions || start.realtimeInstructions.length < 100) {
      fail(`realtimeInstructions 缺失或太短（${start.realtimeInstructions?.length ?? 0} 字符）`);
    }
    if (start.sourcesUsed.length < 1) fail('sourcesUsed 为空');
    ok(`sessionId=${start.sessionId}, realtimeInstructions=${start.realtimeInstructions.length} 字符`);

    log('[6] 用 appendTurn 追加两条 transcript');
    await api(`/api/academic/practice/${start.sessionId}/turn`, student.token, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: '我想申 CMU CS PhD，导师是 Prof. Liu。' }),
    });
    await api(`/api/academic/practice/${start.sessionId}/turn`, student.token, {
      method: 'POST',
      body: JSON.stringify({
        role: 'assistant',
        content: '先别急。那你能告诉我，Prof. Liu 最近一年发的哪一篇论文，是你真心想参与的？',
      }),
    });
    ok('追加两条语音 transcript 到 session');

    log('[7] 结束会话，检查 markdown-able feedback');
    await api(`/api/academic/practice/${start.sessionId}/finish`, student.token, { method: 'POST' });
    const final = await api<{
      feedback: { headline?: string; strengths?: string[]; improvements?: string[]; nextAction?: string } | null;
      status: string;
    }>(`/api/academic/practice/${start.sessionId}`, student.token);
    if (final.status !== 'completed') fail(`status ≠ completed，got ${final.status}`);
    const feedback = final.feedback;
    if (!feedback) {
      throw new Error('❌ feedback 为空');
    }
    ok(`feedback.headline="${feedback.headline || ''}"`);

    console.log('\n✅ MVP 链路打通：');
    console.log('   机构主 → 上传 1 段视频 → 自动分析 + 自动发布场景');
    console.log('   学生   → 看见场景 → 语音陪练（realtimeInstructions 生效）→ 反馈');
  } finally {
    log('清理测试数据');
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error('\n', e);
  await prisma.$disconnect();
  process.exit(1);
});
