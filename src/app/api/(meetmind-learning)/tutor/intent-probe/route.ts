import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('tutor/intent-probe');


/**
 * 意图探测 API v2 —— 仅做二级裂变
 * 
 * 一级意图由前端规则生成（零延迟），
 * 用户点击某个一级意图后，调用此 API 生成 2-3 个精准子方向。
 * 
 * 入参：intentLabel（一级意图标签）、transcriptText（内容片段）
 * 出参：2-3 个 subDirections，每个包含 label + prompt
 */

interface SubDirection {
  label: string;   // 短标签，2-6 字
  prompt: string;  // 完整追问句
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { intentLabel, intentEmoji, transcriptText, summaryText } = body;

    if (!intentLabel || !transcriptText) {
      return NextResponse.json(
        { error: 'intentLabel and transcriptText are required' },
        { status: 400 }
      );
    }

    const trimmed = transcriptText.trim().slice(0, 600);

    const systemPrompt = `你是意图裂变助手。用户已选择一个意图方向"${intentEmoji || ''}${intentLabel}"，现在你要根据内容片段，生成 2-3 个更具体的探索子方向。

规则：
- 每个子方向的 label 简短（2-6字），prompt 是完整自然的追问句
- 子方向要彼此不重复，覆盖不同角度
- prompt 要具体、可直接发给 AI 对话，不要泛泛而谈
- 语气自然，像真人说话

返回 JSON 数组：
[{"label":"标签","prompt":"追问句"},...]

仅输出 JSON 数组，无其他文字。`;

    const userMsg = summaryText
      ? `内容片段：\n${trimmed}\n\n摘要：${summaryText}`
      : `内容片段：\n${trimmed}`;

    try {
      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        'qwen3.5-plus',
        { temperature: 0.7, maxTokens: 300, responseFormat: 'json_object' }
      );

      const parsed = JSON.parse(response.content);
      
      // 兼容数组或 { directions: [...] } 格式
      const directions: SubDirection[] = Array.isArray(parsed)
        ? parsed
        : (parsed.directions || parsed.subDirections || []);

      const valid = directions
        .filter((d: SubDirection) => d.label && d.prompt)
        .slice(0, 3);

      if (valid.length > 0) {
        return NextResponse.json({ directions: valid });
      }

      // AI 输出格式异常，返回默认
      return NextResponse.json({
        directions: buildFallbackDirections(intentLabel),
      });
    } catch (llmError) {
      log.error('[intent-probe] LLM error:', llmError);
      return NextResponse.json({
        directions: buildFallbackDirections(intentLabel),
      });
    }
  } catch (error) {
    log.error('[intent-probe] Request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// 规则 fallback：根据意图标签生成默认子方向
function buildFallbackDirections(intentLabel: string): SubDirection[] {
  const map: Record<string, SubDirection[]> = {
    '理解内容': [
      { label: '核心要点', prompt: '帮我梳理这段内容的核心要点' },
      { label: '简单解释', prompt: '用通俗的方式解释一下这段内容' },
    ],
    '深入探讨': [
      { label: '为什么', prompt: '深入分析一下背后的原因和逻辑' },
      { label: '不同观点', prompt: '有没有不同的视角或反面观点？' },
    ],
    '总结应用': [
      { label: '生成笔记', prompt: '帮我生成一份结构化笔记' },
      { label: '行动建议', prompt: '基于这段内容，我可以怎么做？' },
    ],
    '答疑解惑': [
      { label: '难点在哪', prompt: '这段内容中有哪些容易搞混的地方？' },
      { label: '举个例子', prompt: '能举个具体的例子帮我理解吗？' },
    ],
  };

  return map[intentLabel] || [
    { label: '展开讲讲', prompt: `关于"${intentLabel}"这个方向，帮我展开分析一下` },
    { label: '具体建议', prompt: `关于"${intentLabel}"，有什么具体可操作的建议？` },
  ];
}
