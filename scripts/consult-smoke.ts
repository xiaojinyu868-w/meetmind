/**
 * Consult 产品线回归冒烟（黑盒）
 *
 * 用法：
 *   BASE_URL=http://localhost:3002 npx tsx scripts/consult-smoke.ts
 *   或直接 npm run smoke:consult
 *
 * 策略：
 *   每个 case 独立打 /api/consult/chat，解析 SSE text stream，提取关键事件：
 *     - 调用了哪些 tool（toolName）
 *     - 产生了什么 text-delta 片段
 *     - 有没有 reasoning / error / finishReason
 *   然后断言期望的 tool 调用、禁用的 tool、内容关键词等。
 *
 * 设计纪律（不是单元测试——是运营级冒烟）：
 *   1. 每个 case 跑独立 studentKey，避免 session 串扰
 *   2. 真实调 LLM（Qwen），允许 ±10% flakiness；过不了 3 次重试才算失败
 *   3. 只对**协议级硬错**（500、缺 tool output 等）判死；内容匹配用弱断言
 *   4. 整个脚本退出码驱动：全绿 exit 0，有红 exit 1，CI 能接
 *
 * 新增 case：往 CASES 数组里塞。
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';
const CHAT_URL = `${BASE_URL}/api/consult/chat`;
const LEAD_URL = `${BASE_URL}/api/consult/lead`;
const VOICE_CTX_URL = `${BASE_URL}/api/consult/voice/context`;

const ORG = 'demo';
const MAX_RETRIES = 2;
const CASE_TIMEOUT_MS = 90_000;

// ─────────── 类型 ───────────

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<Record<string, unknown>>;
}

interface CaseResult {
  caseId: string;
  ok: boolean;
  durationMs: number;
  reason?: string;
  summary: {
    httpStatus: number;
    toolCalls: Array<{ name: string; input?: unknown; hasOutput: boolean }>;
    textSample: string;
    finishReason: string | null;
    errors: string[];
  };
}

interface Case {
  id: string;
  description: string;
  // 会话历史（学生 + 已归档的 assistant 消息）
  messages: UIMessage[];
  body?: Record<string, unknown>;
  // 断言器：给出 summary，返回 ok/reason
  assert: (s: CaseResult['summary']) => { ok: boolean; reason?: string };
}

// ─────────── SSE 解析 ───────────

async function runChat(c: Case): Promise<CaseResult> {
  const studentKey = `smoke_${c.id}_${Date.now().toString(36)}`;
  const started = Date.now();

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: c.messages,
      orgSlug: ORG,
      studentKey,
      ...(c.body ?? {}),
    }),
    signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
  });

  const summary: CaseResult['summary'] = {
    httpStatus: res.status,
    toolCalls: [],
    textSample: '',
    finishReason: null,
    errors: [],
  };

  if (!res.ok || !res.body) {
    summary.errors.push(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300));
    return { caseId: c.id, ok: false, durationMs: Date.now() - started, reason: 'HTTP_FAIL', summary };
  }

  // 解析 SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const toolInputByCallId = new Map<string, { name: string; input?: unknown }>();
  const completedCallIds = new Set<string>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.startsWith('data:')) continue;
      const data = raw.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as Record<string, unknown>;
        const t = evt.type as string | undefined;
        if (t === 'tool-input-available') {
          const name = String(evt.toolName ?? '');
          const id = String(evt.toolCallId ?? '');
          toolInputByCallId.set(id, { name, input: evt.input });
        } else if (t === 'tool-output-available') {
          const id = String(evt.toolCallId ?? '');
          completedCallIds.add(id);
        } else if (t === 'text-delta') {
          summary.textSample += String(evt.delta ?? '');
          if (summary.textSample.length > 3000) summary.textSample = summary.textSample.slice(0, 3000);
        } else if (t === 'finish') {
          summary.finishReason = String(evt.finishReason ?? '');
        } else if (t === 'error') {
          summary.errors.push(String(evt.errorText ?? '').slice(0, 300));
        }
      } catch {
        // 跳过畸形 chunk
      }
    }
  }

  summary.toolCalls = Array.from(toolInputByCallId.entries()).map(([id, v]) => ({
    name: v.name,
    input: v.input,
    hasOutput: completedCallIds.has(id),
  }));

  const { ok, reason } = c.assert(summary);
  return { caseId: c.id, ok, durationMs: Date.now() - started, reason, summary };
}

// ─────────── 辅助构造 ───────────

const user = (text: string): UIMessage => ({
  id: `u_${Math.random().toString(36).slice(2, 10)}`,
  role: 'user',
  parts: [{ type: 'text', text }],
});

const assistantWithToolCallOnly = (toolName: string, input: unknown, toolCallId = `t_${Math.random().toString(36).slice(2, 10)}`): UIMessage => ({
  id: `a_${Math.random().toString(36).slice(2, 10)}`,
  role: 'assistant',
  parts: [
    { type: `tool-${toolName}`, toolCallId, state: 'input-available', input },
  ],
});

const assistantWithToolDone = (toolName: string, input: unknown, output: unknown): UIMessage => ({
  id: `a_${Math.random().toString(36).slice(2, 10)}`,
  role: 'assistant',
  parts: [
    { type: `tool-${toolName}`, toolCallId: `t_${Math.random().toString(36).slice(2, 10)}`, state: 'output-available', input, output },
  ],
});

const hasTool = (summary: CaseResult['summary'], name: string) =>
  summary.toolCalls.some((t) => t.name === name);

const noTool = (summary: CaseResult['summary'], name: string) =>
  !summary.toolCalls.some((t) => t.name === name);

// ─────────── Cases ───────────

const CASES: Case[] = [
  {
    id: 'C01_cold_email',
    description: '学生明确要写套磁 → agent 必须 useSkill(cold-email-draft)',
    messages: [user('帮我给 CMU 的 Prof Liu 写一封套磁')],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      if (!hasTool(s, 'useSkill')) return { ok: false, reason: '没调 useSkill' };
      const skillCall = s.toolCalls.find((t) => t.name === 'useSkill');
      const name = (skillCall?.input as { name?: string })?.name;
      if (name !== 'cold-email-draft') return { ok: false, reason: `useSkill 选了 ${name}，期望 cold-email-draft` };
      return { ok: true };
    },
  },
  {
    id: 'C01b_flagship_percy',
    description: '旗舰 Percy 场景 → 应生成外联工作台而不是只回富文本',
    messages: [user('我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang')],
    body: { hintedSkill: 'cold-email-draft' },
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'cold-email-draft') return { ok: false, reason: `期望 cold-email-draft，得到 ${skill}` };
      if (!hasTool(s, 'readProfile')) return { ok: false, reason: '没有读取学生画像' };
      const searchInput = s.toolCalls.find((t) => t.name === 'webSearch')?.input as { query?: string } | undefined;
      if (!searchInput?.query) return { ok: false, reason: '没有联网查导师' };
      if (!/Percy\s+Liang/i.test(searchInput.query) || !/Stanford/i.test(searchInput.query)) {
        return { ok: false, reason: `webSearch query 不够具体：${searchInput.query}` };
      }
      if (!hasTool(s, 'showOutreachWorkspace')) return { ok: false, reason: '没有生成 showOutreachWorkspace 工作台' };
      if (hasTool(s, 'ctaWechat')) return { ok: false, reason: '旗舰首轮不应直接 CTA' };
      return { ok: true };
    },
  },
  {
    id: 'C02_cv_diagnose',
    description: '学生要看 CV → agent 必须 useSkill(cv-diagnose)',
    messages: [user('帮我看看我的 CV 情况')],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'cv-diagnose') return { ok: false, reason: `期望 cv-diagnose 得到 ${skill}` };
      return { ok: true };
    },
  },
  {
    id: 'C02b_application_positioning',
    description: '学生问申请定位 → agent 应进入 application-positioning',
    messages: [user('我想申请 2027 秋季 Stanford NLP PhD，但不知道背景够不够，你先帮我判断申请档位')],
    body: { hintedSkill: 'application-positioning' },
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'application-positioning') return { ok: false, reason: `期望 application-positioning，得到 ${skill}` };
      if (!hasTool(s, 'showConsultantMove') && !hasTool(s, 'showServicePlan') && !hasTool(s, 'askOptions')) {
        return { ok: false, reason: '没有产生定位类可见动作' };
      }
      return { ok: true };
    },
  },
  {
    id: 'C02c_program_shortlist',
    description: '学生问项目短名单/要求 → agent 应使用项目要求检索原子',
    messages: [user('帮我查 Stanford 和 NUS 的 NLP PhD 2027 申请要求和 DDL，然后做一个冲刺/主申短名单')],
    body: { hintedSkill: 'school-program-shortlist' },
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'school-program-shortlist') return { ok: false, reason: `期望 school-program-shortlist，得到 ${skill}` };
      if (!hasTool(s, 'searchProgramRequirements')) return { ok: false, reason: '没有调用 searchProgramRequirements' };
      return { ok: true };
    },
  },
  {
    id: 'C02d_mock_interview',
    description: '学生要模拟面试 → agent 应进入 mock-interview',
    messages: [user('我想练一次 Stanford NLP PhD 面试，尤其是怎么讲我的研究经历')],
    body: { hintedSkill: 'mock-interview' },
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'mock-interview') return { ok: false, reason: `期望 mock-interview，得到 ${skill}` };
      if (!hasTool(s, 'showConsultantMove') && !hasTool(s, 'askOptions') && !hasTool(s, 'startVoiceCall')) {
        return { ok: false, reason: '没有产生面试教练类动作' };
      }
      return { ok: true };
    },
  },
  {
    id: 'C02e_application_materials',
    description: '学生要写文书/研究陈述 → agent 应进入 application-materials',
    messages: [user('我想把 NLP PhD 的 Research Statement 和 SOP 主线搭出来，顺便规划推荐信')],
    body: { hintedSkill: 'application-materials' },
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skill = (s.toolCalls.find((t) => t.name === 'useSkill')?.input as { name?: string })?.name;
      if (skill !== 'application-materials') return { ok: false, reason: `期望 application-materials，得到 ${skill}` };
      if (!hasTool(s, 'showConsultantMove') && !hasTool(s, 'askOptions') && !hasTool(s, 'showDraft')) {
        return { ok: false, reason: '没有产生材料中台类动作' };
      }
      return { ok: true };
    },
  },
  {
    id: 'C03_ambiguous_hello',
    description: '学生寒暄 → 不该直接调 skill',
    messages: [user('你能做什么')],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      if (!noTool(s, 'useSkill')) return { ok: false, reason: '歧义输入下不应调 useSkill' };
      if (s.textSample.trim().length < 20) return { ok: false, reason: '自然回复过短' };
      return { ok: true };
    },
  },
  {
    id: 'C04_no_phantom_cta',
    description: '第一轮不该 emit ctaWechat',
    messages: [user('帮我写一封套磁')],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      if (hasTool(s, 'ctaWechat')) return { ok: false, reason: '首轮就 emit 了 ctaWechat（违反"前 3 轮禁用"）' };
      return { ok: true };
    },
  },
  {
    id: 'C05_markdown_output',
    description: '复杂提问应返回 markdown（含标题或 bullet）',
    messages: [user('套磁开头应该怎么写？给我 3 个要点')],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const t = s.textSample;
      // 宽松：有任意一种 markdown 结构就 pass（**/##/1. /- ）
      const hasMd = /\*\*|##|^- |^\d\.\s/m.test(t);
      if (!hasMd) return { ok: false, reason: '未见 markdown 结构（**、##、bullet 列表）' };
      return { ok: true };
    },
  },
  {
    id: 'C06_voice_upgrade',
    description: '画像有内容 + 学生要求语音 → 应 emit startVoiceCall',
    messages: [
      user('帮我给 Stanford 的 Percy Liang 写一封套磁'),
      assistantWithToolDone('useSkill', { name: 'cold-email-draft' }, { ok: true, name: 'cold-email-draft', skill: '(已加载)' }),
      assistantWithToolDone(
        'writeProfile',
        { patch: { target_field: 'NLP', target_schools: ['Stanford'], advisor_candidates: [{ name: 'Percy Liang' }] } },
        { writtenKeys: ['target_field', 'target_schools', 'advisor_candidates'] },
      ),
      assistantWithToolDone(
        'showDraft',
        { kind: 'cold-email-draft', title: 'Draft v1', body: 'Dear Prof Liang, ...' },
        { actionId: 'soften' },
      ),
      user('我还是觉得开头的语气拿不准，能语音跟我说说该怎么讲自己的科研故事吗？'),
    ],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      if (!hasTool(s, 'startVoiceCall')) return { ok: false, reason: '期望 emit startVoiceCall 但没有' };
      const voiceInput = s.toolCalls.find((t) => t.name === 'startVoiceCall')?.input as {
        openingLine?: string; focus?: string[];
      } | undefined;
      if (!voiceInput?.openingLine) return { ok: false, reason: 'startVoiceCall 没有 openingLine' };
      if (!voiceInput.focus || voiceInput.focus.length === 0) return { ok: false, reason: 'startVoiceCall 没有 focus 清单' };
      return { ok: true };
    },
  },
  {
    id: 'C07_orphan_tool_heal',
    description: '前端提交的 messages 里有没完成的 tool-call → 后端不该 500（由 healOrphanToolCalls 兜住）',
    messages: [
      user('帮我写一封套磁'),
      assistantWithToolCallOnly('askOptions', {
        prompt: '你想联系哪位教授？',
        choices: [{ id: 'a', label: 'Percy Liang' }, { id: 'b', label: '其他' }],
      }),
      user('算了换个话题，我想看我的 CV'),
    ],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}（孤儿 tool-call 本应被 heal）` };
      if (s.errors.some((e) => /MissingToolResults/i.test(e))) return { ok: false, reason: 'MissingToolResultsError 未被拦住' };
      return { ok: true };
    },
  },
  {
    id: 'C08_switch_skill_midway',
    description: '对话中途切换主题 → agent 应再调一次 useSkill 换剧本',
    messages: [
      user('帮我写一封套磁'),
      assistantWithToolDone('useSkill', { name: 'cold-email-draft' }, { ok: true, name: 'cold-email-draft', skill: '(已加载)' }),
      user('算了先不写了，帮我看看我的 CV 吧'),
    ],
    assert: (s) => {
      if (s.httpStatus !== 200) return { ok: false, reason: `HTTP ${s.httpStatus}` };
      const skills = s.toolCalls.filter((t) => t.name === 'useSkill').map((t) => (t.input as { name?: string })?.name);
      if (!skills.includes('cv-diagnose')) return { ok: false, reason: `期望切到 cv-diagnose，实际 useSkill 记录：${JSON.stringify(skills)}` };
      return { ok: true };
    },
  },
];

// ─────────── 辅助端点冒烟（不在 LLM 路径上）───────────

async function smokeLeadCreate(): Promise<CaseResult> {
  const started = Date.now();
  const summary: CaseResult['summary'] = {
    httpStatus: 0, toolCalls: [], textSample: '', finishReason: null, errors: [],
  };
  const studentKey = `smoke_lead_${Date.now().toString(36)}`;
  try {
    const res = await fetch(LEAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgSlug: ORG,
        studentKey,
        reason: '冒烟测试',
        headline: '冒烟的 lead',
        wechat: 'smoke_wechat_test',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    summary.httpStatus = res.status;
    const json = await res.json() as { success?: boolean; data?: unknown; error?: string };
    if (!json.success) summary.errors.push(json.error ?? 'lead api error');
    return {
      caseId: 'C09_lead_create',
      ok: res.ok && Boolean(json.success),
      durationMs: Date.now() - started,
      reason: json.success ? undefined : json.error,
      summary,
    };
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return { caseId: 'C09_lead_create', ok: false, durationMs: Date.now() - started, reason: summary.errors[0], summary };
  }
}

async function smokeVoiceContext(): Promise<CaseResult> {
  const started = Date.now();
  const summary: CaseResult['summary'] = {
    httpStatus: 0, toolCalls: [], textSample: '', finishReason: null, errors: [],
  };
  try {
    const res = await fetch(VOICE_CTX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgSlug: ORG,
        studentKey: `smoke_voice_${Date.now().toString(36)}`,
        openingLine: '喂，我是 AI 顾问',
        focus: ['测试'],
        voice: 'Ethan',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    summary.httpStatus = res.status;
    const json = await res.json() as { success?: boolean; data?: { instructions?: string }; error?: string };
    if (!json.success || !json.data?.instructions) summary.errors.push(json.error ?? '缺 instructions');
    summary.textSample = (json.data?.instructions ?? '').slice(0, 200);
    return {
      caseId: 'C10_voice_context',
      ok: res.ok && !!json.data?.instructions,
      durationMs: Date.now() - started,
      reason: json.success ? undefined : json.error,
      summary,
    };
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return { caseId: 'C10_voice_context', ok: false, durationMs: Date.now() - started, reason: summary.errors[0], summary };
  }
}

// ─────────── 执行器 ───────────

async function runWithRetry(c: Case): Promise<CaseResult> {
  let last: CaseResult | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      last = await runChat(c);
      if (last.ok) return last;
      // 只对 HTTP_FAIL 或 http 500 重试；内容不匹配一次定死
      if (last.summary.httpStatus !== 200 && attempt < MAX_RETRIES) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return last;
    } catch (e) {
      last = {
        caseId: c.id,
        ok: false,
        durationMs: 0,
        reason: e instanceof Error ? e.message : String(e),
        summary: { httpStatus: 0, toolCalls: [], textSample: '', finishReason: null, errors: [e instanceof Error ? e.message : String(e)] },
      };
      if (attempt < MAX_RETRIES) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
    }
  }
  return last!;
}

async function main() {
  console.log(`Consult Smoke @ ${BASE_URL}`);
  console.log(`${CASES.length + 2} cases · timeout ${CASE_TIMEOUT_MS / 1000}s · retries ${MAX_RETRIES}\n`);

  const results: CaseResult[] = [];

  for (const c of CASES) {
    process.stdout.write(`▸ ${c.id} ${c.description.slice(0, 60)}… `);
    const r = await runWithRetry(c);
    results.push(r);
    console.log(r.ok ? `✓ (${r.durationMs}ms)` : `✗ (${r.durationMs}ms) ${r.reason ?? ''}`);
  }

  process.stdout.write('▸ C09_lead_create 线索创建端点… ');
  const rLead = await smokeLeadCreate();
  results.push(rLead);
  console.log(rLead.ok ? `✓ (${rLead.durationMs}ms)` : `✗ (${rLead.durationMs}ms) ${rLead.reason ?? ''}`);

  process.stdout.write('▸ C10_voice_context 通话上下文端点… ');
  const rVoice = await smokeVoiceContext();
  results.push(rVoice);
  console.log(rVoice.ok ? `✓ (${rVoice.durationMs}ms)` : `✗ (${rVoice.durationMs}ms) ${rVoice.reason ?? ''}`);

  // 汇总
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n━━ 汇总：${passed} / ${results.length} 通过${failed ? `，${failed} 失败` : ''} ━━`);

  if (failed > 0) {
    console.log('\n失败详情：');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`\n  ${r.caseId}`);
      console.log(`    reason: ${r.reason}`);
      console.log(`    http: ${r.summary.httpStatus}, tools: ${r.summary.toolCalls.map((t) => t.name).join(', ') || '(无)'}`);
      if (r.summary.errors.length > 0) console.log(`    errors: ${r.summary.errors.join(' | ').slice(0, 300)}`);
      if (r.summary.textSample) console.log(`    text: ${r.summary.textSample.slice(0, 200).replace(/\s+/g, ' ')}…`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('smoke runner crashed:', e);
  process.exit(2);
});
