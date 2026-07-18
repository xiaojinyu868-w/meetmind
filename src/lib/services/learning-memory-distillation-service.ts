import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import { buildLearningMemoryUserPrompt } from '@/lib/prompts/learning-understanding-prompts';
import { buildControlledLearningMemoryPrompt } from '@/lib/services/ai-control-service';
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

export { buildLearningMemoryDistillationPrompt } from '@/lib/prompts/learning-understanding-prompts';

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
    const controlled = await buildControlledLearningMemoryPrompt();
    const response = await chat(
      [
        { role: 'system', content: controlled.systemPrompt },
        {
          role: 'user',
          content: buildLearningMemoryUserPrompt({ userText, assistantText, existingMemories }),
        },
      ],
      controlled.modelId,
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
