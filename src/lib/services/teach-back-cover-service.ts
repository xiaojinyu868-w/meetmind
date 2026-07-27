/**
 * teach-back cover-check —— 讲课过程中的轻量覆盖检测
 *
 * 像素教室黑板上的粉笔目标，讲到哪划掉哪：
 * 每积累一段新讲述就轻量问一次模型「这些目标里哪些已经被讲到了」，
 * 门槛刻意低于课后正式核对（covered ≠ 讲对，只是「讲到了」），
 * 正式的对错判断仍由 /api/apps/teach-back/evaluate 在讲完后做。
 */

import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { createLogger } from '@/lib/logger';

const log = createLogger('teach-back-cover');

export interface TeachBackCoverCheckInput {
  targets: TeachBackTarget[];
  teachingTurns: TeachBackTurn[];
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

export async function checkTeachBackCoverage(input: TeachBackCoverCheckInput): Promise<string[]> {
  const targets = input.targets.slice(0, 8);
  const teachingText = input.teachingTurns
    .filter((turn) => turn.role === 'user')
    .map((turn) => compact(turn.text, 400))
    .filter(Boolean)
    .join('\n')
    .slice(0, 4_000);
  if (targets.length === 0 || !teachingText) return [];

  const targetLines = targets.map((target) => `- ${target.id}: ${target.point}`).join('\n');
  try {
    const response = await chat(
      [
        {
          role: 'system',
          content: '你在旁听一个学生讲课。给你一份「他应该讲到的点」的清单，和他目前已经讲的内容。' +
            '判断清单里的哪些点他已经讲到了——门槛放宽：只要围绕那个点展开讲过就算讲到，不要求讲得对、讲得全。' +
            '没讲到的不要猜。只输出 JSON：{"covered": ["target-1", ...]}，id 原样复用输入的 id，一个都没有就返回空数组。',
        },
        {
          role: 'user',
          content: `目标清单：\n${targetLines}\n\n他已经讲的：\n${teachingText}`,
        },
      ],
      ModelDefaults.workshop,
      { temperature: 0.1, maxTokens: 150, responseFormat: 'json_object' },
    );
    const parsed = parseJsonResponse<{ covered?: unknown }>(response.content);
    if (!parsed || !Array.isArray(parsed.covered)) return [];
    const validIds = new Set(targets.map((target) => target.id));
    return parsed.covered
      .filter((id): id is string => typeof id === 'string' && validIds.has(id))
      .slice(0, targets.length);
  } catch (error) {
    log.warn('cover check skipped', {
      message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return [];
  }
}
