/**
 * 转录增强 API 路由
 * 
 * POST /api/transcript-enhance
 * 使用 LLM 对 ASR 转录结果进行后处理优化
 */

import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { TranscriptSegment } from '@/types';
import { applyRateLimit } from '@/lib/utils/rate-limit';

// 优化状态
type EnhanceStatus = 'pending' | 'enhancing' | 'enhanced' | 'failed';

// 带优化状态的转录片段
interface EnhancedTranscriptSegment extends TranscriptSegment {
  originalText?: string;
  enhanceStatus: EnhanceStatus;
  enhancedAt?: string;
}

// 请求体
interface EnhanceRequestBody {
  segments: TranscriptSegment[];
  model?: string;
  isFinal?: boolean;
}

/**
 * 转录增强 Prompt
 * 
 * 设计原则：
 * 1. 结果导向 + 规则导向结合
 * 2. 控制 Prompt 长度
 * 3. 输出格式严格约束
 */
const ENHANCE_SYSTEM_PROMPT = `你是一位课堂转录优化助手。你的任务是将语音识别的原始文本优化为流畅易读的书面文本。`;

const ENHANCE_USER_PROMPT = `【任务】优化以下 ASR 转录文本

【规则】
- 删除语气词（嗯、啊、那个、就是、然后等）
- 去除重复（我我我 → 我）
- 纠正同音字错误
- 保持原意和专业术语

【输出】严格按 JSON 数组格式返回，每项包含 id 和优化后的 text
示例：[{"id":"seg-1","text":"优化后的文本"}]

【输入】
`;

/**
 * 解析 LLM 输出
 */
function parseEnhanceOutput(output: string): Map<string, string> {
  const result = new Map<string, string>();
  
  try {
    // 尝试直接解析 JSON
    const parsed = JSON.parse(output.trim());
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.id && item.text) {
          result.set(item.id, item.text);
        }
      }
      return result;
    }
  } catch {
    // JSON 解析失败
  }
  
  // 尝试提取 JSON 块
  const jsonMatch = output.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.id && item.text) {
            result.set(item.id, item.text);
          }
        }
      }
    } catch {
      console.error('[TranscriptEnhance API] Failed to parse JSON block');
    }
  }
  
  return result;
}

export async function POST(request: NextRequest) {
  // 应用速率限制
  const rateLimitResponse = await applyRateLimit(request, 'transcript-enhance');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body: EnhanceRequestBody = await request.json();
    const { segments, model = 'qwen3-max', isFinal = false } = body;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: '缺少 segments 参数' },
        { status: 400 }
      );
    }

    console.log(`[TranscriptEnhance API] Enhancing ${segments.length} segments with ${model}`);

    // 构建输入文本
    const inputItems = segments.map(seg => ({
      id: seg.id,
      text: seg.text,
    }));
    const inputText = JSON.stringify(inputItems, null, 0);
    const fullPrompt = ENHANCE_USER_PROMPT + inputText;

    // 调用 LLM
    const response = await chat(
      [
        { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
        { role: 'user', content: fullPrompt },
      ],
      model,
      { 
        temperature: 0.3,  // 低温度，保持稳定输出
        maxTokens: 2000,
      }
    );

    // 解析输出
    const enhancedTexts = parseEnhanceOutput(response.content);
    
    // 构建返回结果
    const enhancedSegments: EnhancedTranscriptSegment[] = segments.map(seg => {
      const enhancedText = enhancedTexts.get(seg.id);
      
      if (enhancedText && enhancedText !== seg.text) {
        return {
          ...seg,
          originalText: seg.text,
          text: enhancedText,
          enhanceStatus: 'enhanced' as EnhanceStatus,
          enhancedAt: new Date().toISOString(),
        };
      }
      
      // 未被优化（可能是解析失败或文本已足够好）
      return {
        ...seg,
        enhanceStatus: enhancedText ? 'enhanced' : 'pending' as EnhanceStatus,
      };
    });

    const enhancedCount = enhancedSegments.filter(s => s.enhanceStatus === 'enhanced').length;
    console.log(`[TranscriptEnhance API] Enhanced ${enhancedCount}/${segments.length} segments`);

    return NextResponse.json({
      success: true,
      segments: enhancedSegments,
      stats: {
        total: segments.length,
        enhanced: enhancedCount,
        model: response.model,
        usage: response.usage,
      },
    });

  } catch (error) {
    console.error('[TranscriptEnhance API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : '优化失败';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
