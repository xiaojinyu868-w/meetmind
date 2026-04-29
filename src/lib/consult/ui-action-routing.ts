import type { UIMessage } from 'ai';

export type LatestUiAction = {
  toolName: string;
  actionId?: string;
  label?: string;
  advisorName?: string;
  confidence?: string;
  nextMove?: string;
  intent?: string;
  artifactKind?: string;
  artifactTitle?: string;
  context?: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function actionRecord(input: Record<string, unknown> | null, actionId: string): Record<string, unknown> | null {
  const actions = input?.actions;
  if (!Array.isArray(actions)) return null;
  for (const item of actions) {
    const candidate = asRecord(item);
    if (candidate && stringField(candidate, 'id') === actionId) return candidate;
  }
  return null;
}

export function extractLatestUiAction(messages: UIMessage[]): LatestUiAction | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j] as { type?: unknown; state?: unknown; input?: unknown; output?: unknown };
      if (part.state !== 'output-available' || typeof part.type !== 'string') continue;
      if (
        part.type !== 'tool-showConsultantMove' &&
        part.type !== 'tool-showAdvisorDiscovery' &&
        part.type !== 'tool-showServicePlan' &&
        part.type !== 'tool-showOutreachWorkspace' &&
        part.type !== 'tool-showDraft'
      ) continue;
      const output = asRecord(part.output);
      if (!output) continue;
      const actionId = stringField(output, 'actionId');
      if (!actionId) continue;
      const input = asRecord(part.input);
      const action = actionRecord(input, actionId);
      const toolName = part.type.replace(/^tool-/, '');
      const event: LatestUiAction = {
        toolName,
        actionId,
      };
      const label = stringField(output, 'label') ?? stringField(action ?? {}, 'label');
      const advisorName = stringField(output, 'advisorName') ?? advisorNameFromInput(toolName, input);
      const confidence = stringField(output, 'confidence');
      const nextMove = stringField(output, 'nextMove');
      const intent = stringField(output, 'intent') ?? stringField(action ?? {}, 'intent') ?? stringField(action ?? {}, 'kind');
      const artifactKind = stringField(input ?? {}, 'kind');
      const artifactTitle = stringField(input ?? {}, 'title');
      const context = buildUiContext(toolName, input, output);
      if (label) event.label = label;
      if (advisorName) event.advisorName = advisorName;
      if (confidence) event.confidence = confidence;
      if (nextMove) event.nextMove = nextMove;
      if (intent) event.intent = intent;
      if (artifactKind) event.artifactKind = artifactKind;
      if (artifactTitle) event.artifactTitle = artifactTitle;
      if (context.length > 0) event.context = context;
      return event;
    }
  }
  return null;
}

export function buildLatestUiActionBlock(action: LatestUiAction | null): string {
  if (!action) return '';

  const target = action.advisorName ? `，对象是 ${action.advisorName}` : '';
  const label = action.label ? `（${action.label}）` : '';
  const nextMove = action.nextMove ? `\n- 上一个工作台建议的下一步：${action.nextMove}` : '';
  const intent = action.intent ? `\n- 学生点击动作的意图：${action.intent}` : '';
  const artifact = action.artifactKind || action.artifactTitle
    ? `\n- 所在 artifact：${[action.artifactKind, action.artifactTitle].filter(Boolean).join(' · ')}`
    : '';
  const context = action.context && action.context.length > 0
    ? [``, `当前 UI 状态：`, ...action.context.map((line) => `- ${line}`)].join('\n')
    : '';
  const routeHints = buildRouteHints(action);

  return [
    `# 刚发生的 UI 动作（闭环事件）`,
    ``,
    `学生刚刚在 \`${action.toolName}\` 里点了 \`${action.actionId}\`${label}${target}。不要把这个当普通聊天文本处理。${artifact}${nextMove}${intent}`,
    context,
    ``,
    `闭环原则：`,
    `- 先接住当前 UI 状态，再决定下一步；不要像重新进入一个 workflow 那样从头问起。`,
    `- 如果当前 artifact 已经给过判断，下一步应该推进、更新或分叉，而不是复述同一张卡。`,
    `- 如果学生刚在 \`showConsultantMove\` 里点了动作，下一步通常应进入 \`askOptions\` / \`showServicePlan\` / \`showAdvisorDiscovery\` / \`showDraft\` / 检索工具；不要再输出一张同标题、同判断的 \`showConsultantMove\`。`,
    `- 按 action intent + 当前证据选择工具；证据不够就先查或只问一个关键问题。`,
    `- CV 诊断不是终点。除非学生明确要求重诊，不要再次输出 \`showDraft(kind:"cv-diagnosis")\`。`,
    ``,
    `默认路由建议（先看 intent 和当前 UI 状态，再看 actionId/label；不要只做关键词匹配）：`,
    ...routeHints,
    ``,
    `体验纪律：学生点完按钮后的下一步必须是一个明确推进：新的工具调用、一个 UI 块，或一句非常短的过渡。不要长时间只输出泛泛文字。`,
  ].join('\n');
}

