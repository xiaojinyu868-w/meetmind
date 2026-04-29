import type { UIMessage } from 'ai';

export type WorkbenchAtom = 'perception' | 'judgment' | 'interaction' | 'action' | 'evaluation';

export interface WorkbenchAction {
  id: string;
  label: string;
}

export interface WorkbenchSignal {
  label: string;
  value: string;
}

export interface ConsultWorkbenchState {
  visible: boolean;
  status: 'working' | 'ready' | 'blocked';
  stage: string;
  title: string;
  subtitle?: string;
  detail?: string;
  activeTool?: string;
  atoms: WorkbenchAtom[];
  signals: WorkbenchSignal[];
  nextActions: WorkbenchAction[];
  note?: string;
}

export const WORKBENCH_ATOM_LABEL: Record<WorkbenchAtom, string> = {
  perception: '看见信息',
  judgment: '形成判断',
  interaction: '让你参与',
  action: '产出交付',
  evaluation: '可复盘',
};

type PartLike = {
  type?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
};

type ToolPart = {
  toolName: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

const TOOL_ATOMS: Record<string, WorkbenchAtom[]> = {
  useSkill: ['perception'],
  readProfile: ['perception'],
  webSearch: ['perception', 'evaluation'],
  searchProgramRequirements: ['perception', 'evaluation'],
  fileUpload: ['perception', 'interaction'],
  showConsultantMove: ['judgment'],
  showAdvisorDiscovery: ['judgment', 'evaluation'],
  askOptions: ['interaction'],
  startVoiceCall: ['interaction', 'action'],
  showDraft: ['action', 'evaluation'],
  showServicePlan: ['judgment', 'action', 'evaluation'],
  showOutreachWorkspace: ['judgment', 'action', 'evaluation'],
  writeProfile: ['action'],
  ctaWechat: ['action'],
};

const UI_TOOL_ORDER = [
  'showOutreachWorkspace',
  'showAdvisorDiscovery',
  'showServicePlan',
  'showDraft',
  'showConsultantMove',
  'askOptions',
  'fileUpload',
  'startVoiceCall',
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getToolParts(messages: UIMessage[]): ToolPart[] {
  const toolParts: ToolPart[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const candidate = part as PartLike;
      if (typeof candidate.type !== 'string' || !candidate.type.startsWith('tool-')) continue;
      toolParts.push({
        toolName: candidate.type.slice('tool-'.length),
        state: typeof candidate.state === 'string' ? candidate.state : undefined,
        input: asRecord(candidate.input),
        output: asRecord(candidate.output),
      });
    }
  }

  return toolParts;
}

function latestUiTool(parts: ToolPart[]): ToolPart | undefined {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (UI_TOOL_ORDER.includes(part.toolName)) return part;
  }
  return undefined;
}

function collectAtoms(parts: ToolPart[]): WorkbenchAtom[] {
  const atoms = new Set<WorkbenchAtom>();
  for (const part of parts) {
    for (const atom of TOOL_ATOMS[part.toolName] ?? []) atoms.add(atom);
  }
  return Array.from(atoms);
}

function collectSearchSignal(parts: ToolPart[]): WorkbenchSignal | null {
  const searches = parts.filter((part) => part.toolName === 'webSearch' || part.toolName === 'searchProgramRequirements');
  if (searches.length === 0) return null;
  const citationCount = searches.reduce((sum, part) => sum + arrayValue(part.output?.citations).length, 0);
  return {
    label: '来源',
    value: citationCount > 0 ? `${citationCount} 条已核对` : '待补强',
  };
}

function actionList(input: Record<string, unknown> | undefined): WorkbenchAction[] {
  return arrayValue<Record<string, unknown>>(input?.actions)
    .map((action) => ({
      id: textValue(action.id) ?? textValue(action.label) ?? '',
      label: textValue(action.label) ?? textValue(action.id) ?? '',
    }))
    .filter((action) => action.id && action.label)
    .slice(0, 3);
}

function choiceList(input: Record<string, unknown> | undefined): WorkbenchAction[] {
  return arrayValue<Record<string, unknown>>(input?.choices)
    .map((choice) => ({
      id: textValue(choice.id) ?? textValue(choice.label) ?? '',
      label: textValue(choice.label) ?? textValue(choice.id) ?? '',
    }))
    .filter((choice) => choice.id && choice.label)
    .slice(0, 3);
}

function advisorNote(input: Record<string, unknown> | undefined): string | undefined {
  const candidates = arrayValue<Record<string, unknown>>(input?.candidates);
  if (candidates.length === 0) return undefined;
  const hasShortlisted = candidates.some((candidate) => candidate.status === 'shortlisted');
  const hasExploring = candidates.some((candidate) =>
    candidate.status === 'mentioned' || candidate.status === 'exploring' || candidate.status === 'unknown'
  );
  if (!hasShortlisted && hasExploring) {
    return '导师仍是探索对象，不会默认锁进长期画像。';
  }
  return undefined;
}

