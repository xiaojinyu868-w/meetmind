// Real caller —— 用真模型跑测验 / 闪卡草稿（与生产同一份 prompt 与上下文组装）。
//
// 走的是插件导出的 generateQuizDraft / generateFlashcardsDraft：system prompt 是 buildQuizSystemPrompt /
// buildFlashcardsSystemPrompt 基线（不带管理员追加），模型是 DEFAULT_WORKSHOP_MODEL_ID（env 驱动）。
// 返回模型原文，runner 负责走生产后处理与 grader；--record 时原文被冻结进 dataset。
import type { AppExecutionContext } from '@/lib/ai-native/types';
import { buildFlashcardsSystemPrompt, buildQuizSystemPrompt } from '@/lib/ai-native/app-prompts';
import { generateQuizDraft } from '@/lib/ai-native/plugins/quiz.plugin';
import { generateFlashcardsDraft } from '@/lib/ai-native/plugins/flashcards.plugin';
import { DEFAULT_WORKSHOP_MODEL_ID } from '@/lib/services/llm-service';
import type { AppsCase } from './runner';

export async function realAppsCaller(c: AppsCase, context: AppExecutionContext): Promise<{ raw: string }> {
  const model = process.env.APPS_EVAL_MODEL?.trim() || context.model || DEFAULT_WORKSHOP_MODEL_ID;
  if (c.app === 'quiz') {
    const { raw } = await generateQuizDraft(context, model, buildQuizSystemPrompt());
    return { raw };
  }
  const { raw } = await generateFlashcardsDraft(context, model, buildFlashcardsSystemPrompt());
  return { raw };
}