function buildRouteHints(action: LatestUiAction): string[] {
  const text = `${action.intent ?? ''} ${action.actionId ?? ''} ${action.label ?? ''}`.toLowerCase();
  const hints: string[] = [];

  if (
    action.intent === 'search' ||
    /expand.*advisor|advisor.*list|advisor.*shortlist|导师.*短名单|扩展.*导师|找导师|筛导师/.test(text)
  ) {
    hints.push(
      `- 如果这是扩展导师短名单/找更多导师：先调 \`webSearch\`，按学校或实验室拆成更小查询；拿到结果后优先用 \`showAdvisorDiscovery\` 更新探索工作台。此时不要直接切到套磁草稿，除非学生已经选定某一位导师。`,
    );
  }

  if (action.intent === 'shortlist' || /shortlist|短名单|保留|重点考虑/.test(text)) {
    hints.push(
      `- 如果学生是在把候选加入/调整短名单：不要立刻写邮件。先用 \`showAdvisorDiscovery\` 更新候选状态和证据缺口；只有学生明确说要联系某一位时，再切到外联/套磁。`,
    );
  }

  if (/program|项目|school|学校|deadline|ddl|requirement|要求|funding|奖学金|12-week|12 周/.test(text)) {
    hints.push(
      `- 如果这是项目短名单/学校要求/DDL/funding：优先调 \`searchProgramRequirements\` 查官方来源；必要时 \`useSkill({name:"school-program-shortlist"})\`，再用 \`showDraft(kind:"program-shortlist")\` 或 \`showServicePlan\` 更新当前工作台。不要只用主观建议。`,
    );
  }

  if (/positioning|定位|够不够|档位|冲刺|主申|保底|路线/.test(text)) {
    hints.push(
      `- 如果这是申请定位/档位选择：优先 \`useSkill({name:"application-positioning"})\`，先判断目标、学位、时间线这三个变量，再分叉到项目短名单或导师探索。`,
    );
  }

  if (/sop|ps|statement|research statement|personal statement|推荐信|文书|材料|研究计划/.test(text)) {
    hints.push(
      `- 如果这是 SOP/PS/Research Statement/推荐信/申请材料：优先 \`useSkill({name:"application-materials"})\`，把当前定位、CV、项目和导师证据接成材料活文档；产出用 \`showDraft(kind:"statement-draft")\` 或 \`showDraft(kind:"recommendation-plan")\`。不要直接写泛文书。`,
    );
  }

  if (action.intent === 'draft' || /draft|opening|fit|tone|写|草稿|邮件|文书/.test(text)) {
    hints.push(
      `- 如果这是起草/改写：需要导师联系时先 \`useSkill({name:"cold-email-draft"})\`，否则调 \`showDraft\` 只改学生点的那一段；不要重新问一遍背景。`,
    );
  }

  if (action.intent === 'upload' || /upload|cv|材料|上传/.test(text)) {
    hints.push(`- 如果这是补材料：调 \`fileUpload\`，并在工具结果回来后只把上传文件这类确定事实写入画像。`);
  }

  if (action.intent === 'voice' || /voice|call|语音|面试|聊/.test(text)) {
    hints.push(`- 如果这是语音/面试/讲故事：优先 \`useSkill({name:"mock-interview"})\` 承接面试教练方法；如果用户已经明确要语音，调 \`startVoiceCall\`，focus 要来自刚才卡片里的真实卡点。`);
  }

  if (action.intent === 'handoff' || /handoff|wechat|微信|真人|顾问/.test(text)) {
    hints.push(`- 如果这是真人接力：只有学生已经拿到实质交付且满足 cta 规则时才调 \`ctaWechat\`。`);
  }

  if (action.intent === 'route' || /service-plan|方案|全周期|准备方案/.test(text)) {
    hints.push(`- 如果这是看完整服务路径：调 \`showServicePlan\`，只展示当前最关键的 3 个推进模块，其余放到细节里。`);
  }

  if (hints.length === 0) {
    hints.push(
      `- 如果动作含 \`search\` / \`paper\` / \`论文\`：调 \`webSearch\` 补强来源；如果含 \`plan\` / \`timeline\` / \`补强\`：调 \`showDraft(kind:"application-plan")\` 生成可执行计划；如果含 \`paste\` / \`project\`：请学生直接粘贴项目经历。`,
    );
  }

  return hints;
}

