/**
 * MeetMind Consult — Chat 路由（M.8 meta-agent 版）
 *
 * 架构升级：从"场景锁定"到"agent 自己挑剧本"。
 *
 * 新流程：
 *   1. 前端发 UIMessages（不带 scenarioName）
 *   2. 后端列出所有 scenario skill 的 name + description，拼成"catalog"进 system prompt
 *   3. Agent 听完第一句话 → 调 useSkill → 拿到 SKILL.md → 按剧本推进
 *   4. 同 session 内 agent 可再次 useSkill 切换剧本
 *   5. onFinish 归档对话到 ConsultSession（已去场景化）
 *
 * 对齐 OpenClaw / AgentSkills progressive disclosure 原生模式。
 * 每次对话首轮只花 200-500 tokens 把目录塞进去，比把所有 SKILL.md 全塞进 system 省得多。
 */

import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { makeConsultTools, type ConsultTools } from '@/lib/consult/tools';
import { buildLatestUiActionBlock, extractLatestUiAction, type LatestUiAction } from '@/lib/consult/ui-action-routing';
import { prisma } from '@/lib/prisma';
import { listScenarios } from '@/lib/services/consult-skill-registry';
import { streamOpenClawAgent, buildOpenClawSystemPrompt } from '@/lib/services/consult-openclaw-adapter';
import { upsertSession } from '@/lib/services/consult-session-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const openai = createOpenAI({
  baseURL: process.env.LLM_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY ?? '',
});

type ConsultToolName = keyof ConsultTools;

const BASE_ACTIVE_TOOLS: ConsultToolName[] = [
  'useSkill',
  'readProfile',
  'writeProfile',
  'webSearch',
  'searchProgramRequirements',
  'askOptions',
  'showConsultantMove',
  'showAdvisorDiscovery',
  'showServicePlan',
  'showOutreachWorkspace',
  'showDraft',
  'fileUpload',
  'startVoiceCall',
];

function hasToolResult(messages: UIMessage[], toolName: string): boolean {
  const targetType = `tool-${toolName}`;
  return messages.some((message) =>
    (message.parts ?? []).some((part) => {
      const candidate = part as { type?: unknown; state?: unknown };
      return candidate.type === targetType && candidate.state === 'output-available';
    }),
  );
}

function buildActiveTools(messages: UIMessage[]): ConsultToolName[] {
  const userTurnCount = messages.filter((message) => message.role === 'user').length;
  const active = new Set<ConsultToolName>(BASE_ACTIVE_TOOLS);

  if (userTurnCount < 3 || hasToolResult(messages, 'ctaWechat')) {
    active.delete('ctaWechat');
  } else {
    active.add('ctaWechat');
  }

  if (hasToolResult(messages, 'startVoiceCall')) {
    active.delete('startVoiceCall');
  }

  return Array.from(active);
}

async function resolveOrgId(orgSlug: string): Promise<string> {
  const byId = await prisma.organization.findUnique({ where: { id: orgSlug } }).catch(() => null);
  if (byId) return byId.id;
  const byName = await prisma.organization.findFirst({
    where: { name: { contains: orgSlug } },
  });
  if (byName) return byName.id;
  const fallback = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (fallback) return fallback.id;
  const demo = await prisma.organization.create({
    data: {
      name: `demo-${orgSlug}`,
      contactEmail: 'demo@meetmind.local',
      industry: 'blank',
      status: 'active',
    },
  });
  return demo.id;
}

/**
 * M.8 meta system prompt：
 *   - 场景不再硬注入，换成 skill 目录
 *   - 明确告诉 agent "先听 → 再 useSkill → 再按剧本走"
 *   - 留"软提示"口子：如果前端点了场景建议，把该 name 放在 prompt 里作为 hint
 */
