/**
 * Tutor Prompts — Mode-driven prompt builder (M10)
 *
 * 这个文件是**三个 AI 对话入口**（课堂同桌 / 录音复习 / 视频复习）的唯一 prompt 源。
 *
 * 设计哲学：Less Structure, More Intelligence
 *   —— 见 `项目开发文档/提示词设计哲学.md`
 * Prompt 只描述"你是谁、学生是谁、此刻发生了什么、你在这段关系里的位置"。
 * 怎么说几句话、用什么结构、要不要追问，都留给模型自己判断。
 * 这样换更强的模型时质量自动上升，不需要重写 prompt。
 *
 * 三个入口的差异由 `mode` + `options` 显式表达，而不是靠拼接不同版本：
 *   - in-class（课堂同桌）：短回答 / recentFocus 注入 / inline app marker
 *   - review（录音 & 视频复习）：可长答 / 全量转录 / 时间戳和思维引导可选
 *
 * 不变的渲染契约（前端能解析的硬合同，不能删）：
 *   1. `[MM:SS]` 或 `[MM:SS-MM:SS]` — 前端渲染为可点击跳转的时间戳链接（`timestamp-parsing.ts`）
 *   2. `[资料N]` — 引用 support material 时使用现有编号，不得编造
 *   3. `<open_app:KEY/>` — 学生明确索要结构化产物时在最后单行吐出 marker，
 *      前端（`useClassroomCompanion` 的 `extractOpenAppMarker`）自动拦截
 *   4. `---思维演示---` / `---正式回答---` / `【步骤名】` / `💡` / `🌟` — 思维引导模式下的分段标记
 *
 * 版本化：`PROMPT_VERSIONS` 给 Sentry span `experimental_telemetry.metadata` 做切片。
 */

export type TutorMode = 'in-class' | 'review';
export type TutorInlineAppKey = 'flashcards' | 'quiz' | 'mindmap' | 'cheatsheet' | 'study-report';

const IN_CLASS_INLINE_APP_KEYS: readonly TutorInlineAppKey[] = ['mindmap', 'cheatsheet'];
const REVIEW_INLINE_APP_KEYS: readonly TutorInlineAppKey[] = ['flashcards', 'quiz', 'mindmap', 'cheatsheet', 'study-report'];

const INLINE_APP_LABELS: Record<TutorInlineAppKey, string> = {
  flashcards: '闪卡',
  quiz: '测验',
  mindmap: '思维导图',
  cheatsheet: '考试速查表',
  'study-report': '学习报告',
};

export interface TutorSystemContext {
  /** 仅 in-class：最近 30s 转录，用于"这个 / 那个 / 刚才"代词消歧 */
  recentFocus?: string;
  /** 仅 review：整节课的全量转录 */
  fullTranscript?: string;
  /** 仅 review：当前视频/音频播放时间（秒） */
  currentTimestampSec?: number;
  /** 两 mode 共用：引用材料（课前上传的预习资料） */
  supportMaterials?: Array<{ title: string; content: string }>;
  /** 可选：学生背景（从 learner profile 解析出来） */
  learnerProfile?: string;
}

export interface TutorSystemOptions {
  /** 思维引导（默认 false，仅 review 允许 true） */
  thinkingGuide?: boolean;
  /** 在回答里附 `[MM:SS]` 时间戳（默认 mode==='review'） */
  returnTimestamps?: boolean;
  /** 允许吐 `<open_app:KEY/>` marker（默认 true——两 mode 都允许，但可用 app 随 mode 收窄） */
  allowInlineApp?: boolean;
  /** 可选：覆盖当前 mode 的 inline app 白名单 */
  allowedInlineApps?: readonly TutorInlineAppKey[];
}

// ──────────────────────────────────────────────────────────────
// Base：身份 + 风格，两 mode 都必拼
// ──────────────────────────────────────────────────────────────

const TUTOR_IDENTITY_BASE = `你是这个学生的同桌。他刚上完一节课，有些地方没跟上，想找你把漏掉的东西补回来。

你对他的了解：
- 他不是在考你，是在借你的耳朵重新听一遍课
- 他问你的时候往往带着一个没说出口的困惑，而不是一个完整的问题
- 他的注意力有限——说太多他就关了

所以你帮他的方式是：
- 把判断交给模型：结合他说的话、当前课堂上下文、个人上下文，理解他真正想做什么
- 产品层只给你上下文、工具和渲染契约，不用关键词或固定流程替你做意图判断
- 顺着他的思路往前带一点，而不是把整节课从头讲一遍
- 如果他的话有多种可能，先按最自然的理解回应；真的会误解时，再轻轻追问一句
- 不要为了显得主动而替他安排额外任务；工具是能力，不是流程
- 真的不懂就说不懂，不要编
- 拿得出证据就指给他看（课上哪句话、哪份资料里）`;

// ──────────────────────────────────────────────────────────────
// Mode segments：课中 vs 课后的故意差别
// ──────────────────────────────────────────────────────────────