function stageFromTool(part: ToolPart): Pick<ConsultWorkbenchState, 'stage' | 'title' | 'subtitle' | 'detail' | 'nextActions' | 'note'> {
  const input = part.input ?? {};

  switch (part.toolName) {
    case 'showConsultantMove':
      return {
        stage: '顾问判断',
        title: textValue(input.title) ?? '正在判断你的真实问题',
        subtitle: textValue(input.read),
        detail: textValue(input.move) ?? textValue(input.question),
        nextActions: actionList(input),
      };
    case 'showAdvisorDiscovery': {
      const candidates = arrayValue(input.candidates);
      return {
        stage: '导师探索',
        title: textValue(input.title) ?? '正在收窄导师方向',
        subtitle: candidates.length > 0 ? `${candidates.length} 个候选正在比较` : textValue(input.read),
        detail: textValue(input.question) ?? textValue(input.read),
        nextActions: actionList(input),
        note: advisorNote(input),
      };
    }
    case 'showServicePlan': {
      const modules = arrayValue(input.modules);
      return {
        stage: '申请方案',
        title: textValue(input.title) ?? '正在组织完整申请方案',
        subtitle: modules.length > 0 ? `${modules.length} 个服务模块，先看当前最该动的` : textValue(input.consultantRead),
        detail: textValue(input.objective) ?? textValue(input.consultantRead),
        nextActions: actionList(input),
      };
    }
    case 'showOutreachWorkspace':
      return {
        stage: '外联工作台',
        title: textValue(input.title) ?? '正在准备导师外联',
        subtitle: '把导师证据、匹配点和开口策略放到同一张工作台',
        detail: textValue(input.summary) ?? textValue(input.currentJudgment),
        nextActions: actionList(input),
      };
    case 'showDraft':
      return {
        stage: textValue(input.kind) === 'cv-diagnosis' ? 'CV 活文档' : '交付草稿',
        title: textValue(input.title) ?? '正在打磨一份交付物',
        subtitle: textValue(input.kind) === 'cv-diagnosis' ? '只维护当前版本，旧版本折叠为记录' : undefined,
        detail: '后续动作会围绕这份交付物继续改，而不是重开流程。',
        nextActions: actionList(input),
      };
    case 'askOptions':
      return {
        stage: '关键选择',
        title: textValue(input.prompt) ?? '需要你做一个低成本选择',
        subtitle: '选完以后 agent 会接着推进当前任务',
        nextActions: choiceList(input),
      };
    case 'fileUpload':
      return {
        stage: '补充材料',
        title: textValue(input.prompt) ?? '需要一份材料来继续判断',
        subtitle: textValue(input.profileKey),
        nextActions: [],
      };
    case 'startVoiceCall':
      return {
        stage: '语音接力',
        title: textValue(input.reason) ?? '适合语音聊透',
        subtitle: textValue(input.openingLine),
        detail: arrayValue<string>(input.focus).slice(0, 3).join('、') || undefined,
        nextActions: [],
      };
    default:
      return {
        stage: '当前任务',
        title: '正在推进这一轮咨询',
        nextActions: [],
      };
  }
}

function collectSignals(parts: ToolPart[], current: ToolPart | undefined): WorkbenchSignal[] {
  const signals: WorkbenchSignal[] = [];
  if (parts.some((part) => part.toolName === 'readProfile')) {
    signals.push({ label: '画像', value: '已读取' });
  }

  const searchSignal = collectSearchSignal(parts);
  if (searchSignal) signals.push(searchSignal);

  if (current?.toolName === 'showAdvisorDiscovery') {
    const candidates = arrayValue(current.input?.candidates);
    if (candidates.length > 0) signals.push({ label: '候选', value: `${candidates.length} 个` });
  }

  if (current?.toolName === 'showServicePlan') {
    const modules = arrayValue(current.input?.modules);
    if (modules.length > 0) signals.push({ label: '模块', value: `${modules.length} 个` });
  }

  return signals.slice(0, 3);
}

export function deriveConsultWorkbench(messages: UIMessage[], busy = false): ConsultWorkbenchState {
  if (messages.length === 0) {
    return {
      visible: false,
      status: 'ready',
      stage: '',
      title: '',
      atoms: [],
      signals: [],
      nextActions: [],
    };
  }

  const toolParts = getToolParts(messages);
  const current = latestUiTool(toolParts);
  const atoms = collectAtoms(toolParts);

  if (!current) {
    return {
      visible: false,
      status: busy ? 'working' : 'ready',
      stage: '理解中',
      title: busy ? '正在接住你的问题' : '等你补一句真实情况',
      subtitle: '先判断意图，再选择工具和 UI',
      activeTool: undefined,
      atoms,
      signals: collectSignals(toolParts, undefined),
      nextActions: [],
    };
  }

  const active = busy || current.state === 'input-streaming' || current.state === 'input-available';
  const stage = stageFromTool(current);

  if (current.toolName === 'showConsultantMove' || current.toolName === 'askOptions') {
    return {
      visible: false,
      status: active ? 'working' : current.state === 'output-error' ? 'blocked' : 'ready',
      activeTool: current.toolName,
      atoms,
      signals: collectSignals(toolParts, current),
      ...stage,
    };
  }

  return {
    visible: true,
    status: active ? 'working' : current.state === 'output-error' ? 'blocked' : 'ready',
    activeTool: current.toolName,
    atoms,
    signals: collectSignals(toolParts, current),
    ...stage,
  };
}
