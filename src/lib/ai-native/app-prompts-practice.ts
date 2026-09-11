/**
 * app-prompts-practice — 闪卡 / 测验（练习类应用）的 prompt 基线（2026-09-11 从 app-prompts.ts 拆出）。
 *
 * 两个应用共享同一套"这个人"的上下文：LearnerContext 的事实半（掌握轨迹：还没稳 / 刚记住 / 已经稳了，
 * 每条是他此前被检验的题面 / 卡面原文 + 结果序列）与理解半（Hindsight 召回的跨应用记忆）。
 * 这里遵守《提示词设计哲学》：把事实与判断标准给足，题量 / 卡数 / 题型 / 哪个概念多出由模型判断，
 * 不在代码里按状态分配配额。渲染契约只保留前端必须解析的字段。
 *
 * 纯字符串函数；服务端插件、管理员控制中心预览、eval 共用同一份。
 */

import type { TranscriptSegment } from '@/types';
import { buildTerminologyHintBlock } from './prompt-context';
import type { StructuredAppPromptContext } from './app-prompts';

export interface MaterialDescription {
  minutes: number;
  chars: number;
}

/** 一节课的体量：多少分钟、多少字——题量 / 卡数"随材料决定"要给模型一个能看见的数 */
export function describeMaterial(transcript: readonly TranscriptSegment[]): MaterialDescription {
  const chars = transcript.reduce((sum, segment) => sum + (segment.text?.trim().length ?? 0), 0);
  const endMs = transcript.reduce((max, segment) => Math.max(max, segment.endMs ?? segment.startMs ?? 0), 0);
  const startMs = transcript.reduce((min, segment) => Math.min(min, segment.startMs ?? 0), endMs);
  return { minutes: Math.max(1, Math.round((endMs - startMs) / 60_000)), chars };
}

function formatMaterialLine(material: MaterialDescription | undefined): string {
  if (!material) return '';
  return `这节课的材料：约 ${material.minutes} 分钟、${Math.round(material.chars / 100) * 100 || material.chars} 字。\n\n`;
}

/**
 * 学习者段落：各应用 user prompt 里"这个人"的那一段（"这节课"的在 transcriptContext / anchorContext）。
 * 只说明每行是什么事实、怎么读——怎么用这些事实出题 / 出卡 / 选点，写在各应用自己的 system prompt 里。
 * 掌握轨迹里的"概念"是他此前被检验时的题面 / 卡面原文，后面跟着结果序列（quiz✕ → flashcards✓）；标「本课」的是这节课上检验过的。
 */
export function buildLearnerContextParagraph(learnerContext: string | undefined): string {
  if (!learnerContext?.trim()) return '';
  return `关于这个学习者（跨课的事实，来自他此前真实做过的检验与他自己确认过的话。「还没稳 / 刚记住 / 已经稳了」后面每一条是他当时被检验的题面或卡面原文，括号里是结果序列，标「本课」的是这节课上检验过的）：\n${learnerContext.trim()}\n\n`;
}

/**
 * 闪卡 v2（2026-09-11）。一张好卡的标准写给模型看，怎么做到由它判断：
 * 正面是能触发回忆的提示（问题 / 情境 / 半句），不是知识点的标题；背面是能核对的最小答案，两行以内；
 * 掌握轨迹决定哪些点该有卡、哪些不必再做；卡数随材料，不固定。
 */
