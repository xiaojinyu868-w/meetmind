import type { TeachBackJudgeId, TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';

/**
 * teach-back-panel-prompt — 「讲给同桌听」评委席的 prompt（连续讲述版，/api/apps/teach-back/turn）。
 *
 * 设计遵守《提示词设计哲学》：给场景、给人、给上下文、给判断权；渲染契约只有两行——
 * 第一行谁开口（或没人开口），之后是这个人说的话。谁说、说什么、还是沉默让他继续，由模型判断，
 * 这里不写"如果……就……"。
 *
 * 纯字符串函数，前后端都能 import；禁止 Node 侧依赖。
 *
 * v2（2026-09-11，开口预算）：用户的体感目标是"像通话"。v1 让评委一次说 1-3 句，实测 TTS 读完要 10-13 秒，
 * 讲的人站在那里等——不像插话，像点评。现在一次开口就是一口气：一句话 + 一个问题（或只一句"继续"），
 * 针对刚讲的这一段，二三十个字读出来五六秒；服务端 JUDGE_SAY_MAX_CHARS 是保险丝，不是目标。
 */

export const TEACH_BACK_PANEL_PROMPT_VERSION = 'teach-back-panel-v2';

/** 评委在 prompt 里的中文称呼（与 copy-apps 里给用户看的名字保持一致，方便模型和用户说的是同一个人） */
export const JUDGE_PROMPT_NAMES: Record<TeachBackJudgeId, string> = {
  direct: '直言',
  guide: '引导',
  probe: '追问',
};

export interface TeachBackPanelSystemInput {
  lessonTitle?: string;
  subject?: string;
  targets: TeachBackTarget[];
}

export function buildTeachBackPanelSystemPrompt(input: TeachBackPanelSystemInput): string {
  const targetLines = input.targets.map((target, index) => `${index + 1}. ${target.point}${target.why ? `（${target.why}）` : ''}`).join('\n');
  const lesson = input.lessonTitle ? `这节课是「${input.lessonTitle}」。` : '';
  const subject = input.subject ? `学科：${input.subject}。` : '';
  return `一位同学刚上完一节课，现在站在讲台上，把这节课亲口讲给台下三位同学听——费曼学习法：能讲出来的才是真的懂。${lesson}${subject}
台下这三位是三种性格的评委，你同时扮演他们三个人，也扮演"这一排人"本身的默契：

- 直言（代号 direct）：一针见血。听出漏洞、偷换的概念、倒置的因果、没说清的定义，就直接指出来，追问他"为什么"和"这是什么"。不客套，不复述他的话。
- 引导（代号 guide）：循循善诱。看见他讲到一半卡住、或讲得笼统飘着，就帮他往前推一步——一个类比、一个提示、一个"如果……会怎样"的问题，把没讲清的地方往前推，不替他把答案说完。
- 追问（代号 probe）：抓具体。"你说的 X 具体是什么？举个例子 / 给个数字。"让抽象的话落到地上。

你们面前有这节课的真实原文——判断他讲得对不对，以原文为准，不用你们自己的知识替他加分或扣分。他的话是语音实时转写来的，会有同音错字和口语碎片，读意思不读字。

这一排评委像真人一样有分寸：他正讲在兴头上、刚开了个头、或这一段太短没听清，就谁都不开口，让他继续；一段讲完了确实有话可说，才一个人开口——说给他刚讲的这一段，不翻旧账，不念清单。谁开口也自然轮替，同一个人不会连着抢话，但谁最有话说谁说。不讲课、不长篇补充知识——他讲得对不对稍后会对照课堂原声逐条核对，那不是评委席此刻的事；也不空泛地夸"讲得很好"。

开口就是插一句话，像电话里对方讲到一半你接的那一句：一句话 + 一个问题，或者只一句让他接着讲的话（"接着说""然后呢""那这个例子呢"）。一口气说完，二三十个字，读出来五六秒——他还站在讲台上，你说得越长他等得越久。有两件事想说，只说更要紧的那一件，另一件留到他下一段。

他希望这一场能覆盖这些目标点（放在你们心里，不念出来；没讲到的点可以在他收尾时自然地问起）：
${targetLines || '（由你们边听边判断这节课的核心内容）'}

你们的话会被读出声、也显示在头顶的气泡里，所以是嘴上说的话：简体中文口语，不用 Markdown、不用 LaTeX 记号（x 的平方就说"x 的平方"）。

输出只有两部分，不解释：
第一行：开口者代号 direct / guide / probe 三选一；谁都不开口就写 none
第二行起：这位评委说的话（像坐在台下的人真的开口）`;
}

export interface TeachBackPanelUserInput {
  /** 课堂原文（已按预算裁剪） */
  transcriptContext: string;
  /** 给的是与刚讲这段相关的节选（整节课没全给）——评委不该把"原文里没有"当成"老师没讲" */
  transcriptWindowed?: boolean;
  /** 本场至今的记录（已裁剪；不含 latestSegment） */
  history: TeachBackTurn[];
  /** 他刚讲完的这一段（回合文本） */
  latestSegment: string;
  /** turn = 一段讲完了；check-in = 他已经有一会儿没说话（约 40 秒） */
  mode: 'turn' | 'check-in';
  recentSpeakers: TeachBackJudgeId[];
}

function formatHistory(turns: TeachBackTurn[]): string {
  if (turns.length === 0) return '（这是他开口的第一段）';
  return turns.map((turn) => {
    if (turn.role === 'user') return `他：${turn.text}`;
    const name = turn.judgeId ? JUDGE_PROMPT_NAMES[turn.judgeId] : '同桌';
    return `${name}：${turn.text}`;
  }).join('\n');
}

export function buildTeachBackPanelUserPrompt(input: TeachBackPanelUserInput): string {
  const recent = input.recentSpeakers.length > 0
    ? `最近开口过的评委（新→旧）：${input.recentSpeakers.map((id) => JUDGE_PROMPT_NAMES[id]).join('、')}`
    : '还没有评委开口过。';
  const moment = input.mode === 'check-in'
    ? `他讲完上一段后已经安静了约 40 秒，没有再开口。也许在想，也许讲完了。真人评委这时候会轻轻问一句——要不要先到这儿，还是还有哪一点想接着讲——而不是接着追问内容；也可以继续等（none）。`
    : `他刚讲完的这一段：
「${input.latestSegment}」`;
  const transcriptLabel = input.transcriptWindowed
    ? '课堂原文（正确性的唯一依据；这里是与他刚讲这段相关的节选，节选之外的内容不要断言老师没讲过）：'
    : '课堂原文（正确性的唯一依据）：';
  return `${transcriptLabel}
${input.transcriptContext}

本场至今（「他：」是正在讲的同学；其余是评委说过的话）：
${formatHistory(input.history)}

${moment}

${recent}

现在决定：谁开口，说什么；或者 none。`;
}
