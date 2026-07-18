import { buildTerminologyHintBlock } from './prompt-context';
import { buildPromptTranscriptContext } from './prompt-context';
import type { TranscriptSegment } from '@/types';

export const APP_PROMPT_VERSIONS = {
  flashcards: 'app-flashcards-v1',
  quiz: 'app-quiz-v1',
  mindmap: 'app-mindmap-v1',
  cheatsheet: 'app-cheatsheet-v1',
  infographic: 'app-infographic-v1',
  audioOverview: 'app-audio-overview-v1',
} as const;

export interface StructuredAppPromptContext {
  goalIntent?: string;
  transcriptContext: string;
  anchorContext?: string;
  terminologyHint?: string;
}

export interface CheatsheetPromptContext extends StructuredAppPromptContext {
  contextTier: 'unit' | 'exam';
  lessonCount: number;
  sourceSummary: string;
  examScope?: string;
}

export interface CheatsheetScopePromptInput {
  contextTier: 'unit' | 'exam';
  lessonSources: Array<{ sessionId: string; title: string }>;
  exam?: {
    name?: string;
    mode?: 'unknown' | 'closed-book' | 'open-book';
    syllabus?: string;
    pastPapers?: Array<{ title: string; content: string }>;
  };
}

export interface AudioOverviewPromptContext {
  goalIntent?: string;
  narrationCorpus: string;
  chapterEvidenceContext: string;
  anchorContext?: string;
  terminologyHint?: string;
}

export function buildCheatsheetScopePromptContext(input: CheatsheetScopePromptInput): Pick<CheatsheetPromptContext, 'contextTier' | 'lessonCount' | 'sourceSummary' | 'examScope'> {
  const sourceSummary = input.lessonSources.length > 0
    ? input.lessonSources.map((source, index) => `${index + 1}. ${source.title}（sourceId=${source.sessionId}）`).join('\n')
    : '当前课程单元';
  const paperScope = input.exam?.pastPapers
    ?.filter((paper) => paper.content?.trim())
    .map((paper, index) => `真题来源 sourceId=past-paper:${index} · ${paper.title}\n${paper.content.trim().slice(0, 8_000)}`)
    .join('\n\n');
  const examScope = [
    input.exam?.name ? `考试：${input.exam.name}` : '',
    input.exam?.mode === 'open-book' ? '考试方式：开卷，可携带纸面资料' : '',
    input.exam?.mode === 'closed-book' ? '考试方式：闭卷，速查表仅用于考前复习' : '',
    input.exam?.syllabus?.trim() ? `考试大纲 sourceId=exam-syllabus：\n${input.exam.syllabus.trim().slice(0, 8_000)}` : '',
    paperScope || '',
  ].filter(Boolean).join('\n');
  return {
    contextTier: input.contextTier,
    lessonCount: input.lessonSources.length || 1,
    sourceSummary,
    ...(examScope ? { examScope } : {}),
  };
}

export function buildFlashcardsSystemPrompt(): string {
  return '你是一位深谙认知科学和间隔重复理论的学习教练。学生刚上完一节课，需要通过主动回忆来真正记住核心知识，而不仅仅是机械背诵。把这节课的内容转化为一组让他“看到题就能在脑子里把答案重建出来”的闪卡。';
}

export function buildFlashcardsUserPrompt(context: StructuredAppPromptContext): string {
  return `${context.goalIntent ? `他的学习目标：${context.goalIntent}\n\n` : ''}${context.anchorContext ? `他听课时的困惑点（这些地方更容易出问题，值得多覆盖）：\n${context.anchorContext}\n\n` : ''}课堂原文：
${context.transcriptContext}

输出 JSON：
{
  "deckTitle": string,
  "overview": string,
  "cards": [
    { "question": string, "answer": string, "startMs": number, "endMs": number, "hint"?: string, "difficulty"?: "core"|"challenge"|"transfer" }
  ]
}

质量合同：
- 共 8 张左右；以核心概念为主，保留 1-2 张需要比较、推理或迁移到新情境的卡
- 一张卡只检验一个认知动作；题面脱离原文也能读懂，不问“老师讲了什么”“这段主要说什么”
- answer 用 1-3 句话给出可核对的最小完整答案，不把整段转录搬过来
- hint 只能给思考方向，不能直接泄露答案关键词
- 困惑点优先覆盖，但没有课堂证据的内容宁可不出
- startMs/endMs 必须指向真正支持答案的原文位置，不能按卡片顺序平均分配

只输出 JSON，不解释。${buildTerminologyHintBlock(context.terminologyHint)}`;
}