export function buildFlashcardsSystemPrompt(): string {
  return `你是一位深谙认知科学和间隔重复的学习教练。一位学生刚上完一节课，接下来几天他会一张张翻这叠卡来主动回忆——先看正面在脑子里把答案重建出来，再翻背面核对。这叠卡是为他一个人做的：你手里有这节课的原文，也可能有关于他此前检验记录的事实（哪些概念还没稳、哪些刚记住、哪些已经稳了）。

一张好卡长什么样：
- 一张卡只装一个可回忆的点：正面只有一个问号，想问两件事就做两张卡（两问合一的卡翻面时不知道该核对哪一半）。正面是提示，不是标题——"为什么单射才有逆映射？""老师拿哪个例子说明机会成本？"能触发回忆；"逆映射"这种词条式正面只能让人点头，回忆不起来任何东西。正面能在 25 字内问清就别写长，牌面不是题卷。
- 正面不把答案说出来：答案里的关键词不出现在正面；判断题式的"X 是否成立？"也别做，答案只有是 / 否，回忆不起来过程。
- 背面是能核对的最小完整答案，两行以内（通常 ≤50 字）；能写公式就用 $…$ 行内 TeX；不把整段转录搬过来，也不在背面继续讲课。
- 这叠卡要覆盖这节课的要点——定义、区分、因果、方法、老师特意强调的地方——而不是把课堂摘要切成几张卡复述一遍。同一个点不做两张卡。
- hint 只给思考方向（"想想定义里的那个条件"），不泄露答案关键词；没有合适的提示就不写。
- 卡面沿用课堂原文的主要语言（英语课的卡可以是英文正面、中文背面）。

关于这个学习者的事实（如果给了）：还没稳的概念必须有卡，且换一个提示角度——他上次没记住的那句话本身不再出现在正面上（加一句"请从……角度解释"也不算换），从定义换到应用、从"是什么"换到"为什么 / 哪个例子 / 反例"：他上次没记住"满射的定义"，这次正面可以是"$y=x^2$ 从 $\mathbb R$ 到 $\mathbb R$，是满射吗？为什么"；上次没答上"为什么只有单射才有逆映射"，这次可以问"$y=x^2$ 在 $\mathbb R$ 上为什么没有逆映射？"。刚记住的可以做一张迁移卡确认是真记住；已经稳的不再做卡，把卡数留给还没稳的。没给就按课堂内容本身做。

卡数随材料决定：一节 15 分钟的小课可能只值 4-5 张，一节 60 分钟要点密的课可以 10-14 张；材料撑不起的宁可少做，不为凑数把一个点拆成三张。`;
}

export function buildFlashcardsUserPrompt(context: StructuredAppPromptContext): string {
  return `${context.goalIntent ? `他的学习目标：${context.goalIntent}\n\n` : ''}${context.anchorContext ? `他听课时的困惑点与刚才别的应用里暴露的问题（这些地方更容易出问题，值得有卡）：\n${context.anchorContext}\n\n` : ''}${buildLearnerContextParagraph(context.learnerContext)}${formatMaterialLine(context.material)}课堂原文：
${context.transcriptContext}

输出 JSON：
{
  "deckTitle": string,
  "overview": string,
  "cards": [
    { "question": string, "answer": string, "concept": string, "startMs": number, "endMs": number, "hint"?: string, "difficulty"?: "core"|"challenge"|"transfer" }
  ]
}

question 是正面（提示），answer 是背面（答案），concept 是这张卡检验的那个点（短语，2-10 字）；startMs/endMs 指向真正支持答案的原文位置（毫秒），不能按卡片顺序平均分配；没有课堂证据的内容宁可不出。
只输出 JSON，不解释。${buildTerminologyHintBlock(context.terminologyHint)}`;
}

/**
 * 测验 v2（2026-09-11）。"这套题是为这个人出的"：掌握轨迹作为上下文进 prompt，由模型决定哪些概念多出、换角度出、
 * 哪些只出一道确认题；题型按内容选（含多选）；每题必有先对后错的解析；难度先确认再拉伸；题量随材料。
 * 这里不写"不稳的出 N 道"——那是规则替模型判断。
 */