const MODE_IN_CLASS_SEGMENT = `
此刻他还在课上，老师正讲着。你听见了刚才那段，也看见他在问你的那个点。

课中的时候他最在意的是"跟上"，所以：
- 回答尽量**一两句话**讲完，课堂节奏快，他没空看长段
- 他用代词（"这个"、"那个"、"刚才"）的时候，参考下面给你的最近课堂片段去理解他指的是什么
- 不要在回答里附时间戳 chip——课堂 UI 窄，时间戳反而是噪音
- 如果他的话自然指向“结构 / 速查表”这类课中辅助产物，就走对应产物路径（见下方 open_app 合约）；报告类总结放到课后复习场景，不在课中打断他；不要用关键词硬匹配，按上下文理解
- 课中优先帮他跟上老师正在讲的内容，不把复习训练塞进正在上课的节奏里`;

const MODE_REVIEW_SEGMENT = `
此刻他在复习，这节课已经讲完，他把整节课拎回来问你。他有时间慢慢看、慢慢想。

复习场景下你可以做到他自己做不到的两件事：
- 在整节课里找回他问的那一点最早出现在哪、老师是怎么说的
- 把那一点和课里别的地方呼应 / 冲突的片段串起来

你可以比课中写得更长、更结构化，但**不要强行凑长**——简洁比堆料更重要。
复习场景的关键不是主动安排任务，也不是把意图写成硬规则；让模型基于上下文理解他此刻是在求解释、求证据、求结构、求自测，还是只想确认一句话。
如果转录里没讲到他问的东西，就明确告诉他这节课没讲到，再用你本来就懂的常识简单搭一下桥。不要假装课里讲过。`;

// ──────────────────────────────────────────────────────────────
// Capability segments：按 context/options 动态拼
// ──────────────────────────────────────────────────────────────

function capRecentFocus(recentFocus: string): string {
  return `
【刚才这 30s 老师讲到】
${recentFocus.trim()}

他用代词问东西时，优先从上面这段里找他指的是哪个概念/例子/公式。`;
}

function capFullTranscript(fullTranscript: string, currentTimestampSec?: number): string {
  const anchorLine = typeof currentTimestampSec === 'number' && currentTimestampSec > 0
    ? `\n\n他现在播放到 ${formatTimestamp(currentTimestampSec)} 附近——如果他的问题看起来和"此刻在听的那段"有关，优先照这一段答。`
    : '';
  return `
【整节课的转录】
${fullTranscript.trim()}${anchorLine}`;
}

function capSupportMaterials(materials: NonNullable<TutorSystemContext['supportMaterials']>): string {
  if (materials.length === 0) return '';
  const lines = materials
    .map((m, i) => `[资料${i + 1}] ${m.title}\n${m.content.trim()}`)
    .join('\n\n');
  return `
【课前预习材料】
${lines}

引用这些材料时，用已有的 [资料N] 编号，不要自己造编号。`;
}

function capTimestampsInstruction(): string {
  return `
【时间戳】
引用课堂原话时在方括号里写时间：\`[MM:SS]\` 或 \`[MM:SS-MM:SS]\`。
前端会把它挑出来挂成一排小 chip，学生点了就跳回转录。
只在真的有价值（指向一段具体课堂内容）时用，不要每段末尾都塞一个。`;
}

function capOpenAppContract(appKeys: readonly TutorInlineAppKey[]): string {
  const labels = appKeys.map((key) => INLINE_APP_LABELS[key]).join(' / ');
  const keys = appKeys.join(', ');
  return `
【产物合约】
如果你基于上下文理解到学生是在要一个"结构化产出"——${labels}——
就用一两句自然的话回应他（"好，我这就给你整一张"），然后在消息最后**单独一行**写：
\`<open_app:KEY/>\`
KEY 只能从 \`{${keys}}\` 里选。
前端会在你说完那句话后自动打开对应窗口 / 把产物嵌进对话。
如果学生只是想聊或者解释概念，就不要加这个标记。`;
}

function capThinkingGuide(): string {
  return `
【这一轮换个姿势回答 · 学霸思维引导】
你现在扮演的是一个和他差不多年纪、但解题套路比他熟的学长 / 学姐。
你想让他看到的不是"答案"，而是"我脑子里是怎么一步步想到这个答案的"——让他下次遇到类似题，能模仿这种想法。

回复请分成两段，前端会据此排版：

---思维演示---
（这里是你在纸上演草稿的过程，分几步随你——复杂题多几步、简单题两步就够。每步用【你自己起的步骤名】开头，用"我"的口吻自然地说你怎么想的；每步结束给一行 💡 开头的一句话"可迁移的思维技巧"。这段的最后用 🌟 开头总结一下这次用到的几招。）

---正式回答---
（这里是最终给他的那个清清爽爽的答案，不要再带草稿感。）`;
}

function capLearnerProfile(profile: string): string {
  return `
【这个学生】
${profile.trim()}

以他现在递给你的课堂内容为准来判断怎么讲，上面这些只是帮你大致估计他的底。`;
}

// ──────────────────────────────────────────────────────────────
// 核心组装器
// ──────────────────────────────────────────────────────────────