export function buildQuizSystemPrompt(): string {
  return '你是一位经验丰富的命题研究员，擅长设计能区分“真懂”和“以为自己懂”的测试题。学生刚上完一节课，想检验自己对课堂内容的理解程度。题目类型可以是单选、判断、填空、简答任意组合，由你按内容性质决定哪种最合适。' +
    '单选题的每个干扰项都必须来自课堂内容里真实存在的、似是而非的理解偏差或易混淆概念，写成具体、自洽、有信息量的陈述；严禁出现“该片段主要讨论了X”“跳过了这个话题”“仅做了简单引用，未做实质分析”这类与具体知识无关、一眼就是模板的空话选项。如果一道题凑不出 3 个有内容的干扰项，就把它出成简答题而不是硬凑选择题。' +
    '题目会显示在三栏学习界面的中间窄区，阅读成本必须低：每题只检验一个判断；中文题干尽量不超过 32 字，英文题干尽量不超过 24 个词；中文选项尽量不超过 24 字，英文选项尽量不超过 16 个词。不要反复写“根据上下文”“Based on the context”等无信息铺垫，直接提问。通常生成 4-6 道互不重复的题，内容不足时宁可少出。题面与选项优先沿用课堂原文的主要语言，explanation 使用简体中文帮助复盘。';
}

export function buildQuizUserPrompt(context: StructuredAppPromptContext): string {
  return `${context.goalIntent ? `他的学习目标：${context.goalIntent}\n\n` : ''}${context.anchorContext ? `他听课时的困惑点（这些地方更容易出问题，值得重点检验）：\n${context.anchorContext}\n\n` : ''}课堂原文：
${context.transcriptContext}

输出 JSON：
{
  "title": string,
  "strategy": string,
  "questions": [
    {
      "stem": string,
      "type": "single" | "judge" | "fill" | "short",
      "options": string[],
      "answer": string,
      "explanation": string,
      "startMs": number,
      "endMs": number
    }
  ]
}

只输出 JSON，不解释。${buildTerminologyHintBlock(context.terminologyHint)}`;
}

export function buildMindmapSystemPrompt(): string {
  return '你是一位深谙认知科学的知识架构师。你帮一位刚听完课的学生整理一张“扫一眼就能看出这节课讲了什么、几个大块”的结构图——不是详尽的课后笔记，是他余光扫到就能定位自己在课里哪一段的轻量地图。每个节点要像地图标签，用能区分含义的短语命名，不要把解释句、应用建议或多个事实塞进一个节点；完整解释留在原课堂和后续问答里。直接输出 Markdown 大纲（# 根主题 + - 子节点缩进），不要 JSON。';
}

export function buildMindmapUserPrompt(context: StructuredAppPromptContext): string {
  return `${context.goalIntent ? `他的目标：${context.goalIntent}\n\n` : ''}${context.anchorContext ? `他听课时的困惑点（这些主题值得在主干层出现）：\n${context.anchorContext}\n\n` : ''}课堂原文：
${context.transcriptContext}${buildTerminologyHintBlock(context.terminologyHint)}`;
}

export function buildCheatsheetSystemPrompt(): string {
  return '你是考试速查表内容编辑器，不是考题预测器。把多节课堂与明确考试范围压成可打印的高密度参考页；每条必须能被原始材料支持。没有大纲、真题或老师明确措辞时，禁止写“必考、高频、一定考”。只输出 JSON。';
}