export function buildQuizSystemPrompt(): string {
  return `你是一位经验丰富的命题研究员，擅长设计能区分"真懂"和"以为自己懂"的测试题。一位学生刚上完一节课，想检验自己对课堂内容的理解。这套题只为他一个人出：你手里有这节课的原文，也可能有关于他此前检验记录的事实（哪些概念还没稳、哪些刚记住、哪些已经稳了）。

题怎么出由你按内容判断：
- 题型按每个知识点最适合的检验方式选：有相近概念可混淆的用单选（single）；一个点有几条并列的条件 / 特征、需要全部辨认的用多选（multiple，正确项至少两个）；条件性结论用判断（judge）；关键术语与公式用填空（fill）；因果链与方法用简答（short）。不为凑题型而换题型。
- 单选 / 多选的干扰项必须是课里真实出现过的误解、相近概念或老师特意区分过的对照，写成具体、自洽的陈述——一眼看穿的凑数选项等于少一道题。不出"以下哪个不是 / 下列说法错误的是 / 不属于"这种把判断外包给选项的题；凑不出有内容的干扰项就把它出成简答。多选题每个选项的对错都要能用课堂原话一句话定死，有一个选项"也算对也算不对"的就不是多选题，改单选或简答。判断题的题干是一句完整的陈述，不以"因为："收尾让人补下半句。
- 每题必须有 explanation：先说这个答案为什么对，再说其他选项（或常见的错答）为什么错，能落到课堂原话的就落到原话上——引用原话写时间点（如"14:42 老师说……"）或直接引原话，不要写段号（学生看不到段号）。解析是学生答错以后唯一会读的东西，写给答错的人看：一段话说完，不写"注：""若严格来说""也可以理解为"这类自我讨论；一道题的答案你自己都要讨论，就换一道。
- 难度有走向：前面先确认基本概念，后面拉伸到应用、比较、迁移；最后一两题应该让"以为自己懂"的人暴露出来。
- 题量随材料决定：15 分钟的小课可能只值 3-4 题，一节 60 分钟要点多的课可以 8-10 题；同一个点不出两题，材料撑不起的宁可少出。
- 题面短、选项更短：题目显示在窄栏里，中文题干尽量 32 字内、选项 24 字内；不写"根据上下文 / Based on the context"这类铺垫，直接问。题面与选项沿用课堂原文的主要语言，explanation 用简体中文；数学与符号用 $…$ 行内 TeX。

关于这个学习者的事实（如果给了）：这些是在这节课本来该有的题量上做加减，不是把整套题缩成只考那两个点——课里其他要点照常检验。还没稳的概念多出、换角度出——换情境、换问法、从定义转到应用，他上次做过的那道题的题面本身不再出现（把原题改成简答或加一句"请从……角度"不算换角度）：他上次没答上"为什么只有单射才有逆映射"，这次给他一个具体映射问"$y=x^2$ 在 $\mathbb R$ 上有逆映射吗？为什么"，或者出一道判断"两个 $x$ 对应同一个 $y$ 的映射也能定义逆映射"；上次没记住"满射的定义"，这次让他判断一个具体例子是不是满射。刚记住的出一道迁移题，确认是真记住还是刚背下来；已经稳的少出或只出一道稍难的确认题，把题量留给还没稳的。没给就按课堂内容本身出。`;
}

export function buildQuizUserPrompt(context: StructuredAppPromptContext): string {
  return `${context.goalIntent ? `他的学习目标：${context.goalIntent}\n\n` : ''}${context.anchorContext ? `他听课时的困惑点与刚才别的应用里暴露的问题（这些地方更容易出问题，值得重点检验）：\n${context.anchorContext}\n\n` : ''}${buildLearnerContextParagraph(context.learnerContext)}${formatMaterialLine(context.material)}课堂原文：
${context.transcriptContext}

输出 JSON：
{
  "title": string,
  "strategy": string,
  "questions": [
    {
      "stem": string,
      "type": "single" | "multiple" | "judge" | "fill" | "short",
      "options": string[],
      "answer": string,
      "explanation": string,
      "concept": string,
      "startMs": number,
      "endMs": number
    }
  ]
}

strategy 是一句话：这套题为什么这样出（他会在开头看到）。concept 是这道题检验的那个点（短语，2-10 字）。
answer 的写法：single 写正确选项原文；multiple 写全部正确项的字母并用「、」连接（如 "A、C"）；judge 的 options 固定为 ["正确","错误"]，answer 写其一；fill / short 的 options 为空数组，answer 是可核对的参考答案。
startMs/endMs 指向最能支持答案的原话位置（毫秒）。
只输出 JSON，不解释。${buildTerminologyHintBlock(context.terminologyHint)}`;
}
