import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('classroom/foresight');

/**
 * /api/classroom/foresight — 预知气泡生成
 *
 * 定位：AI 同桌的「主动性」触点。
 *
 * 核心理念（对齐产品 Taste）：
 *   - 不是"AI 先开口"（那是打扰），
 *   - 而是"AI 主动到达用户可能转身的位置"。
 *   用户录着课，AI 基于最近转录悄悄预判"接下来这里可能会讲 X / 可能会考 Y /
 *   这个概念和前面哪个容易混"，结果以"预知气泡"形式放在消息流侧边。
 *   用户不看就当不存在，用户一瞥到觉得有用就点一下顺着问下去。
 *
 * 模型：qwen3.5-plus —— 追求低延迟，不开 thinking。
 *
 * 入参：
 *   recentText：最近一段转录（拼好的字符串，通常 300-800 字）
 *   lessonTitle?：可选，课程标题，帮助 AI 建立场景上下文
 *   priorLabels?：可选，已经生成过的预知 label 列表，避免重复
 *
 * 出参：
 *   { foresights: [{ id, label, text }, ...] }   0-2 条
 *   —— 故意少：宁可不生成，也不给噪音。
 *
 * 约束：
 *   - label 2-6 字，text ≤ 40 字
 *   - 不要时间戳、不要 Markdown 语法（会直接进轻量气泡渲染）
 *   - 没有高置信度的预判就返回空数组
 */

interface Foresight {
  id: string;
  label: string;
  text: string;
}

interface RequestBody {
  recentText?: string;
  lessonTitle?: string;
  priorLabels?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { recentText, lessonTitle, priorLabels } = body;

    if (!recentText || recentText.trim().length < 40) {
      // 转录还没够——这是常态，不要报错，静默返回空
      return NextResponse.json({ foresights: [] });
    }

    const trimmed = recentText.trim().slice(-1200);
    const priorBlock =
      priorLabels && priorLabels.length > 0
        ? `\n已经给过以下预感，不要重复：${priorLabels.slice(-6).join('、')}`
        : '';
    const titleBlock = lessonTitle ? `\n当前课程：${lessonTitle}` : '';

    const systemPrompt = `你是这个学生的同桌，和他一起坐在教室里。你们刚刚一起听老师讲到这里——

${titleBlock ? titleBlock.trim() + '\n\n' : ''}你手里有老师最近一段话的转录。你有一个本事：比他提前半步，看出来"诶，接下来老师可能要引出 X 了"、或者"这里和之前讲过的 Y 很容易混"。你想小声在他耳边提醒一下，但又不想打扰他听课——所以你只在真的有把握的时候开口，平时宁可不出声。

你开口的那句话是"预感"，不是"总结"：
- 合格的预感像这样："接下来多半会推广到三维"、"这里和极限定义容易搞混"、"这一步常见的反例是 W"
- 不合格的：把老师刚说的话换个说法再复读一遍、"我觉得老师讲得很清楚"这种废话、"或许"、"大概"这种虚的开头

你一次最多说两句。没有真的值得提醒的就保持安静。

${priorBlock ? priorBlock.trim() + '\n\n' : ''}技术要求（前端会按 JSON 字段渲染，所以这部分是硬的）：
- 输出 JSON：{"foresights":[{"label":"...","text":"..."}]}，最多 2 条，没内容就返回 {"foresights":[]}
- label 是一个短标签（2-6 字），例如：接下来 / 容易混 / 可能问 / 注意点 / 常见坑 / 联系到
- text 是那句小声提醒本身，一句话说完，不要带 Markdown、不要带时间戳、不要加引号

仅输出 JSON，不要多说一个字。`;

    const userMsg = `最近这段课堂转录（你要在它之后做预感）：\n${trimmed}`;

    try {
      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        'qwen3.5-plus',
        { temperature: 0.7, maxTokens: 240, responseFormat: 'json_object' },
      );

      const parsed = JSON.parse(response.content);
      const rawList: Array<Partial<Foresight>> = Array.isArray(parsed)
        ? parsed
        : parsed.foresights ?? parsed.items ?? [];

      const nowStamp = Date.now();
      const foresights: Foresight[] = rawList
        .filter((f) => typeof f?.label === 'string' && typeof f?.text === 'string')
        .map((f, i) => ({
          id: `fs-${nowStamp}-${i}`,
          label: String(f.label).trim().slice(0, 8),
          // 40 字兜底 + 去换行 + 去首尾标点空白
          text: String(f.text).replace(/\s+/g, ' ').trim().slice(0, 50),
        }))
        .filter((f) => f.label.length > 0 && f.text.length > 0)
        .slice(0, 2);

      return NextResponse.json({ foresights });
    } catch (llmError) {
      log.warn('[foresight] LLM error, returning empty', llmError);
      // 失败也返回空，而不是 500——预知气泡失败不能影响主流程
      return NextResponse.json({ foresights: [] });
    }
  } catch (error) {
    log.error('[foresight] Request error:', error);
    return NextResponse.json({ foresights: [] }, { status: 200 });
  }
}
