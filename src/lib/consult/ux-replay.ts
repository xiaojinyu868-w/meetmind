export type UxReplaySeverity = 'critical' | 'major' | 'minor';

export interface ExperienceFrame {
  tMs: number;
  label: string;
  text: string;
  cardCount?: number;
  actionCount?: number;
  screenshotPath?: string;
}

export interface ExperienceEvent {
  tMs: number;
  type: 'user-input' | 'click' | 'wait' | 'snapshot' | 'agent-output';
  label: string;
  text?: string;
}

export interface ExperienceTrace {
  id: string;
  title: string;
  userGoal: string;
  frames: ExperienceFrame[];
  events: ExperienceEvent[];
}

export interface UxReplayCriterion {
  id: string;
  label: string;
  severity: UxReplaySeverity;
  passed: boolean;
  evidence: string;
  fixHint: string;
  codeHotspots: string[];
}

export interface UxReplayScore {
  traceId: string;
  title: string;
  status: 'passed' | 'failed';
  score: number;
  maxScore: number;
  criteria: UxReplayCriterion[];
}

const INTERNAL_STATUS_PATTERNS = [
  /读取你的画像/,
  /readProfile/i,
  /工具轨迹/,
  /Agent 动作/,
  /工作摘要/,
  /详情/,
];

const WAIT_DONE_PATTERNS = [
  /判断已接上/,
  /已处理/,
  /完成/,
];

const WAIT_ACTIVE_PATTERNS = [
  /正在/,
  /我在/,
  /处理中/,
];

const ASSUMED_TARGET_PATTERNS = [
  /Stanford/i,
  /Percy Liang/i,
  /NLP/i,
  /NLP PhD/i,
];

export function evaluateConsultExperienceTrace(trace: ExperienceTrace): UxReplayScore {
  const criteria = [
    evaluateNoTargetAssumption(trace),
    evaluateWaitingIsSingleAndHonest(trace),
    evaluateNoStaleStreamingUi(trace),
    evaluateInternalNoise(trace),
    evaluateNoDuplicateJudgment(trace),
    evaluateActionableExit(trace),
    evaluateVisualLoad(trace),
  ];
  const score = criteria.filter((criterion) => criterion.passed).length;
  return {
    traceId: trace.id,
    title: trace.title,
    status: score === criteria.length ? 'passed' : 'failed',
    score,
    maxScore: criteria.length,
    criteria,
  };
}

function evaluateNoTargetAssumption(trace: ExperienceTrace): UxReplayCriterion {
  const userText = trace.userGoal;
  const userAlreadySpecified = ASSUMED_TARGET_PATTERNS.some((pattern) => pattern.test(userText));
  const agentText = trace.frames.map((frame) => frame.text).join('\n');
  const assumed = userAlreadySpecified
    ? []
    : ASSUMED_TARGET_PATTERNS.filter((pattern) => pattern.test(agentText));

  return {
    id: 'no-target-assumption',
    label: '背景-only 用户不被系统替他假设目标',
    severity: 'critical',
    passed: assumed.length === 0,
    evidence: assumed.length === 0
      ? '未发现系统自行引入 Stanford/Percy/PhD/NLP 等目标对象'
      : `系统自行引入了 ${assumed.length} 个目标词`,
    fixHint: '入口、system prompt 和定位 skill 要先接待背景，再让用户确认路线变量。',
    codeHotspots: [
      'src/app/(agent-native-infra)/consult/[orgSlug]/page.tsx',
      'src/app/api/(agent-native-infra)/consult/chat/route.ts',
      'platform-skills/scenarios/application-positioning/SKILL.md',
    ],
  };
}

function evaluateWaitingIsSingleAndHonest(trace: ExperienceTrace): UxReplayCriterion {
  const waitFrames = trace.frames.filter((frame) => isWaitingFrame(frame));
  const repeatedSkeleton = waitFrames.some((frame) => countMatches(frame.text, /我在判断|正在判断|判断已接上/g) > 1);
  const dishonestDone = waitFrames.some((frame) =>
    WAIT_DONE_PATTERNS.some((pattern) => pattern.test(frame.text)),
  );
  const passed = !repeatedSkeleton && !dishonestDone;

  return {
    id: 'waiting-state-quality',
    label: '长等待只有一个诚实的在场反馈',
    severity: 'critical',
    passed,
    evidence: passed
      ? `等待帧 ${waitFrames.length} 个，未发现重复骨架或“未完成却说完成”`
      : [
          repeatedSkeleton ? '等待期出现重复判断骨架' : '',
          dishonestDone ? '等待期出现“判断已接上/已处理”等完成态文案' : '',
        ].filter(Boolean).join('；'),
    fixHint: '等待态应只显示一个当前状态，streaming 中用“正在”，不要展示低价值内部步骤。',
    codeHotspots: [
      'src/app/(agent-native-infra)/consult/[orgSlug]/page.tsx',
      'src/components/consult/skeletons.tsx',
      'src/components/consult/activity-timeline.tsx',
    ],
  };
}