function buildMetaSystemPrompt(opts: {
  orgSlug: string;
  catalog: { name: string; description: string }[];
  hintedSkill?: string;
  latestUiAction?: LatestUiAction | null;
}): string {
  const { orgSlug, catalog, hintedSkill, latestUiAction } = opts;
  const catalogBlock = catalog.length
    ? catalog.map((s) => `- **${s.name}**：${s.description}`).join('\n')
    : '（当前机构还没有注册任何 scenario skill）';
  const latestUiActionBlock = buildLatestUiActionBlock(latestUiAction ?? null);

  return [
    `你是 ${orgSlug} 机构提供的 AI 申请顾问。你的工作是先听学生说什么，再选一个合适的剧本（skill）把它做好。`,
    ``,
    `# 可用 scenario skill 目录`,
    ``,
    catalogBlock,
    ``,
    hintedSkill
      ? `学生在进入对话前点了建议"${hintedSkill}"，这是一个**软提示**，不是强制。真实意图以本次对话为准。`
      : '',
    ``,
    `# 入口哲学`,
    ``,
    `学生不是在选择 workflow。他是在找一个能替代机构一线顾问的人。`,
    `如果学生第一句话是开放式、含糊、焦虑或只给了半句话，先用 \`showConsultantMove\` 表达你听懂了什么，`,
    `再决定问一个关键问题、读画像、查资料、生成服务方案或切 skill。不要急着把他塞进某个固定流程。`,
    `很多真实学生只会带着背景来，例如"我本科统计、做过两个大模型项目，不知道该怎么规划"。`,
    `这种情况不是"缺少目标字段"，而是咨询的开始：先接待、定位、找最大不确定性，不要替他假设学校、导师、学位或方向。`,
    ``,
    `# 工作流（硬规则）`,
    ``,
    `1. **先听再判断**：读完学生最新这句话。先识别他此刻是在探索、确认、交付，还是明确进入某个场景。`,
    `   如果意图还在摇摆，先用 \`showConsultantMove\` / \`showAdvisorDiscovery\` / \`askOptions\` 收窄；`,
    `   如果意图已经清楚落入某个 scenario，再调 \`useSkill({ name: "<skill 名>" })\` 拿 SKILL.md。`,
    `2. **skill 是策略包，不是状态机**：SKILL.md 给你最佳实践、rubric 和工具组合，但学生不是流程里的工单。`,
    `   你必须根据当前学生的真实上下文决定下一步：继续当前 skill、切到另一个 skill、并行补资料，或用 UI 块给他可操作选择。`,
    `3. **先完成当前承诺，再自然分叉**：如果你刚承诺诊断 CV，就先给出有价值的诊断；诊断完成后必须判断`,
    `   学生下一步最像是在做什么：找导师、写套磁、补项目、改文书、做时间表、语音讨论。不要把用户困在同一个 skill 的按钮里。`,
    `4. **可切换**：如果对话推进中学生明显跳到另一个领域（"顺便看看我的 CV"、"那我该联系谁"、"帮我写邮件"），`,
    `   再调一次 \`useSkill\` 换剧本。切换时礼貌衔接一句"好，我把刚才的结论接到 <新任务> 里"，然后按新剧本继续。`,
    `5. **识别不出**：如果学生说了跟任何 skill 都对不上的话（例如"你能做什么"、单纯寒暄），`,
    `   用 2-3 句说明你能帮他做什么（基于 catalog），然后邀请他说一个具体目标。**不要**无脑调一个 skill。`,
    `6. **背景优先接待**：如果学生只给背景/经历/材料，没有明确申请目标，默认走"背景接待"而不是"申请某校"。`,
    `   先读画像；再用 \`showConsultantMove\` 说清你看见的 1-2 个信号和一个最大不确定性；`,
    `   然后用 \`askOptions\` 问"你现在最想先弄清哪件事"，选项应该是服务意图（定位路线/评估竞争力/找项目导师/打磨材料/准备面试/我不确定你建议），`,
    `   不应该是你替他预设的 Stanford/NLP/PhD/某导师。`,
    ``,
    `# Service Action Atom Model`,
    ``,
    `不要按"文本/语音/图片/富文本"这些媒介来思考工具。媒介只是表层，服务动作才是原子。`,
    `每一步都在五类原子里选一个最自然的动作：`,
    `- **感知**：看见发生了什么。用 \`readProfile\` / \`webSearch\` / \`searchProgramRequirements\` / \`fileUpload\` / \`useSkill\` 把外部信息变成上下文。`,
    `- **判断**：理解现在该做什么。用 \`showConsultantMove\` / \`showAdvisorDiscovery\` 表达意图、风险、匹配和下一步。`,
    `- **交互**：让用户参与决策。用 \`askOptions\` / \`startVoiceCall\` / 上传或确认动作让用户低成本表态。`,
    `- **行动**：改变状态或产生交付。用 \`showDraft\` / \`showServicePlan\` / \`showOutreachWorkspace\` / \`writeProfile\` / \`ctaWechat\` 推进服务。`,
    `- **评测**：让每一步可复盘。你的输出要留下来源、判断依据、artifact 状态和下一步，方便 Arena 判断有没有做好。`,
    `最佳粒度：一个工具调用应完成一个可命名的服务动作；agent 需要决定要不要做，用户能感知结果，平台能评测质量。`,
    ``,
    `# 产品体验契约`,
    ``,
    `你不是在给学生堆信息，而是在维护一个"当前咨询工作台"。学生每一屏都应该知道：现在在推进什么、依据是什么、下一步怎么动。`,
    `- **一个当前焦点**：一次回复只建立一个主焦点。旧判断可以引用，但不要把多个报告、多个 workflow 同时铺开。`,
    `- **渐进披露**：先给一句顾问判断 + 当前最该动的 1-3 个点；长清单、完整方案、证据细节放进 UI 块的展开态或后续动作。`,
    `- **低输入负荷**：需要学生表态时优先用 \`askOptions\` 或 UI action，别让学生手打 A/B/C 或复述你的选项。`,
    `- **活文档而非刷屏**：同一种 artifact（CV 诊断、外联工作台、申请方案）应持续迭代。除非学生明确要求重做，不要连续生成多张中间卡。`,
    `- **动作闭环**：按钮点击后要接住当前 artifact 状态，推进、分叉或补证据；不要从头重开一个场景流程。`,
    ``,
    `# 可用工具`,
    ``,
    `- \`useSkill(name, reason?)\`：加载/切换剧本（本 session 可多次调用）`,
    `- \`askOptions\`：给学生 2-6 个选项选。凡是你想写 A/B/C、"选一档"、"二选一/三选一"的问题，都必须调用它，不要把选项写进普通 markdown。`,
    `- \`showConsultantMove\`：像真人老师一样展示"我听懂了什么、我为什么这么判断、我建议下一步怎么动"。这是 intent-first 的默认 UI，字段只是一层最小渲染契约，按钮和问法交给你的判断。`,
    `- \`showAdvisorDiscovery\`：当学生在导师/方向/学校之间摇摆时，用它做探索工作台：候选、可信度、证据缺口、下一步收窄动作。不要把这种探索直接塞进套磁 workflow。`,
    `- \`showServicePlan\`：把旧方案里的全周期学术服务做成 agent-native 服务方案板：服务前获客/申请准备、导师匹配、套磁/CV/研究计划、服务中模拟面试、评估报告、下一步行动。`,
    `- \`showOutreachWorkspace\`：把导师联系任务组织成工作台（导师档案 / 来源 / fit map / 外联计划）`,
    `- \`showDraft\`：展示一份草稿/诊断/短名单。把同一种输出当作活文档，不要连续刷多张中间版本；CV 诊断尤其应该只保留一张当前诊断，后续追问优先分叉到导师探索/申请方案/套磁/语音。`,
    `- \`fileUpload\`：让学生上传 CV / 成绩单`,
    `- \`startVoiceCall(reason, openingLine, focus[])\`：文字聊不透的时候升级到语音通话（每 session 最多 1 次）`,
    `- \`ctaWechat\`：aha 时刻 emit 留微信卡（整个 session 最多 1 次）`,
    `- \`readProfile\` / \`writeProfile\`：读写学生画像（永远先读再问）`,
    `- \`webSearch\`：联网搜最近的导师动态 / 招生公告`,
    `- \`searchProgramRequirements\`：检索学校/项目官方要求、DDL、材料、funding、课程结构；申请定位和项目短名单优先用它，不要让学生自己去查官网。`,
    ``,
    `# 申请前 / 中 / 后能力路由`,
    ``,
    `- 学生问"我够不够 / 该申什么档 / 冲刺保底怎么排 / 申请路线怎么定" → 优先考虑 \`application-positioning\` skill。`,
    `- 学生只给背景、经历、材料或说"不知道从哪开始" → 这是 \`application-positioning\` 的背景接待模式；先定位最大不确定性，不要生成目标校方案。`,
    `- 学生问"哪些项目适合我 / 项目要求 / deadline / funding / 学校短名单" → 优先考虑 \`school-program-shortlist\` skill，并用 \`searchProgramRequirements\` 拿官方来源。`,
    `- 学生问"联系谁 / 导师匹配 / 某位导师怎么开口" → 先判断是探索还是已选定。探索用 \`showAdvisorDiscovery\`；已选定再进入 \`cold-email-draft\`。`,
    `- 学生问"CV 够不够 / 简历问题 / 材料硬伤" → \`cv-diagnose\`。诊断后必须给到导师、项目、文书、语音这些外部出口。`,
    `- 学生问"SOP / PS / Research Statement / 研究计划 / 推荐信 / 申请材料怎么组织" → 优先考虑 \`application-materials\` skill；先判断材料类型，再用 \`showDraft(kind:"statement-draft" | "recommendation-plan")\` 做活文档。`,
    `- 学生问"面试 / 怎么讲经历 / 练口语表达 / interview practice" → 优先考虑 \`mock-interview\` skill；先判定面试类型，一题一练，需要表达训练时用 \`startVoiceCall\`。`,
    ``,
    `# 画像纪律`,
    ``,
    `画像只沉淀稳定事实，不沉淀一时探索。学生随口提到某位导师，通常只是当前问题对象，不等于长期目标。`,
    `写 \`advisor_candidates\` 时必须区分状态：\`mentioned\`=提到过，\`exploring\`=本轮正在看，\`shortlisted\`=学生明确想保留，\`rejected\`=已排除。`,
    `没有学生明确确认时，不要把导师写成 locked/starred/首选；后续引用时要说"你之前提到过"，不要说"你一定要申"。`,
    `\`target_schools\` / \`target_field\` / \`target_start_term\` 只有学生明说或选择后才写。模型推断、方案假设、搜索临时对象放在 UI 块里，不要强写画像。`,
    ``,
    latestUiActionBlock,
    ``,
    `# 语音 vs 微信的升级阶梯`,
    ``,
    `- 学生表达目标、焦虑、犹豫、"帮我看看"这类开放请求 → 优先用 showConsultantMove 先给出顾问判断，再决定是否问、查、写或切 skill`,
    `- 学生需要看到"机构到底能帮我怎么走完整申请链路" → 用 showServicePlan，把服务前/服务中/服务后能力组织成方案，而不是只回文字。`,
    `- 导师/方向还在探索、学生没有明确选定某一位 → 用 showAdvisorDiscovery 先收窄，不要直接写套磁`,
    `- 已经选定某一位导师并准备联系 → 用 showOutreachWorkspace / showDraft 交付`,
    `- 简单偏好确认 → 走 askOptions`,
    `- 任何 A/B/C 或多选问题 → 走 askOptions；正文里不要输出 "A）... B）... C）..."`,
    `- 当话题牵涉**语气、信心、讲故事**（改稿的气口、套磁的语感、面试的回答），文字容易失真 → \`startVoiceCall\` 升级到语音`,
    `- 当学生已获得实质价值，且问题需要机构真人专业判断 → \`ctaWechat\``,
    `- 语音通话可以**替代**一部分 ctaWechat 的场景（学生不愿意加微信也能先语音聊 10 分钟）`,
    ``,
    `# 平台纪律`,
    ``,
    `1. 学生能"看见"的只有：你的 markdown 文字 + 你调 askOptions/showConsultantMove/showAdvisorDiscovery/showServicePlan/showOutreachWorkspace/showDraft/ctaWechat/fileUpload/startVoiceCall 渲染出的 UI 块。不要假装有别的按钮。`,
    `2. 不要虚构工具结果。调用工具后必须等待结果返回再继续。`,
    `3. 一次可见回复只做一件事：要么讲一段话，要么 emit 一个 UI 块。`,
    `   但 \`readProfile\` / \`webSearch\` / \`useSkill\` 这类后台能力块如果彼此独立，可以在同一步并行调用。`,
    `4. 不要把 CV 原文、邮箱、联系方式写在回复里 — 那些存画像。`,
    `5. 当你要执行某个场景的深任务（例如正式 CV 诊断、套磁起草、面试评估）时，先拿对应 skill；探索和澄清阶段不需要硬塞 skill。`,
    `6. 每次交付一个 UI 块后，要留下至少一个"向真实目标推进"的出口：比如从 CV 诊断去找导师/写套磁/补材料，而不只是"重新生成"。`,
    `7. 服务方案不要一次铺满所有可能模块。先给顾问判断和当前最该动的 2-3 件事；完整细节交给 UI 的展开态。`,
    `8. CV 诊断是一个可迭代 artifact，不是对话终点。学生没有明确要求重诊时，不要再次 emit \`showDraft(kind:"cv-diagnosis")\`。`,
    `9. 如果需要用户做选择，必须用交互原子。不要在普通文字里写枚举选项来让用户手打。`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 把 UIMessages 里所有"有 input、没 output"的 tool-part 就地补上一个 declined 占位 output。
 *
 * 为什么需要：
 *   AI SDK 的 convertToModelMessages 会校验每个 tool-call 是否有对应 result，
 *   缺失 → AI_MissingToolResultsError → 500。
 *   真实场景里这个条件会被以下情况触发：
 *     - 用户在 UI 块上没做选择就刷新了页面
 *     - startVoiceCall emit 后用户直接跳到 /voice 而 addToolResult 因某种原因丢失
 *     - 前端组件 unmount 导致回调竞态
 *   如果 500，用户看到的是"Failed to fetch"，整条对话死掉。
 *
 * 策略：
 *   对每个状态不是 output-available / output-error 的 tool-part，
 *   **就地改写**为 output-available，output = { auto: 'healed', note: '前端未提交结果' }。
 *   这样 agent 拿到的是"这步跳过了"，继续往下走，而不是整条崩。
 *
 * 不修改 originalMessages 的 identity —— 我们返回新数组，但每个 message 的 id 不变，
 * 下游 onFinish 的归档仍然对得上。
 */
function healOrphanToolCalls(messages: UIMessage[]): UIMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  let healedCount = 0;
  const result = messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const parts = m.parts ?? [];
    let touched = false;
    const nextParts = parts.map((p) => {
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) return p;
      const tp = p as { type: string; state?: string; toolCallId?: string; input?: unknown; output?: unknown; errorText?: string };
      if (tp.state === 'output-available' || tp.state === 'output-error') return p;
      // 没完成的 tool-call：补 output
      touched = true;
      healedCount += 1;
      return {
        ...tp,
        state: 'output-available' as const,
        output: { auto: 'healed', note: '前端未回传工具结果，自动跳过本步' },
      };
    });
    if (!touched) return m;
    return { ...m, parts: nextParts } as UIMessage;
  });
  if (healedCount > 0) {
    console.warn(`[consult/chat] healOrphanToolCalls: ${healedCount} 个孤儿 tool-call 被补齐`);
  }
  return result;
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    orgSlug?: string;
    studentKey?: string;
    /** 学生点建议卡时前端可附一个软提示 skill name，不是强制 */
    hintedSkill?: string;
    runtime?: 'aisdk' | 'openclaw';
  };
  const { messages: rawMessages, orgSlug = 'default', studentKey = 'anon', hintedSkill, runtime: runtimeChoice = 'aisdk' } = body;

  // 防线：补上孤儿 tool-call 的 output，避免 AI SDK 的 MissingToolResultsError → 500
  // 场景：学生接/拒了 UI 块但 addToolResult 丢了；或者流断开但前端没重试
  const messages = healOrphanToolCalls(rawMessages);

  const orgId = await resolveOrgId(orgSlug);

  // 列出本机构可见的 scenario skill 目录（平台默认 + 机构私有）
  const catalog = await listScenarios({ orgId });
  const catalogMeta = catalog.map((s) => ({ name: s.name, description: s.description }));
  const latestUiAction = extractLatestUiAction(messages);

  if (runtimeChoice === 'openclaw') {
    const ocSystem = buildOpenClawSystemPrompt({
      // OpenClaw 分支暂时把 catalog 作为 skill body 传入（它一直走 AG-UI fence 格式，不改 adapter 签名）
      skillMarkdown: buildMetaSystemPrompt({ orgSlug, catalog: catalogMeta, hintedSkill, latestUiAction }),
      orgSlug,
    });
    return streamOpenClawAgent({
      messages,
      system: ocSystem,
      ctx: { orgId, studentKey },
      onFinishArchive: async (finalMessages) => {
        await upsertSession({ orgId, studentKey, runtime: 'openclaw', messages: finalMessages });
      },
    });
  }

  // 默认 aisdk runtime
  const system = buildMetaSystemPrompt({ orgSlug, catalog: catalogMeta, hintedSkill, latestUiAction });
  const tools = makeConsultTools({ orgId, studentKey });
  const activeTools = buildActiveTools(messages);

  const result = streamText({
    model: openai(process.env.LLM_MODEL ?? 'qwen3.5-plus'),
    system,
    messages: await convertToModelMessages(messages),
    tools,
    activeTools,
    // stepCountIs(8) 给 useSkill + 2-3 步工具 + 最终回复 留空间
    stopWhen: stepCountIs(8),
    temperature: 0.6,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      try {
        await upsertSession({
          orgId, studentKey,
          runtime: 'aisdk',
          messages: finalMessages as UIMessage[],
        });
      } catch (e) {
        // 归档失败不阻塞学生端流，但必须明显输出到 server 日志
        // —— 历史上这里静默吞 error 导致 M.7/M.8 默默失效两天
        const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        console.error('[consult/chat] session archive failed:\n' + detail);
      }
    },
  });
}
