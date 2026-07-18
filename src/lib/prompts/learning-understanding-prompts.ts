export const LEARNING_INTENT_PROMPT_VERSION = 'learning-intent-v2';
export const LEARNING_MEMORY_PROMPT_VERSION = 'learning-memory-v1';

export interface LearningIntentPromptInput {
  query: string;
  learnerContext?: string;
  recentContext?: string;
  activeContext?: string;
  answered?: string[];
}

export interface LearningMemoryPromptInput {
  userText: string;
  assistantText: string;
  existingMemories?: unknown[];
}

export function buildLearningIntentSystemPrompt(isFinalizing: boolean): string {
  return `你负责在一次深度学习会话开始前，理解学生这一次真正想完成什么。用户当前这句话定义目标边界；个人、近期和当前页面上下文只帮助理解与个性化，不能替用户把宽泛愿望静默收窄成历史里的具体目标，也不能擅自扩大目标。

当用户明确说“继续”“上次”“那篇”“这个”等指向已有上下文时，可以用上下文补全所指。除此之外，如果上下文提供了多个合理方向而用户尚未选择，把这些方向变成一个真正影响学习路径的选择题，不要替他选。

输出 JSON：
{
  "title": "一句自然的会话标题",
  "outcome": "这次结束时学生应该能做到什么",
  "approach": "understand|practice|synthesize|create",
  "contextFocus": "personal|current|mixed",
  "checkpoints": ["最多三个自然检查点"],
  "confidence": "high|medium|low",
  "questions": [{
    "id": "稳定的英文短 id",
    "prompt": "一个真正影响学习路径、像同学自然问出口的短问题",
    "kind": "single|multiple",
    "options": [{ "id": "稳定的英文短 id", "label": "自然、具体的选项" }]
  }]
}

规则：
- checkpoints 是模型接下来会做的事，不是给用户的任务清单。
- 能从用户当前表达或其明确指向的上下文判断的内容直接判断，不要再问。
- confidence 仅供内部判断，不会展示给用户；只要没有必须由用户决定的歧义，就直接开始，并让教学过程自适应校准。
- 只有答案会明显改变讲解深度、练习方式或最终产物时，才生成 questions；默认只问信息量最高的一题。
- questions 通常最多 1 个；只有两个问题彼此独立、无法合并且都足以改变路径时才允许 2 个。每题 2-4 个选项；优先单选，确实可并存才用多选。
- 问题直接问本身，尽量不超过 22 个汉字；不要写“为了给你匹配 / 为了更好地帮助 / 请告诉我”之类的系统解释。
- 选项是用户一眼能扫完的具体方向，中文通常 4-14 字；不要在选项里塞括号、举例和第二层说明。
- 不要为了确认学习风格、年级、基础或目标是否“足够具体”而提问；能先用一个小解释或小练习动态判断，就直接开始。
- 不询问年级、身份等已经存在于个人上下文的信息。
${isFinalizing ? '- 用户已经回答过问题：吸收答案并返回最终计划，questions 必须为空数组。' : '- 意图已足够清楚时，questions 返回空数组。'}
仅输出 JSON。`;
}

export function buildLearningMemoryDistillationPrompt(): string {
  return `你在一次学习对话结束后，静默维护 MeetMind 对学习者的理解。你不是总结对话，而是判断：学习者在这一轮亲自说出或表现出的内容，是否足以形成一条以后仍有帮助的学习理解。

只允许记录：
- preference：用户明确表达、且与学习方式有关的偏好
- strength：用户通过自己的解释、作答或作品表现出的能力
- challenge：用户的回答暴露出的具体理解困难或反复混淆
- topic：用户明确正在持续关注的学习主题
- progress：相对已有理解，这一轮已经学会、厘清或完成的进展

严格边界：
- 证据必须来自用户自己的表达或作答；不能把助手讲过的知识当成用户已经掌握
- 不记录愿望、计划、下一步建议、人格判断、身份、情绪、健康或其他敏感信息
- 一次偶然措辞不足以推断稳定偏好；证据不足就返回空数组
- title 用自然中文描述用户，不要写“用户表示”“本轮对话”或课程总结
- 最多两条；宁缺毋滥
- existingMemories 中已有同义理解时，用 replaceId 更新它，不要新增近义重复
- 只能使用 existingMemories 里真实存在的 id 作为 replaceId

只输出 JSON：
{"memories":[{"kind":"progress","title":"已经能区分相关关系与因果关系","detail":"能指出共同原因如何同时影响两个变量","replaceId":"可选的既有记忆 id"}]}`;
}

export function buildLearningIntentUserPrompt(input: LearningIntentPromptInput): string {
  const context = [
    input.learnerContext ? `长期个人上下文：\n${input.learnerContext}` : '',
    input.recentContext ? `最近学习现场：\n${input.recentContext}` : '',
    input.activeContext ? `当前页面上下文：\n${input.activeContext}` : '',
  ].filter(Boolean).join('\n\n');
  const answered = input.answered?.filter(Boolean) ?? [];
  return `${context ? `${context}\n\n` : ''}用户这次说：\n${input.query}${answered.length > 0 ? `\n\n用户对关键问题的选择：\n${answered.join('\n')}` : ''}`;
}

export function buildLearningMemoryUserPrompt(input: LearningMemoryPromptInput): string {
  return `已有学习理解：\n${input.existingMemories?.length ? JSON.stringify(input.existingMemories) : '[]'}\n\n学习者这一轮说：\n${input.userText}\n\n助手随后回答：\n${input.assistantText}`;
}
