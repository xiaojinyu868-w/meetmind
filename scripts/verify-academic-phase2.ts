/**
 * Phase 2 端到端验收
 *
 * 覆盖：
 *  1) 上传文档 asset + 自动拆分为 Playbook 片段（P2-2）
 *  2) 上传视频 asset（public/videos/video1.mp4） + 挂为 CoachingSource + 分析（P2-3）
 *  3) 创建一个 scenario 并关联 CoachingSource + Playbook 片段
 *  4) 发布 + 试跑，确认 sourcesUsed 和 playbookSectionsUsed 都 > 0
 *  5) 学生接受邀请 + 开始 PracticeSession，拿到 assistant 回复
 *  6) 结束会话 + 检查 feedbackJson 非空
 *  7) 清理
 *
 * 运行：
 *   1) 另一个终端 make dev（端口 3001）
 *   2) npx tsx scripts/verify-academic-phase2.ts
 *
 * 成本提醒：会真实调用 qwen3.5-plus 做文档拆分、视频理解、对话、反馈总结。
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import crypto, { createHmac } from 'crypto';

const dbPath = path.resolve(process.cwd(), 'prisma/meetmind.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'meetmind-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || '7200', 10);

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwt(userId: string, username: string) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ sub: userId, username, role: 'student', permissions: ['read:own', 'write:own'], iat: now, exp: now + JWT_EXPIRES_IN }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

async function uploadFile(token: string, file: { path: string; filename: string; mime: string; kind?: string }) {
  const buf = await fs.readFile(file.path);
  const fd = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: file.mime });
  fd.append('file', blob, file.filename);
  fd.append('title', file.filename);
  if (file.kind) fd.append('kind', file.kind);
  const res = await fetch(`${BASE}/api/console/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(`upload ${file.filename} → ${json.error?.message || res.status}`);
  return json.data.asset as { id: string; kind: string; status: string };
}

async function main() {
  const log = (m: string) => console.log(`\n▶ ${m}`);
  const ok = (m: string) => console.log(`  ✓ ${m}`);
  const fail = (m: string): never => { throw new Error(`❌ ${m}`); };

  log('准备：创建 owner + student 账号');
  const owner = await createUser('p2_owner');
  const student = await createUser('p2_student');

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { id: { in: [owner.user.id, student.user.id] } } });
  };

  try {
    log('[1] 创建机构 A（申博）');
    const { org } = await api<{ org: { id: string } }>(
      '/api/console/orgs',
      owner.token,
      { method: 'POST', body: JSON.stringify({ name: 'P2 测试机构', contactEmail: 'p2@test.local', industry: 'shenbo' }) },
    );
    ok(`orgId=${org.id}`);
    // step up onboarding
    for (const step of [2, 3, 4, 5]) {
      await api(`/api/console/orgs/${org.id}/onboarding`, owner.token, { method: 'POST', body: JSON.stringify({ step }) });
    }

    // ============= 文档拆分 =============
    log('[2] 创建一个 txt 文档作为 playbook 来源，并上传 + 拆分');
    // 用一段申博机构风格的 playbook 文本
    const txtPath = path.resolve('/tmp/p2-playbook.txt');
    await fs.writeFile(
      txtPath,
      `# 卿云申博 playbook 示例

## 交付主线
1. 目标与动机梳理
2. 导师初筛
3. 套磁
4. 面试训练

## 常用话术
- 开场："先别急，我们从一个问题开始。"
- 追问："这段回答里，哪一句是真正回答问题的？"

## 判断标准
- 学生是否清楚自己要解决什么问题
- 研究兴趣与导师实验室的真实匹配度
- 表达能不能撑住真实面试

## 禁区
- 不替学生决定投哪所学校
- 不承诺录取概率
`,
    );
    const docAsset = await uploadFile(owner.token, { path: txtPath, filename: 'playbook.txt', mime: 'text/plain', kind: 'document' });
    ok(`上传文档 assetId=${docAsset.id}`);

    log('[2] 调用 /extract 触发 LLM 拆分（会真实调 qwen3.5-plus）');
    const extracted = await api<{ count: number; sections: { id: string; title: string }[] }>(
      `/api/console/assets/${docAsset.id}/extract`,
      owner.token,
      { method: 'POST' },
    );
    if (extracted.count < 1) fail('没拆出任何片段');
    ok(`已拆分为 ${extracted.count} 条 Playbook`);

    // ============= 视频理解 =============
    log('[3] 上传 public/videos/video1.mp4 作为老师视频');
    const videoPath = path.resolve('public/videos/video1.mp4');
    const videoAsset = await uploadFile(owner.token, { path: videoPath, filename: 'video1.mp4', mime: 'video/mp4', kind: 'video' });
    ok(`上传视频 assetId=${videoAsset.id}`);

    log('[3] 挂为 CoachingSource');
    const { source } = await api<{ source: { id: string; status: string } }>(
      '/api/console/coaching-sources',
      owner.token,
      { method: 'POST', body: JSON.stringify({ assetId: videoAsset.id, title: '视频1-测试样本' }) },
    );
    ok(`sourceId=${source.id}`);

    log('[3] 触发视频段级分析（30-120s；要 ffmpeg 可用）');
    const { analysis } = await api<{ analysis: { segmentCount: number; teacherStyle: { voiceSummary: string } } }>(
      `/api/console/coaching-sources/${source.id}/analyze`,
      owner.token,
      { method: 'POST' },
    );
    ok(`分析完成，段数=${analysis.segmentCount}，voice=${(analysis.teacherStyle.voiceSummary || '').slice(0, 50)}…`);

    // ============= 创建 scenario 挂资产 =============
    log('[4] 创建 scenario 并关联 source + 前 2 条 playbook 片段');
    const pbIds = extracted.sections.slice(0, 2).map((s) => s.id);
    const { scenario } = await api<{ scenario: { id: string } }>(
      '/api/console/scenarios',
      owner.token,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'P2 博士面试模拟',
          description: '对接老师视频 + 机构 playbook',
          productKind: 'mock-interview',
          studentInputSchema: [{ key: 'target', label: '目标', kind: 'text', required: true }],
          personaSeed: { tone: 'direct', style: 'interviewer', feedbackAxes: ['研究深度'], forbiddenZones: [] },
          checkpointTriggers: [],
          coachingSourceRefs: [source.id],
          playbookSectionRefs: pbIds,
          industryTemplate: 'shenbo',
          promptPatch: {},
        }),
      },
    );
    ok(`scenarioId=${scenario.id}`);

    log('[4] 发布 scenario');
    await api(`/api/console/scenarios/${scenario.id}/publish`, owner.token, { method: 'POST' });

    log('[4] 试跑：验证 sourcesUsed 与 playbookSectionsUsed > 0');
    const { scenario: full } = await api<{ scenario: { id: string; orgId: string; status: string; [k: string]: unknown } }>(
      `/api/console/scenarios/${scenario.id}`,
      owner.token,
    );
    const { id: _i1, orgId: _o1, status: _s1, currentVersionId: _c1, createdAt: _ca1, updatedAt: _u1, ...draft } = full as Record<string, unknown>;
    const tryRes = await api<{ assistantReply: string; sourcesUsed: string[]; playbookSectionsUsed: number }>(
      `/api/console/scenarios/${scenario.id}/try`,
      owner.token,
      { method: 'POST', body: JSON.stringify({ draft, messages: [{ role: 'user', content: '你好，我想开始' }] }) },
    );
    if (tryRes.sourcesUsed.length < 1) fail('试跑时 sourcesUsed 为空');
    if (tryRes.playbookSectionsUsed < 1) fail('试跑时 playbookSectionsUsed 为 0');
    ok(`sourcesUsed=${tryRes.sourcesUsed.length}, playbookSectionsUsed=${tryRes.playbookSectionsUsed}`);
    ok(`试跑 AI 回复（前 80 字）：${tryRes.assistantReply.slice(0, 80)}…`);

    // ============= 学生练习 + 反馈 =============
    log('[5] 邀请学生加入并开始 PracticeSession');
    const { invite } = await api<{ invite: { token: string } }>(
      '/api/console/members',
      owner.token,
      { method: 'POST', body: JSON.stringify({ role: 'student' }) },
    );
    await api('/api/console/invite', student.token, { method: 'POST', body: JSON.stringify({ token: invite.token }) });

    const startRes = await api<{ sessionId: string; sourcesUsed: string[]; playbookSectionsUsed: number }>(
      '/api/academic/practice',
      student.token,
      { method: 'POST', body: JSON.stringify({ scenarioId: scenario.id, mode: 'text', studentInput: { target: 'CMU CS PhD' } }) },
    );
    if (startRes.sourcesUsed.length < 1) fail('会话启动时 sourcesUsed 为空');
    ok(`sessionId=${startRes.sessionId}，sourcesUsed=${startRes.sourcesUsed.length}, playbook=${startRes.playbookSectionsUsed}`);

    await api(`/api/academic/practice/${startRes.sessionId}/message`, student.token, {
      method: 'POST',
      body: JSON.stringify({ content: '我对 Prof. Liu 的分布式训练工作感兴趣，和我实习经验对得上。' }),
    });
    ok('发送一条学生消息，收到 AI 回复');

    log('[6] 结束会话，检查 feedbackJson 非空');
    await api(`/api/academic/practice/${startRes.sessionId}/finish`, student.token, { method: 'POST' });
    const final = await api<{ feedback: { headline?: string } | null; status: string }>(
      `/api/academic/practice/${startRes.sessionId}`,
      student.token,
    );
    if (final.status !== 'completed') fail(`status should be completed, got ${final.status}`);
    if (!final.feedback) fail('feedback 为空（LLM 总结失败）');
    ok(`feedback.headline="${final.feedback?.headline || ''}"`);

    console.log('\n✅ Phase 2 所有关键链路打通：文档拆分 / 视频理解 / 场景关联 / 学生练习 / 反馈摘要');
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