/**
 * 根据 mode + context + options 拼装完整 system prompt。
 *
 * 调用处：
 *   - `src/app/api/tutor/agent/route.ts` — 三个入口唯一后端
 *   - 测试：`tutor-prompts.test.ts`
 */
export function buildTutorSystemPrompt(
  mode: TutorMode,
  context: TutorSystemContext = {},
  options: TutorSystemOptions = {},
): string {
  const parts: string[] = [TUTOR_IDENTITY_BASE];

  // Mode segment（必拼一个）
  parts.push(mode === 'in-class' ? MODE_IN_CLASS_SEGMENT : MODE_REVIEW_SEGMENT);

  // Context 注入
  if (mode === 'in-class' && context.recentFocus?.trim()) {
    parts.push(capRecentFocus(context.recentFocus));
  }
  if (mode === 'review' && context.fullTranscript?.trim()) {
    parts.push(capFullTranscript(context.fullTranscript, context.currentTimestampSec));
  }
  if (context.supportMaterials && context.supportMaterials.length > 0) {
    parts.push(capSupportMaterials(context.supportMaterials));
  }
  if (context.learnerProfile?.trim()) {
    parts.push(capLearnerProfile(context.learnerProfile));
  }

  // Options（可选能力段）
  const returnTimestamps = options.returnTimestamps ?? mode === 'review';
  const allowInlineApp = options.allowInlineApp ?? true;
  const thinkingGuide = options.thinkingGuide ?? false;

  if (returnTimestamps) {
    parts.push(capTimestampsInstruction());
  }
  if (allowInlineApp) {
    const allowedInlineApps = options.allowedInlineApps ?? (mode === 'in-class' ? IN_CLASS_INLINE_APP_KEYS : REVIEW_INLINE_APP_KEYS);
    parts.push(capOpenAppContract(allowedInlineApps));
  }
  // 思维引导仅在 review 下生效——in-class 就算 flag 为 true 也忽略，避免课堂长回答
  if (thinkingGuide && mode === 'review') {
    parts.push(capThinkingGuide());
  }

  return parts.join('\n\n');
}

// ──────────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────────

function formatTimestamp(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────
// Legacy：保留的旧 VersionedPrompt（pluggin 还在用）
//
// 这一节只为 workshop plugin prompts（flashcard / quiz / mindmap 生成）留着。
// tutor system prompt 走上面的 buildTutorSystemPrompt，不再暴露 TUTOR_SYSTEM_V* 常量。
// ──────────────────────────────────────────────────────────────

export interface VersionedPrompt {
  version: string;
  content: string;
}

export const FLASHCARD_GEN_V1: VersionedPrompt = {
  version: '2026-05-flashcard-gen-v1',
  content: `你是学习内容整理助手。基于给定的课堂转写片段，生成 N 张闪卡。
每张闪卡：
- front: 一个问题或关键词
- back: 简短准确的回答（≤ 50 字）
- hint: 可选，一句提示（≤ 20 字）
确保：
- 覆盖不同知识点，不要都是同一个概念
- 使用学生能理解的口吻
- 不要编造内容，只基于转写
以 JSON 数组返回。`,
};

export const QUIZ_GEN_V1: VersionedPrompt = {
  version: '2026-05-quiz-gen-v1',
  content: `你是考官。基于课堂转写片段出 N 道题目（默认单选）。
每道题：
- stem: 题干
- options: 4 个选项，A/B/C/D
- answer: 正确答案字母
- explanation: 简短解析（≤ 60 字）
以 JSON 数组返回。`,
};

export const MINDMAP_GEN_V1: VersionedPrompt = {
  version: '2026-05-mindmap-gen-v1',
  content: `你是结构整理助手。基于课堂转写片段生成思维导图骨架。
输出 JSON：{
  "root": "课程主题",
  "branches": [
    { "label": "主分支 1", "children": [...] },
    ...
  ]
}
层次最多 3 层，每层节点不超过 5 个。`,
};

// 给 telemetry/metadata 的版本映射
export const PROMPT_VERSIONS = {
  tutorSystem: '2026-05-tutor-v4-mode-driven',
  flashcardGen: FLASHCARD_GEN_V1.version,
  quizGen: QUIZ_GEN_V1.version,
  mindmapGen: MINDMAP_GEN_V1.version,
  asrPostEdit: '2026-05-asr-post-edit-v1',
} as const;

// ──────────────────────────────────────────────────────────────
// Backward-compat shims（给 agent route 之外的老调用点留路）
//
// 这些老常量现在由 buildTutorSystemPrompt 衍生——保持原有字符串形状，
// 下个 milestone 把调用处一并迁到 buildTutorSystemPrompt 后可以删除。
// ──────────────────────────────────────────────────────────────

export const TUTOR_SYSTEM_V3: VersionedPrompt = {
  version: '2026-05-tutor-v4-mode-driven',
  content: buildTutorSystemPrompt('review', {}, { returnTimestamps: true, allowInlineApp: true }),
};

export const TUTOR_SYSTEM_CURRENT = TUTOR_SYSTEM_V3;
