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

    const systemPrompt = `你是一名"AI 同桌"，正坐在学生旁边听课。你擅长基于老师刚讲的内容，提前半步感知接下来可能出现的知识点、容易混淆的概念、或老师可能抛出的问题。

你的任务：读最近这段课堂转录，悄悄生成 0-2 条"预感"小卡片。

核心原则：
- **宁缺毋滥**。没有把握 → 返回空数组 []。你不是在闲聊。
- **只做真正有前瞻性的预判**，不要复读老师刚说过的内容。合格的预感形如：
  · "接下来可能会讲到 X"
  · "这里容易和 Y 混淆"
  · "老师可能问 Z"
  · "这个结论的常见反例是 W"
- **label 是短标签**（2-6 字），常用：接下来、容易混、可能问、注意点、常见坑、联系到
- **text 是一句话**（≤40 字），直白、口语、像同桌小声提醒，**不要带 Markdown / 时间戳 / 引号**
- 不要客套话（"我觉得"、"或许"开头一律砍掉）
- 不要跟老师抢话。老师正在讲的内容不要当作预感。

输出 JSON：
{"foresights":[{"label":"接下来","text":"接下来多半会把这个结论推广到三维情形"}]}

没有合格预感时：
{"foresights":[]}

仅输出 JSON，不要解释。`;

    const userMsg = `${titleBlock}${priorBlock}\n\n最近课堂转录（你需要在它之后做预感）：\n${trimmed}`;

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