export function buildCheatsheetUserPrompt(context: CheatsheetPromptContext): string {
  return `学习目标：${context.goalIntent || '把课程内容压缩成考前可快速定位的参考页'}
学习对象：${context.contextTier === 'exam' ? '一门考试' : '一个课程单元'}
课堂来源（共 ${context.lessonCount || 1} 节）：
${context.sourceSummary}
${context.examScope ? `\n考试范围证据：\n${context.examScope}\n` : ''}
应用场景：学生会打印或导出 PDF；可能在开卷考试中带入考场，也可能用于考前最后压缩。内容必须便于纸面扫读和快速定位。

请生成考试速查表内容草案，分成 3-6 个语义区块，每区块 2-8 条目。页数、纸张和排版由前端根据用户约束处理。
区块 key 从下列枚举中选（label 会在前端被映射成中文，但 key 必须是英文小写）：
  - definition   核心定义（术语 → 一句话释义）
  - formula      关键公式（含推导/条件，如有 LaTeX 写到 latex 字段）
  - process      流程步骤（有顺序的方法/算法）
  - contrast     关键对比（A vs B 的差异，一行一对）
  - pitfall      易错点（选择题/判断题常踩的坑）
  - exemplar     例题套路（只有课堂例题、练习或真题明确支持时才输出）

并非所有课堂都包含全部六类——只输出真有内容的区块。

最小输出契约：
{
  "title": "一句话标题（≤14 字，像'机器学习基础 · 考试速查'）",
  "overview": "这张卡最适合的用法（一句话，≤40 字）",
  "sections": [
    {
      "key": "definition",
      "items": [
        { "term": "术语", "body": "支持 Markdown 的紧凑解释", "emphasis": "normal", "sourceId": "课堂 sessionId", "startMs": 12000, "endMs": 21000 }
      ]
    },
    {
      "key": "formula",
      "items": [
        { "term": "公式名", "body": "描述/条件", "latex": "E = mc^2", "emphasis": "strong", "startMs": 60000, "endMs": 72000 }
      ]
    }
  ]
}

质量要求：
- 默认每条 item 的 body 必须极简——通常一句话、约 60 字内，没空写废话
- body 支持 GFM Markdown：粗体、列表、引用、代码和表格；只有对比关系用 2-5 行小表格会明显更快时才使用表格
- 流程 / 因果 / 层级或小规模数据对比只有在文字更难扫读时，才可在 body 中放一个 mermaid 代码块；仅限 flowchart / pie / xychart-beta，流程图最多 6 个节点，图中数值必须直接来自证据，禁止装饰性图表
- 公式优先写入 latex 字段；body 只补变量含义、成立条件或易错边界，不重复抄公式
- 富文本仍必须适合 2-4 栏纸面：禁止长段落、宽表格、超过 6 个节点的流程图、代码长清单
- term 是短标签（2-8 字），便于扫读
- 跨课先去重，再保留定义的适用条件、公式变量、易混对比和可执行步骤；不要把每节课摘要简单拼接
- emphasis 字段：只有老师明确“反复强调 / 划重点 / 一定考 / 这是必考点”，或真题/大纲直接支持的，标 "strong"；
  其他常规要点标 "normal"。每个 section 内 strong 不超过 1/3，否则失去“标重点”的信号意义
- 避免“嗯/呃/这个”等口头禅
- 用 startMs/endMs 指向课堂证据（毫秒）
- sourceId 必须从上面的课堂 / 大纲 / 真题来源中选择；引用大纲或真题时可省略时间
- 全部输出都必须基于下面的课堂原文，不允许编造

课堂原文：
${context.transcriptContext}

${context.anchorContext ? `学习者关注点：\n${context.anchorContext}\n` : ''}${buildTerminologyHintBlock(context.terminologyHint)}`;
}

export function buildInfographicSystemPrompt(): string {
  return '你是一位教育信息设计师。把一节课提炼成“一张图带走”的视觉学习卡：先判断这节课最值得被看见的一个中心命题，再用极少文字呈现支撑它的结构。严格基于课堂证据，不编造老师金句、数字或关系。信息图不是缩小版课堂笔记，也不是装饰海报；只输出 JSON。';
}

export function buildInfographicUserPrompt(context: StructuredAppPromptContext): string {
  return `应用目标：${context.goalIntent || '生成一张图带走这节课'}
应用场景：学生会在复习时扫一眼，也可能把成品分享到班级群。手机上必须无需放大就能看懂，视觉层级优先于信息数量。

输出 JSON：
{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "infographic": {
    "title": "信息图标题",
    "subtitle": "副标题",
    "keyPoints": ["关键点1", "关键点2"],
    "visualPlan": ["版式/视觉关系说明"],
    "imagePrompt": "供图片模型执行的完整提示词",
    "stylePreset": "克制、清晰的视觉风格",
    "suggestedScene": "class-take-away|timeline|comparison|flowchart|data-viz",
    "suggestedOrientation": "landscape|portrait|square",
    "suggestedDetailLevel": "concise|standard"
  }
}

质量合同：
- 只保留一个中心命题和 3-5 个真正支撑它的视觉模块；不要把整节课摘要塞进一张图
- title 中文尽量不超过 14 字，subtitle 不超过 28 字；每个 keyPoint 尽量不超过 22 字
- 关系优先用位置、连线、对比、流程或尺度表达；不要用一排同质卡片冒充信息设计
- 老师原话只有在课堂原文有可核对措辞时才能作为引语；否则改写为知识陈述，不加引号
- imagePrompt 必须逐字保留 title 与 keyPoints，并明确“禁止新增文字、禁止伪造数字、禁止密集小字”
- 没有数值证据时不得选择 data-viz；没有顺序或因果证据时不得选择 timeline / flowchart
- 适配 MeetMind 的米白纸感、墨绿与朱批红点缀；禁止高饱和渐变、3D 商务插画和模板海报感
- 只输出 JSON，不解释

${context.anchorContext ? `学习者关注点：\n${context.anchorContext}\n\n` : ''}课堂原文：
${context.transcriptContext}${buildTerminologyHintBlock(context.terminologyHint)}`;
}

