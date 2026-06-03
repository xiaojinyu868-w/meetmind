// POST /api/translate/zh-en — 中文片段批量翻译为英文
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { chat } from '@/lib/services/llm-service';
import { buildTranslateRateLimitedPayload } from '@/lib/utils/translate-rate-limit-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('api-translate-zh-en');

const BodySchema = z.object({
  terms: z.array(z.string().min(1).max(300)).min(1).max(30),
});

const SYSTEM_PROMPT = `你是课堂转写的中译英助手。输入是一组中文片段（术语/短句），
请给出自然、简洁的英文翻译。规则：
1. 只翻译，不解释、不加例句。
2. 专有名词、品牌名可保留原文或用通行英文写法。
3. 若某片段本身就是英文/数字/符号，保持原样返回。
4. 严格返回 JSON 对象：{ "原文1": "translation 1", "原文2": "translation 2" }，不要任何其他文字。`;

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'translate');
  if (rl) {
    return NextResponse.json(buildTranslateRateLimitedPayload(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'bad request', detail: parsed.error.message },
        { status: 400 },
      );
    }

    const { terms } = parsed.data;
    const userPrompt = `请翻译下列 ${terms.length} 个片段：\n${JSON.stringify(terms)}`;
    const model = process.env.TRANSLATION_MODEL || 'qwen3.7-plus';
    const resp = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      model,
      { temperature: 0, responseFormat: 'json_object', maxTokens: 600 },
    );

    const translations: Record<string, string> = {};
    try {
      const parsed2 = JSON.parse(resp.content);
      if (parsed2 && typeof parsed2 === 'object' && !Array.isArray(parsed2)) {
        for (const [k, v] of Object.entries(parsed2)) {
          if (typeof v === 'string' && v.trim()) translations[k] = v.trim();
        }
      }
    } catch (err) {
      log.warn('translation JSON parse failed', { err: (err as Error).message });
    }

    return NextResponse.json({ translations });
  } catch (err) {
    log.error('translate failed', { err: (err as Error).message });
    return NextResponse.json({ translations: {} });
  }
}