function buildUiContext(toolName: string, input: Record<string, unknown> | null, output: Record<string, unknown>): string[] {
  if (!input) return [];
  if (toolName === 'showDraft') return draftContext(input);
  if (toolName === 'showServicePlan') return servicePlanContext(input);
  if (toolName === 'showAdvisorDiscovery') return advisorDiscoveryContext(input);
  if (toolName === 'showOutreachWorkspace') return outreachWorkspaceContext(input, output);
  if (toolName === 'showConsultantMove') return consultantMoveContext(input);
  return [];
}

function draftContext(input: Record<string, unknown>): string[] {
  const kind = stringField(input, 'kind');
  const title = stringField(input, 'title');
  const body = stringField(input, 'body') ?? '';
  const lines = [
    title ? `当前文档标题：${title}` : '',
    kind ? `当前文档类型：${kind}` : '',
  ].filter(Boolean);

  if (kind === 'cv-diagnosis') {
    const score = body.match(/总分[：:]\s*([0-9](?:\.[0-9])?)\s*\/\s*5(?:\.0)?/)?.[1];
    if (score) lines.push(`CV 当前匹配度：${score}/5.0`);
    const highlight = firstItemFromSection(body, '3 个亮点');
    const risk = firstItemFromSection(body, '3 个硬伤');
    const next = weekOneFromPlan(body) ?? firstItemFromSection(body, '最短改进路径（接下来 4 周）');
    if (highlight) lines.push(`当前最大机会：${highlight}`);
    if (risk) lines.push(`当前最大风险：${risk}`);
    if (next) lines.push(`诊断建议的下一步：${next}`);
    return lines.slice(0, 6);
  }

  const preview = compact(body);
  if (preview) lines.push(`正文摘要：${preview}`);
  return lines.slice(0, 4);
}

function servicePlanContext(input: Record<string, unknown>): string[] {
  const phase = stringField(input, 'phase');
  const title = stringField(input, 'title');
  const objective = stringField(input, 'objective');
  const consultantRead = stringField(input, 'consultantRead');
  const lines = [
    title ? `方案标题：${title}` : '',
    phase ? `服务阶段：${phase}` : '',
    objective ? `本轮目标：${objective}` : '',
    consultantRead ? `顾问判断：${compact(consultantRead, 110)}` : '',
  ].filter(Boolean);
  const modules = input.modules;
  if (Array.isArray(modules)) {
    const visible = modules
      .map(asRecord)
      .filter(isRecord)
      .slice(0, 3)
      .map((mod) => [stringField(mod, 'label'), stringField(mod, 'status')].filter(Boolean).join('/'))
      .filter(Boolean)
      .join('、');
    if (visible) lines.push(`当前模块：${visible}`);
  }
  return lines.slice(0, 6);
}