function evaluateNoStaleStreamingUi(trace: ExperienceTrace): UxReplayCriterion {
  const finalFrame = trace.frames[trace.frames.length - 1];
  const finalText = finalFrame?.text ?? '';
  const actionCount = finalFrame?.actionCount ?? inferActionCount(finalText);
  const hasDeliveredChoiceOrArtifact = actionCount >= 2 || /顾问判断|服务方案|CV 诊断|导师探索|外联工作台/.test(finalText);
  const staleStreaming = hasDeliveredChoiceOrArtifact && /正在判断你的真实意图|正在工作|我在判断\n/.test(finalText);

  return {
    id: 'no-stale-streaming-ui',
    label: '真实 UI 出来后不残留 streaming 骨架',
    severity: 'critical',
    passed: !staleStreaming,
    evidence: !staleStreaming
      ? '最终画面未发现已交付内容与 streaming 骨架同屏'
      : '最终画面仍含“正在判断/正在工作”等 streaming 残影',
    fixHint: '按 toolName/toolCallId 去重；output-available 出现后隐藏同名 input-streaming skeleton。',
    codeHotspots: [
      'src/app/(agent-native-infra)/consult/[orgSlug]/page.tsx',
      'src/components/consult/skeletons.tsx',
    ],
  };
}

function evaluateInternalNoise(trace: ExperienceTrace): UxReplayCriterion {
  const noisyFrames = trace.frames.filter((frame) =>
    INTERNAL_STATUS_PATTERNS.some((pattern) => pattern.test(frame.text)),
  );

  return {
    id: 'no-internal-noise',
    label: '用户视角不暴露低价值内部过程',
    severity: 'major',
    passed: noisyFrames.length === 0,
    evidence: noisyFrames.length === 0
      ? '未发现 readProfile/tool 轨迹/工作摘要等内部噪音'
      : `${noisyFrames.length} 个画面含内部状态：${noisyFrames.map((frame) => frame.label).join(', ')}`,
    fixHint: 'readProfile/useSkill 这类后台动作进入 trace，不默认进入学生可见 UI。',
    codeHotspots: [
      'src/app/(agent-native-infra)/consult/[orgSlug]/page.tsx',
      'src/components/consult/activity-timeline.tsx',
      'src/components/consult/workbench-compass.tsx',
    ],
  };
}

function evaluateNoDuplicateJudgment(trace: ExperienceTrace): UxReplayCriterion {
  const titles = trace.frames.flatMap(extractJudgmentTitles);
  const duplicateTitles = titles.filter((title, index) => titles.indexOf(title) !== index);

  return {
    id: 'no-duplicate-judgment-card',
    label: '按钮闭环不重复生成同类判断卡',
    severity: 'critical',
    passed: duplicateTitles.length === 0,
    evidence: duplicateTitles.length === 0
      ? '未发现重复顾问判断标题'
      : `重复判断：${Array.from(new Set(duplicateTitles)).join(' / ')}`,
    fixHint: '用户点击 showConsultantMove 动作后，应推进到 askOptions/servicePlan/discovery/draft，而不是重发同类判断。',
    codeHotspots: [
      'src/lib/consult/ui-action-routing.ts',
      'src/components/consult/assistant-turn-frame.tsx',
      'platform-skills/scenarios/application-positioning/SKILL.md',
    ],
  };
}

function evaluateActionableExit(trace: ExperienceTrace): UxReplayCriterion {
  const finalFrame = trace.frames[trace.frames.length - 1];
  const actionCount = finalFrame?.actionCount ?? inferActionCount(finalFrame?.text ?? '');
  const passed = actionCount >= 2 && actionCount <= 5;

  return {
    id: 'actionable-exit',
    label: '每轮都有少量真实出口',
    severity: 'major',
    passed,
    evidence: finalFrame ? `最终画面 actionCount=${actionCount}` : '没有最终画面',
    fixHint: '一轮回复应给 2-5 个可推进动作，避免零出口或按钮海。',
    codeHotspots: [
      'src/components/consult/consultant-move.tsx',
      'src/components/consult/service-plan.tsx',
      'src/lib/consult/ui-tools.ts',
    ],
  };
}

function evaluateVisualLoad(trace: ExperienceTrace): UxReplayCriterion {
  const overloaded = trace.frames.filter((frame) => {
    const cardCount = frame.cardCount ?? inferCardCount(frame.text);
    const visibleChars = compact(frame.text).length;
    return cardCount > 4 || visibleChars > 1800;
  });

  return {
    id: 'visual-load',
    label: '单屏信息负荷不过载',
    severity: 'major',
    passed: overloaded.length === 0,
    evidence: overloaded.length === 0
      ? '未发现单屏卡片过多或文本过长'
      : `${overloaded.length} 个画面信息负荷过高：${overloaded.map((frame) => frame.label).join(', ')}`,
    fixHint: '旧回合折叠，长方案渐进披露，当前屏只保留一个焦点。',
    codeHotspots: [
      'src/components/consult/assistant-turn-frame.tsx',
      'src/components/consult/workbench-compass.tsx',
      'src/components/consult/service-plan.tsx',
    ],
  };
}

function isWaitingFrame(frame: ExperienceFrame): boolean {
  const text = frame.text;
  return /等待|wait|stream|正在|我在判断|判断已接上|已处理/.test(`${frame.label}\n${text}`);
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function extractJudgmentTitles(frame: ExperienceFrame): string[] {
  const lines = frame.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titles: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== '顾问判断') continue;
    const title = lines[i + 1];
    if (title && title.length <= 48) titles.push(title);
  }
  return titles;
}

function inferActionCount(text: string): number {
  const actionLikeLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0 &&
      line.length <= 18 &&
      /定位|评估|看看|路线|CV|导师|材料|语音|建议|时间|学位|申硕|申博|补强|项目/.test(line),
    );
  return new Set(actionLikeLines).size;
}

function inferCardCount(text: string): number {
  return countMatches(text, /顾问判断|服务方案|导师探索|工作台|CV 诊断|我在判断|判断已接上/g);
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}
