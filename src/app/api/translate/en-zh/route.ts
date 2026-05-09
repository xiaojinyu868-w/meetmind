// POST /api/translate/en-zh — 英文片段批量翻译为中文（M7.9）
//
// 输入：{ terms: string[] } 英文片段数组
// 输出：{ translations: Record<string, string> } 原文 → 中译
//
// 性质：
//   - 幂等：同样输入给同样输出（UI 可缓存）
//   - 批量：一次 POST 翻多个，减少 API 调用
//   - 降级：LLM 失败时返回空映射，UI 静默隐藏翻译气泡，不报错
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('api-translate-en-zh');

const BodySchema = z.object({
  terms: z.array(z.string().min(1).max(300)).min(1).max(30),
});

const SYSTEM_PROMPT = `你是课堂转写的英译中助手。输入是一组英文片段（术语/短句），
请给出简洁的中文翻译。规则：
1. 只翻译，不解释、不加例句；输出越短越好。
2. 专有名词、人名、品牌名保留原文或用通行译法（如 PyTorch 不翻译、neural network → 神经网络）。
3. 保留原文大小写敏感的代号（如 iOS、DNA）。
4. 若某片段本身就是中文/数字/符号，保持原样返回。
5. 严格返回 JSON 对象：{ "原文1": "译文1", "原文2": "译文2", ... }，不要任何其他文字。`;

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'translate');
  if (rl) return rl;

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

    const model = process.env.TRANSLATION_MODEL || 'qwen3.5-plus';
    const resp = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      model,
      { temperature: 0, responseFormat: 'json_object', maxTokens: 600 },
    );

    let translations: Record<string, string> = {};
    try {
      const parsed2 = JSON.parse(resp.content);
      if (parsed2 && typeof parsed2 === 'object' && !Array.isArray(parsed2)) {
        // 保留 string → string 映射
        for (const [k, v] of Object.entries(parsed2)) {
          if (typeof v === 'string' && v.trim()) {
            translations[k] = v.trim();
          }
        }
      }
    } catch (err) {
      log.warn('translation JSON parse failed', { err: (err as Error).message });
    }

    return NextResponse.json({ translations });
  } catch (err) {
    log.error('translate failed', { err: (err as Error).message });
    // 降级：前端拿到空 map，UI 继续不崩
    return NextResponse.json({ translations: {} });
  }
}