function advisorDiscoveryContext(input: Record<string, unknown>): string[] {
  const title = stringField(input, 'title');
  const mode = stringField(input, 'mode');
  const read = stringField(input, 'read');
  const question = stringField(input, 'question');
  const lines = [
    title ? `探索标题：${title}` : '',
    mode ? `探索状态：${mode}` : '',
    read ? `顾问读法：${compact(read, 110)}` : '',
    question ? `待确认问题：${question}` : '',
  ].filter(Boolean);
  const candidates = input.candidates;
  if (Array.isArray(candidates)) {
    const visible = candidates
      .map(asRecord)
      .filter(isRecord)
      .slice(0, 3)
      .map((candidate) => {
        const name = stringField(candidate, 'name');
        const status = stringField(candidate, 'status');
        const fit = numberField(candidate, 'fit');
        if (!name) return '';
        return [name, status, typeof fit === 'number' ? `${Math.round(fit)}%` : ''].filter(Boolean).join('/');
      })
      .filter(Boolean)
      .join('、');
    if (visible) lines.push(`当前候选：${visible}`);
  }
  return lines.slice(0, 6);
}

function outreachWorkspaceContext(input: Record<string, unknown>, output: Record<string, unknown>): string[] {
  const advisor = asRecord(input.advisor);
  const judgment = asRecord(input.judgment);
  const plan = asRecord(input.outreachPlan);
  const lines = [
    stringField(input, 'title') ? `工作台标题：${stringField(input, 'title')}` : '',
    advisor ? `外联对象：${[stringField(advisor, 'name'), stringField(advisor, 'affiliation'), stringField(advisor, 'lab')].filter(Boolean).join(' · ')}` : '',
    stringField(judgment ?? {}, 'verdict') ? `当前判断：${stringField(judgment ?? {}, 'verdict')}` : '',
    stringField(output, 'nextMove') ? `建议动作：${stringField(output, 'nextMove')}` : '',
    stringField(plan ?? {}, 'risk') ? `当前风险：${stringField(plan ?? {}, 'risk')}` : '',
  ].filter(Boolean);
  return lines.slice(0, 6);
}

function consultantMoveContext(input: Record<string, unknown>): string[] {
  return [
    stringField(input, 'title') ? `顾问判断：${stringField(input, 'title')}` : '',
    stringField(input, 'read') ? `真实问题：${compact(stringField(input, 'read') ?? '', 110)}` : '',
    stringField(input, 'move') ? `原建议动作：${compact(stringField(input, 'move') ?? '', 110)}` : '',
    stringField(input, 'question') ? `原关键问题：${stringField(input, 'question')}` : '',
  ].filter(Boolean);
}

function advisorNameFromInput(toolName: string, input: Record<string, unknown> | null): string | undefined {
  if (toolName !== 'showOutreachWorkspace' || !input) return undefined;
  const advisor = asRecord(input.advisor);
  return advisor ? stringField(advisor, 'name') : undefined;
}

function firstItemFromSection(body: string, title: string): string | null {
  const section = extractSection(body, title);
  const item = section.match(/^\s*(?:\d+\.\s*|-\s*)(.+)$/m)?.[1];
  return item ? compact(item, 100) : null;
}

function weekOneFromPlan(body: string): string | null {
  const section = extractSection(body, '最短改进路径（接下来 4 周）');
  const item = section.match(/第\s*1\s*周[：:]\s*(.+)$/m)?.[1];
  return item ? compact(item, 100) : null;
}

function extractSection(body: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`##\\s*${escaped}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`))?.[1] ?? '';
}

function compact(text: string, max = 120): string {
  const clean = text
    .replace(/\*\*/g, '')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
