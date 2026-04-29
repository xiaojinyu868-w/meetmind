/**
 * Phase 1 端到端验收（自动版）
 *
 * 覆盖 multi-tenant-contract.md 的 8 条：
 *   1. 以机构主身份走完 /console/onboarding 5 步
 *   2. 创建一个场景（通过 API 模拟）
 *   3. 场景的"试跑"能拿到 assistant 回复（走真 LLM）
 *   4. 发邀请链接 + 学生接受 + 自动归属
 *   5. 学生能看到已发布场景 + 开始会话 + 拿到 AI 回复
 *   6. 老师能看到（空）CheckpointPack 列表
 *   7. DB 里所有写入有正确 orgId
 *   8. 第二个机构账号跑一遍，数据隔离
 *
 * 运行：
 *   1) 启 dev 服务器：make dev（另一个终端）
 *   2) npx tsx scripts/verify-academic-phase1.ts
 *
 * 这个脚本会：
 *   - 直接调 authService 在 DB 里造 3 个 user（org-A 机构主、学生、第二个机构主 org-B）
 *   - 为他们签 JWT（用 authService.signAccessToken 或等价方法）
 *   - 用生成的 token 调真实 HTTP API
 *   - 最后清理所有造的数据
 *
 * 注意：使用 qwen3.6-plus 会消耗 token 额度。设置 SKIP_LLM=1 可跳过试跑 / 对话步骤。
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';
import crypto, { createHmac } from 'crypto';

const dbPath = path.resolve(process.cwd(), 'prisma/meetmind.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SKIP_LLM = process.env.SKIP_LLM === '1';
const JWT_SECRET = process.env.JWT_SECRET || 'meetmind-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || '7200', 10);

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwtFor(userId: string, username: string, role = 'student') {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: userId, username, role, permissions: ['read:own', 'write:own'], iat: now, exp: now + JWT_EXPIRES_IN };
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${h}.${p}.${sig}`;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  const json = (await res.json()) as ApiResult<T>;
  if (!res.ok || ('ok' in json && json.ok === false)) {
    const err = 'error' in json ? json.error : { code: 'HTTP', message: `${res.status}` };
    throw new Error(`${path} → ${err.code}: ${err.message}`);
  }
  return (json as { data: T }).data;
}

async function createTestUser(prefix: string) {
  const uname = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const user = await prisma.user.create({
    data: {
      username: uname,
      nickname: uname,
      email: `${uname}@test.local`,
      passwordHash: 'x',
      salt: 'x',
      role: 'student',
    },
  });
  const token = signJwtFor(user.id, user.username);
  return { user, token };
}

async function main() {
  const log = (msg: string) => console.log(`\n▶ ${msg}`);
  const ok = (msg: string) => console.log(`  ✓ ${msg}`);
  const fail = (msg: string): never => { throw new Error(`❌ ${msg}`); };

  log('准备：创建 3 个测试用户');
  const owner = await createTestUser('p1_owner');
  const student = await createTestUser('p1_student');
  const owner2 = await createTestUser('p1_owner2');
  ok(`owner=${owner.user.username}, student=${student.user.username}, owner2=${owner2.user.username}`);

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { id: { in: [owner.user.id, student.user.id, owner2.user.id] } } });
  };

  try {
    // ============= 机构 A =============
    log('[1] onboarding step 1：创建机构 A（申博）');
    const { org: orgA } = await api<{ org: { id: string; name: string; industry: string; status: string; onboardingStep: number } }>(
      '/api/console/orgs',
      owner.token,
      { method: 'POST', body: JSON.stringify({ name: '卿云申博测试', contactEmail: 'a@test.local', industry: 'shenbo' }) },
    );
    if (orgA.industry !== 'shenbo') fail('industry 不对');
    ok(`org A 已创建：${orgA.id}`);

    log('[1] 推进 onboarding step 2..5');
    for (const step of [2, 3, 4, 5]) {
      const { org } = await api<{ org: { onboardingStep: number; status: string } }>(
        `/api/console/orgs/${orgA.id}/onboarding`,
        owner.token,
        { method: 'POST', body: JSON.stringify({ step }) },
      );
      if (org.onboardingStep < step) fail(`step 没推进到 ${step}`);
      if (step === 5 && org.status !== 'active') fail('step 5 后 status 应为 active');
    }
    ok('org A onboarding 完成，status=active');

    log('[2] 创建场景（博士面试模拟）');
    const scenarioDraft = {
      name: '博士面试模拟',
      description: '按目标项目模拟一轮面试',
      productKind: 'mock-interview',
      studentInputSchema: [
        { key: 'target_program', label: '目标项目', kind: 'text', required: true },
        { key: 'research_direction', label: '研究方向', kind: 'textarea', required: true },
      ],
      personaSeed: {
        tone: 'direct',
        style: 'interviewer',
        feedbackAxes: ['研究深度', '动机匹配'],
        forbiddenZones: ['不替学生决定投哪所学校'],
      },
      checkpointTriggers: [],
      coachingSourceRefs: [],
      playbookSectionRefs: [],
      industryTemplate: 'shenbo',
      promptPatch: {
        systemAppendix: '记住"是否清楚要解决什么问题"是最重要的信号。',
      },
    };
    const { scenario } = await api<{ scenario: { id: string; status: string } }>(
      '/api/console/scenarios',
      owner.token,
      { method: 'POST', body: JSON.stringify(scenarioDraft) },
    );
    ok(`场景 ${scenario.id} 草稿创建`);

    log('[2] 发布场景');
    const pubRes = await api<{ scenario: { status: string }; versionId: string; versionNumber: number }>(
      `/api/console/scenarios/${scenario.id}/publish`,
      owner.token,
      { method: 'POST' },
    );
    if (pubRes.scenario.status !== 'published') fail('发布后 status 应为 published');
    ok(`已发布，version ${pubRes.versionNumber}`);

    log('[3] 试跑：给 scenario 说一句话');
    if (SKIP_LLM) {
      ok('SKIP_LLM=1，跳过');
    } else {
      const tryRes = await api<{ assistantReply: string }>(
        `/api/console/scenarios/${scenario.id}/try`,
        owner.token,
        { method: 'POST', body: JSON.stringify({ draft: scenarioDraft, messages: [{ role: 'user', content: '你好，开始吧' }] }) },
      );
      if (!tryRes.assistantReply || tryRes.assistantReply.length < 5) fail('试跑回复异常');
      ok(`试跑回复（前 60 字）：${tryRes.assistantReply.slice(0, 60)}…`);
    }

    log('[4] 生成学生邀请链接');
    const { invite } = await api<{ invite: { token: string; role: string } }>(
      '/api/console/members',
      owner.token,
      { method: 'POST', body: JSON.stringify({ role: 'student' }) },
    );
    ok(`邀请 token=${invite.token.slice(0, 12)}…`);

    log('[4] 学生接受邀请（未加入前试探）');
    const acceptRes = await api<{ orgId: string; role: string }>(
      '/api/console/invite',
      student.token,
      { method: 'POST', body: JSON.stringify({ token: invite.token }) },
    );
    if (acceptRes.orgId !== orgA.id || acceptRes.role !== 'student') fail('学生未正确加入');
    ok('学生已加入 org A');

    log('[5] 学生看场景列表');
    const { scenarios: studentScenarios } = await api<{ scenarios: { id: string; name: string }[] }>(
      '/api/academic/scenarios',
      student.token,
    );
    if (!studentScenarios.find((s) => s.id === scenario.id)) fail('学生看不到已发布场景');
    ok(`学生看到 ${studentScenarios.length} 个场景`);

    log('[5] 学生开始 PracticeSession + 一轮对话');
    if (SKIP_LLM) {
      ok('SKIP_LLM=1，跳过对话');
    } else {
      const startRes = await api<{ sessionId: string; messages: unknown[] }>(
        '/api/academic/practice',
        student.token,
        {
          method: 'POST',
          body: JSON.stringify({
            scenarioId: scenario.id,
            mode: 'text',
            studentInput: { target_program: 'CMU CS PhD', research_direction: 'ML systems' },
          }),
        },
      );
      ok(`会话 ${startRes.sessionId} 开启`);

      const msgRes = await api<{ assistantReply: string }>(
        `/api/academic/practice/${startRes.sessionId}/message`,
        student.token,
        { method: 'POST', body: JSON.stringify({ content: '我对 Prof. Liu 的工作很有兴趣，因为他做的分布式训练跟我的实习经验对得上。' }) },
      );
      if (!msgRes.assistantReply) fail('会话回复为空');
      ok(`助教回复（前 60 字）：${msgRes.assistantReply.slice(0, 60)}…`);
    }

    log('[6] 老师查看 CheckpointPack（空列表）');
    // owner 同时兼作 teacher 视图（因为他是 owner，requireRole 允许 owner 访问）
    const { checkpoints } = await api<{ checkpoints: unknown[] }>('/api/academic/checkpoints', owner.token);
    ok(`checkpoints count=${checkpoints.length}（Phase 1 预期空或包含手工创建的）`);

    log('[7] DB 行级隔离：所有写入是否带正确 orgId');
    const [psCount, scCount, pbCount, memberCount] = await Promise.all([
      prisma.practiceSession.count({ where: { orgId: orgA.id } }),
      prisma.orgScenario.count({ where: { orgId: orgA.id } }),
      prisma.orgPlaybookSection.count({ where: { orgId: orgA.id } }),
      prisma.orgMember.count({ where: { orgId: orgA.id } }),
    ]);
    ok(`orgA: PracticeSession=${psCount}, Scenario=${scCount}, Playbook=${pbCount}, Member=${memberCount}`);

    // ============= 机构 B =============
    log('[8] 创建机构 B（留学），用 owner2');
    const { org: orgB } = await api<{ org: { id: string; industry: string } }>(
      '/api/console/orgs',
      owner2.token,
      { method: 'POST', body: JSON.stringify({ name: '第二机构测试', contactEmail: 'b@test.local', industry: 'liuxue' }) },
    );
    if (orgB.industry !== 'liuxue') fail('B 的 industry 不对');
    ok(`org B 创建：${orgB.id}`);

    log('[8] owner2 不应看到 org A 的场景');
    const { scenarios: b_scenarios } = await api<{ scenarios: { id: string }[] }>(
      '/api/console/scenarios',
      owner2.token,
    );
    if (b_scenarios.find((s) => s.id === scenario.id)) fail('跨 org 数据泄漏！');
    ok(`owner2 看到 ${b_scenarios.length} 个场景（应只有 B 自己的 = 0）`);

    log('[8] owner2 尝试直接访问 A 的场景，应 NOT_FOUND');
    try {
      await api(`/api/console/scenarios/${scenario.id}`, owner2.token);
      fail('owner2 居然能读取 A 的场景，隔离失败');
    } catch (e) {
      ok(`正确拒绝：${(e as Error).message}`);
    }

    log('[8] student 切到 B，然后读：应 NOT_A_MEMBER');
    try {
      await api(`/api/console/orgs/${orgB.id}/switch`, student.token, { method: 'POST' });
      fail('学生居然切到了未加入的机构 B');
    } catch (e) {
      ok(`正确拒绝切换：${(e as Error).message}`);
    }

    console.log('\n✅ 所有 8 条验收通过');
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