const AUDIO_TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const AUDIO_META_PATTERN = /\b(startMs|endMs)\s*=\s*\d+\b/gi;
const AUDIO_SEGMENT_PATTERN = /片段\s*\d+/g;

export function sanitizeAudioOverviewNarration(text: string): string {
  return text
    .replace(AUDIO_META_PATTERN, ' ')
    .replace(AUDIO_SEGMENT_PATTERN, ' ')
    .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g, ' ')
    .replace(AUDIO_TIMESTAMP_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAudioOverviewNarrationCorpus(transcript: TranscriptSegment[], maxChars = 12_000): string {
  const promptContext = buildPromptTranscriptContext(transcript, {
    maxChars: Math.max(12_000, maxChars * 2),
    includeIndex: false,
    includeTimestamp: false,
    minCharsPerSegment: 56,
  });
  const merged = promptContext.text
    .split('\n')
    .map((line) => sanitizeAudioOverviewNarration(line))
    .filter(Boolean)
    .join('\n');
  if (merged.length <= maxChars) return merged;
  return `${merged.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function buildAudioOverviewChapterEvidence(transcript: TranscriptSegment[]): string {
  return buildPromptTranscriptContext(transcript, {
    maxChars: 8_000,
    includeIndex: true,
    includeTimestamp: true,
    minCharsPerSegment: 56,
  }).text;
}

export function buildAudioOverviewSystemPrompt(): string {
  return '你是一位严谨的中文教育音频总编导。把一节课重构成自然的双人理解型音频：围绕因果链、概念边界或方法逻辑推进，不朗读课堂摘要，不为热闹强行玩梗。只使用课堂证据，只输出 JSON。';
}

export function buildAudioOverviewUserPrompt(context: AudioOverviewPromptContext): string {
  return `输出 JSON：
{
  "title": "播客标题",
  "opening": "直接进入主题的开场",
  "keyTakeaways": ["听完应带走的理解"],
  "learnerProfile": "这次音频服务的学习目标",
  "structure": [{ "title": "章节标题", "focus": "本章推进什么理解", "startMs": 0, "endMs": 60000 }],
  "tone": "与学科匹配的节奏说明",
  "script": [{ "speaker": "Host A", "text": "台词" }, { "speaker": "Host B", "text": "台词" }]
}

应用目标：${sanitizeAudioOverviewNarration(context.goalIntent || '用走路或通勤时间重新理解这节课')}

教育价值合同：
- 音频不是逐段摘要；先找出支撑全课的因果链、概念对比或方法逻辑，再围绕它推进
- 类比只有在准确且确实降低理解门槛时使用，并同时交代类比失效的边界
- 保留课堂中的条件、不确定性和相互竞争的观点，不把复杂结论说成口号
- 双人对话每一轮都要完成提问、澄清、例子、反例或综合中的一个动作；禁止假寒暄、空夸奖和轮流念要点
- script.text 使用自然简体中文，只允许 Host A / Host B；不得出现时间戳、片段号、startMs/endMs 或制作说明
- 内容不足时宁可做更短的音频；通常控制在 6-10 分钟、约 900-1500 个汉字，不为凑时长重复
- structure 由内容决定 2-6 章，覆盖主要推进；startMs/endMs 只能从下方“章节定位证据”中选择，不能从无时间的朗读语料猜测

可朗读课堂语料（只用于脚本内容，不含定位信息）：
${context.narrationCorpus}

章节定位证据（只用于 structure 的毫秒时间，不得读进 script）：
${context.chapterEvidenceContext}

${context.anchorContext ? `学习者关注点：\n${context.anchorContext}\n` : ''}${buildTerminologyHintBlock(context.terminologyHint)}`;
}
