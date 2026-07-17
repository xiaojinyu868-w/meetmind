import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import type { LearningMemoryKind } from '@/types/user';

const log = createLogger('learning-memory-distillation');
const MEMORY_KINDS = new Set<LearningMemoryKind>([
  'preference',
  'strength',
  'challenge',
  'topic',
  'progress',
]);

export interface ExistingLearningMemory {
  id: string;
  kind: LearningMemoryKind;
  title: string;
  detail?: string;
}

export interface DistilledLearningMemory {
  kind: LearningMemoryKind;
  title: string;
  detail?: string;
  replaceId?: string;
}

export interface DistillLearningMemoryInput {
  userText: string;
  assistantText: string;
  existingMemories?: ExistingLearningMemory[];
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1))}…`;
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

export function sanitizeDistilledLearningMemories(
  raw: unknown,
  existingMemories: ExistingLearningMemory[] = [],
): DistilledLearningMemory[] {
  if (!raw || typeof raw !== 'object') return [];
  const memories = (raw as Record<string, unknown>).memories;
  if (!Array.isArray(memories)) return [];
  const validReplaceIds = new Set(existingMemories.map((memory) => memory.id));
  const seen = new Set<string>();

  return memories.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const kind = value.kind as LearningMemoryKind;
    const title = compact(value.title, 80);
    if (!MEMORY_KINDS.has(kind) || title.length < 4) return [];
    const signature = `${kind}:${title.toLocaleLowerCase()}`;
    if (seen.has(signature)) return [];
    seen.add(signature);
    const detail = compact(value.detail, 240);
    const replaceId = compact(value.replaceId, 120);
    return [{
      kind,
      title,
      ...(detail ? { detail } : {}),
      ...(replaceId && validReplaceIds.has(replaceId) ? { replaceId } : {}),
    }];
  }).slice(0, 2);
}

export async function distillLearningMemories(
  input: DistillLearningMemoryInput,
): Promise<DistilledLearningMemory[]> {
  const userText = compact(input.userText, 3_000);
  const assistantText = compact(input.assistantText, 8_000);
  const existingMemories = (input.existingMemories || []).slice(-12).map((memory) => ({
    id: compact(memory.id, 120),
    kind: memory.kind,
    title: compact(memory.title, 80),
    detail: compact(memory.detail, 240) || undefined,
  }));
  if (!userText || !assistantText) return [];

  try {
    const response = await chat(
      [
        { role: 'system', content: buildLearningMemoryDistillationPrompt() },
        {
          role: 'user',
          content: `已有学习理解：\n${existingMemories.length > 0 ? JSON.stringify(existingMemories) : '[]'}\n\n学习者这一轮说：\n${userText}\n\n助手随后回答：\n${assistantText}`,
        },
      ],
      undefined,
      { temperature: 0.1, maxTokens: 500, responseFormat: 'json_object' },
    );
    return sanitizeDistilledLearningMemories(JSON.parse(response.content), existingMemories);
  } catch (error) {
    log.warn('memory distillation skipped', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return [];
  }
}
