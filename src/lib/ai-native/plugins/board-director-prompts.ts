/**
 * Board Director（导演 pass）Prompt —— 第二次 LLM 调用，只做节奏设计。
 *
 * 范式依据（docs/BOARD_TUTOR_ARCHITECTURE.md）：AmIWrite（CHI 2026，LLM 标注 +
 * 确定性回放同构系统）、SSML 韵律标注（MOS 3.20→3.87）、VideoDirectorGPT、
 * Self-Refine。分工（Bitter Lesson 校准）：模型只产出**语义锚点**
 * （cue 字位 / 段后呼吸 breathMs），毫秒对时仍由播放器字级时间戳完成。
 */

export interface DirectorSegmentInput {
  index: number;
  /** 展示文本（剥 cue 后） */
  display: string;
  /** 动作清单（下标 + 简述） */
  actions: Array<{ index: number; kind: string; summary: string }>;
  /** 编剧已给的 cue（导演可改可留） */
  existingCues: Array<{ actionIndex: number; charIndex: number }>;
}

export function buildDirectorSystemPrompt(): string {
  return `你是一位讲课节奏导演。编剧已经写好了黑板课的讲稿和板书动作，你的唯一职责是节奏设计——让每一个板书动作落在最自然的那个词上，让该停的地方停一拍。不要改动任何讲稿文字和动作内容。

【输入】一页板书课：若干 segment，每个 segment 有讲稿 display（学生听到的口语）和 actions（板书动作，带下标）。

【输出】只输出一个 JSON 对象（不要 markdown 代码围栏，紧凑无缩进）：
{"segments":[{"segment":0,"cues":[{"actionIndex":1,"charIndex":23}],"breathMs":800}]}

【cue 规则】（charIndex = display 文本里的字符下标，从 0 开始，空格也算）
1. 每个动作都必须给一个 cue——嘴上开始讲它，笔开始落（嘴手一体，书写与讲解共现）：
   - write（写字/公式/步骤）：锚在开始讲述这个内容的那个词之后（"我们来看这个公式"的"公式"）——说到它，笔开始写它；
   - circle/underline（圈/下划线）：锚在说"注意""关键""这里"这类指涉词处；
   - arrow/mark（箭头/勾叉）：锚在指代它的话处（"所以""这就对了"）；
   - pause：锚在希望学生消化一下的位置。
2. 讲稿里找不到对应内容时，锚在语义最接近的词上，宁晚勿早——写早了是"一个人在讲、另一个人在写"，写晚了只是老师说完补完最后一笔。
3. 每个动作只给一个 cue；不同动作的 charIndex 可以相同（同时落笔）。

【breathMs 规则】（本段讲完后老师的停顿，毫秒；不给 = 默认 400）
- 关键结论、揭晓答案、易错点强调之后：800-1500（让学生看一眼黑板消化）；
- 普通过渡：不给或 400；
- 马上要提问/做 checkpoint 的段：200-400（节奏紧凑）；
- 上限 2500，整页最多两段超过 800（停顿多了课就散了）。`;
}

export function buildDirectorUserPrompt(page: DirectorSegmentInput[]): string {
  const sections = page.map((segment) => {
    const actions = segment.actions
      .map((action) => `  [${action.index}] ${action.kind}: ${action.summary}`)
      .join('\n');
    const cues =
      segment.existingCues.length > 0
        ? `\n  编剧已给的 cue：${segment.existingCues.map((c) => `a${c.actionIndex}@${c.charIndex}`).join(', ')}（可保留可调整）`
        : '';
    return `segment ${segment.index}（display 共 ${segment.display.length} 字）：\n"""${segment.display}"""\n动作：\n${actions}${cues}`;
  });
  return ['这一页的讲稿与动作如下，请给出每个动作的 cue 和每段的 breathMs：', ...sections].join('\n\n');
}
