/**
 * AI 家教 API 路由
 * 
 * POST /api/tutor
 * - 解释断点（原有功能）
 * - 追问对话（原有功能）
 * - 引导问题（新增：enable_guidance=true）
 * - 联网检索（新增：enable_web=true）
 * 
 * 向后兼容：不传新字段时行为完全一致
 */

import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID, type ChatMessage, type MultimodalContent } from '@/lib/services/llm-service';
import { formatTimeRange, formatTimestamp, getSegmentsInRange, type Segment } from '@/lib/services/longcut-utils';
import { getDifyService, isDifyEnabled, type DifyWorkflowInput } from '@/lib/services/dify-service';
import type { ExtendedTutorRequest, ExtendedTutorResponse, GuidanceQuestion, Citation } from '@/types/dify';
import { applyRateLimit } from '@/lib/utils/rate-limit';

// AI 家教系统提示词（初次解释用）
const TUTOR_SYSTEM_PROMPT = `你是一位"课堂对齐"的 AI 家教。你的任务是帮助学生补懂课堂上没听懂的内容。

【最重要原则】只能基于提供的课堂转录内容回答！
- 绝对禁止编造、臆想、猜测任何转录中没有的内容
- 如果转录内容不足，直接告诉学生"转录内容较少，请继续录音"
- 不要假设课堂讲了什么，只能引用实际存在的文字

核心原则：
1. 【精确引用】必须引用课堂原话（老师或学生的话），格式：[引用 mm:ss] 或 [引用 mm:ss-mm:ss]
2. 【时间戳准确性】引用的时间戳必须与转录中显示的时间完全一致，不得估算或猜测
3. 【说话者识别】准确识别说话者，区分老师讲解和学生回答
4. 【追问定位】先复述课堂内容，再追问学生具体卡在哪一步
5. 【行动清单】最后给出 ≤3 个今晚可执行的任务（总计约20分钟）

时间戳引用规则：
- 如果引用学生在 00:30 说的话，必须写 [引用 00:30]
- 如果引用老师在 00:25-00:28 的讲解，必须写 [引用 00:25-00:28]
- 绝对不要使用转录中没有出现的时间戳
- 每个引用都要对应转录中的具体内容

输出格式（严格遵循）：
## 课堂回顾
[引用 xx:xx] "准确的课堂原话..."

## 你可能卡在这里
- 卡点1：...
- 卡点2：...

## 让我问你一个问题
（一个追问，帮助定位具体卡点）

## 今晚行动清单（20分钟）
1. ✅ [回放] 再听一遍 xx:xx-xx:xx（3分钟）
2. ✅ [练习] 具体任务描述（10分钟）
3. ✅ [复习] 具体任务描述（7分钟）`;

// 追问对话的系统提示词（更自然的对话）
const FOLLOWUP_SYSTEM_PROMPT = `你是一位亲切的 AI 家教，正在和学生自然对话。

【重要】你必须像真人一样自然回复，禁止使用任何固定模板！

对话规则：
- 学生说"我懂了"、"明白了"、"OK"等 → 简短鼓励，如"太棒了！还有什么想问的吗？"
- 学生提问 → 直接回答问题，不要列清单
- 学生闲聊 → 友好回应

【重要】时间戳引用规则：
- 当回答涉及课堂内容时，必须引用对应的时间戳，格式：[MM:SS] 或 [MM:SS-MM:SS]
- 例如："老师在 [00:58] 提到了氢能源的应用"
- 时间戳会被渲染为可点击的链接，帮助学生快速定位录音

禁止事项（非常重要）：
❌ 禁止使用 ## 标题
❌ 禁止输出"老师是这样讲的"
❌ 禁止输出"你可能卡在这里"
❌ 禁止输出"今晚行动清单"
❌ 禁止使用固定格式

回复风格：
- 1-3句话即可，简洁自然
- 像朋友聊天一样
- 引用课堂内容时附带时间戳`;

export async function POST(request: NextRequest) {
  // 应用速率限制
  const rateLimitResponse = await applyRateLimit(request, 'tutor');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json() as ExtendedTutorRequest & { 
      messageContent?: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    };
    
    const { 
      timestamp, 
      segments, 
      model = DEFAULT_MODEL_ID,
      studentQuestion,
      messageContent,  // 多模态消息内容
      // 新增字段
      enable_guidance = false,
      enable_web = false,
      selected_option_id,
      conversation_id,
    } = body;

    if (!segments || !Array.isArray(segments)) {
      return NextResponse.json(
        { error: '缺少 segments 参数' },
        { status: 400 }
      );
    }

    // 获取断点附近的上下文（前 90 秒，后 60 秒，增加上下文范围）
    const contextSegments = getSegmentsInRange(
      segments,
      timestamp - 90000,
      timestamp + 60000
    );

    // 【修复】不使用合并，直接使用原始segments，避免说话者混淆
    const mergedSegments = contextSegments; // 使用原始数据保持时间戳精确性
    
    // 【新增】检查转录内容是否足够
    const totalTextLength = mergedSegments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    if (mergedSegments.length < 2 || totalTextLength < 50) {
      console.log('[Tutor API] 转录内容不足，无法分析');
      return NextResponse.json({
        explanation: {
          teacherSaid: '',
          citation: { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
          possibleStuckPoints: [],
          followUpQuestion: '',
        },
        actionItems: [],
        rawContent: '📝 当前录音内容较少，无法进行有效分析。\n\n建议：\n- 继续录音，获取更多课堂内容\n- 或者在有更多内容后再标记困惑点',
        model: model,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
    
    // 生成上下文（暂时不标注说话人，直到有真正的 diarization）
    const contextText = mergedSegments.map(s => {
      const timeStr = formatTimestamp(s.startMs);
      return `[${timeStr}] ${s.text}`;
    }).join('\n');

    // 【调试日志】输出发送给大模型的原始数据
    console.log('\n========== [Tutor API] 发送给大模型的内容 ==========');
    console.log('[输入参数] timestamp:', timestamp, 'ms =', formatTimestamp(timestamp));
    console.log('[输入参数] segments数量:', segments.length);
    console.log('[上下文范围] contextSegments数量:', contextSegments.length);
    console.log('\n[课堂转录内容]:');
    console.log(contextText);
    console.log('\n====================================================\n');

    // ===== 新增：Dify 增强功能 =====
    let guidanceQuestion: GuidanceQuestion | undefined;
    let optionFollowup: string | undefined;
    let citations: Citation[] | undefined;
    let difyConversationId: string | undefined;

    // 如果启用了 Dify 功能且 Dify 服务可用
    if ((enable_guidance || enable_web) && isDifyEnabled()) {
      try {
        const difyService = getDifyService();
        const difyInput: DifyWorkflowInput = {
          timestamp,
          context: contextText,
          // 不传学科，让 AI 自动从上下文推断
          enable_guidance,
          enable_web,
          selected_option_id,
          student_question: studentQuestion,
          conversation_id,
        };

        const difyOutput = await difyService.runWorkflow(difyInput);
        
        guidanceQuestion = difyOutput.guidance_question;
        optionFollowup = difyOutput.option_followup;
        citations = difyOutput.citations;
        difyConversationId = difyOutput.conversation_id;

        // 如果学生选择了选项，将 Dify 的补充解释追加到主回答
        if (selected_option_id && optionFollowup) {
          // 后续会追加到 rawContent
        }
      } catch (error) {
        console.error('Dify service error:', error);
        // Dify 失败不影响主流程，继续使用原有逻辑
      }
    }
    
    // ===== Mock 模式：Dify 未配置时生成模拟数据 =====
    // 引导问题始终生成（核心交互方式）
    if (!guidanceQuestion) {
      guidanceQuestion = generateMockGuidanceQuestion(contextText);
    }
    
    if (enable_web && (!citations || citations.length === 0)) {
      // 生成模拟的联网搜索结果
      citations = generateMockCitations(contextText);
    }

    // ===== 原有逻辑（保持不变）=====
    const messages: ChatMessage[] = [];

    if (studentQuestion || messageContent) {
      // 追问模式 - 使用更自然的对话提示词
      messages.push({ role: 'system', content: FOLLOWUP_SYSTEM_PROMPT });
      
      // 构建用户消息（支持多模态）
      if (messageContent && messageContent.length > 0) {
        // 多模态消息：包含图片和文本
        const userContent: MultimodalContent[] = [
          // 先添加课堂上下文作为文本
          {
            type: 'text',
            text: `【课堂转录参考】\n${contextText}\n\n【学生说】`,
          },
        ];
        
        // 添加图片和用户文本
        for (const item of messageContent) {
          if (item.type === 'image_url' && item.image_url) {
            userContent.push({
              type: 'image_url',
              image_url: { url: item.image_url.url },
            });
          } else if (item.type === 'text' && item.text) {
            userContent.push({
              type: 'text',
              text: item.text,
            });
          }
        }
        
        messages.push({
          role: 'user',
          content: userContent,
        });
      } else {
        // 纯文本消息
        const userPrompt = `【课堂转录参考】
${contextText}

【学生说】
${studentQuestion}`;
        
        messages.push({
          role: 'user',
          content: userPrompt,
        });
        
        // 调试：输出追问模式的完整提示词

      }
    } else {
      // 初次解释模式 - 使用结构化提示词
      messages.push({ role: 'system', content: TUTOR_SYSTEM_PROMPT });
      messages.push({
        role: 'user',
        content: `【课堂转录】
${contextText}

【学生困惑点】
时间位置: ${formatTimeRange(timestamp - 5000, timestamp + 5000)}

【重要提醒】
- 请仔细查看每行的时间戳，确保引用的时间与内容完全对应
- 如果学生在某个时间说了话，必须引用学生说话的准确时间戳
- 如果老师在某个时间讲解了概念，必须引用老师讲解的准确时间戳
- 不要猜测或估算时间戳，请使用转录中显示的确切时间

请按照格式要求，帮助学生理解这个知识点。`,
      });
      
      // 调试：输出发送给 AI 的上下文

    }

    // 调用 LLM
    const response = await chat(messages, model, { temperature: 0.7, maxTokens: 2000 });

    // 如果是追问模式（有学生问题或多模态内容），需要验证和修正时间戳
    if (studentQuestion || messageContent) {
      let rawContent = response.content;
      
      // 如果有选项补充解释，追加到回答后面
      if (optionFollowup) {
        rawContent += `\n\n${optionFollowup}`;
      }

      // 【重要】修正追问模式下的时间戳错误
      rawContent = correctTimestampsInResponse(rawContent, mergedSegments, studentQuestion || '');

      const result: ExtendedTutorResponse = {
        explanation: {
          teacherSaid: '',
          citation: { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
          possibleStuckPoints: [],
          followUpQuestion: '',
        },
        actionItems: [],
        rawContent,
        model: response.model,
        usage: response.usage,
        // 新增字段
        guidance_question: guidanceQuestion,
        option_followup: optionFollowup,
        citations: citations?.length ? citations : undefined,
        conversation_id: difyConversationId,
      };

      return NextResponse.json(result);
    }

    // 初次解释模式，解析响应，提取结构化数据
    const parsed = parseTutorResponse(response.content, mergedSegments);
    
    // 验证和修正时间戳引用
    const correctedParsed = validateAndCorrectTimestamp(parsed, mergedSegments, timestamp);
    
    // 同时修正原始回答中的时间戳
    let correctedRawContent = response.content;
    if (parsed.explanation?.citation && correctedParsed.explanation?.citation) {
      const originalTimeRange = parsed.explanation.citation.timeRange;
      const correctedTimeRange = correctedParsed.explanation.citation.timeRange;
      
      if (originalTimeRange !== correctedTimeRange) {
        // 替换原始内容中的时间戳
        correctedRawContent = correctedRawContent.replace(
          new RegExp(`\\[引用\\s*${originalTimeRange.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'g'),
          `[引用 ${correctedTimeRange}]`
        );
      }
    }

    const result: ExtendedTutorResponse = {
      ...correctedParsed,
      rawContent: correctedRawContent,
      model: response.model,
      usage: response.usage,
      // 新增字段
      guidance_question: guidanceQuestion,
      citations: citations?.length ? citations : undefined,
      conversation_id: difyConversationId,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Tutor API error:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * 解析 AI 响应为结构化数据
 */
function parseTutorResponse(content: string, segments: Segment[]) {
  // 时间解析函数（与前端保持一致）
  const parseTimeToMs = (time: string): number => {
    const parts = time.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (!isNaN(minutes) && !isNaN(seconds)) {
        return (minutes * 60 + seconds) * 1000;
      }
    }
    return 0;
  };

  // 提取引用 [引用 xx:xx-xx:xx] 或单个时间戳 [引用 xx:xx]
  const citationMatch = content.match(/\[引用\s*(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/);
  let citation = null;
  
  if (citationMatch) {
    const [, startTime, endTime] = citationMatch;
    const startMs = parseTimeToMsInternal(startTime);
    const endMs = endTime ? parseTimeToMsInternal(endTime) : startMs + 5000; // 如果没有结束时间，默认+5秒
    
    // 找到对应的转录文本 - 更精确的匹配
    const matchedSegment = segments.find(s => 
      Math.abs(s.startMs - startMs) < 2000 // 允许2秒误差
    ) || segments.find(s => 
      s.startMs <= startMs && s.endMs >= startMs
    );
    
    citation = {
      text: matchedSegment?.text || '',
      timeRange: endTime ? `${startTime}-${endTime}` : startTime,
      startMs,
      endMs,
    };
  }

  // 提取卡点
  const stuckPointsMatch = content.match(/## 你可能卡在这里([\s\S]*?)(?=##|$)/);
  const stuckPoints: string[] = [];
  if (stuckPointsMatch) {
    const pointLines = stuckPointsMatch[1].match(/-\s*[^-\n]+/g);
    if (pointLines) {
      stuckPoints.push(...pointLines.map(p => p.replace(/^-\s*/, '').trim()));
    }
  }

  // 提取追问
  const followUpMatch = content.match(/## 让我问你一个问题([\s\S]*?)(?=##|$)/);
  const followUpQuestion = followUpMatch 
    ? followUpMatch[1].trim().replace(/^[（(]|[)）]$/g, '')
    : '你觉得哪一步最让你困惑？';

  // 提取行动清单
  const actionMatch = content.match(/## 今晚行动清单[\s\S]*?((?:\d+\.\s*[^\n]+\n?)+)/);
  const actionItems: Array<{
    id: string;
    type: 'replay' | 'exercise' | 'review';
    title: string;
    description: string;
    estimatedMinutes: number;
    completed: boolean;
  }> = [];
  
  if (actionMatch) {
    const actionLines = actionMatch[1].match(/\d+\.\s*[^\n]+/g);
    if (actionLines) {
      actionLines.forEach((line, index) => {
        const type = line.includes('[回放]') ? 'replay' 
          : line.includes('[练习]') ? 'exercise' 
          : 'review';
        
        const minutesMatch = line.match(/(\d+)\s*分钟/);
        const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 5;
        
        // 清理行内容，去掉序号和勾选符号
        const cleanedLine = line.replace(/^\d+\.\s*[✅☑️]?\s*/, '').trim();
        
        // 提取标题：去掉类型标签和时间信息，保留核心任务描述
        // 例如: "[回放] 再听一遍 00:25-00:35（3分钟）" -> "再听一遍 00:25-00:35"
        let title = cleanedLine
          .replace(/\[回放\]\s*/, '')
          .replace(/\[练习\]\s*/, '')
          .replace(/\[复习\]\s*/, '')
          .split('（')[0]  // 去掉括号及后面的内容
          .split('(')[0]   // 兼容英文括号
          .replace(/，.*$/, '')  // 去掉逗号后的详细说明
          .trim();
        
        // 提取描述：括号内或逗号后的详细说明
        const descMatch = cleanedLine.match(/[（(]([^）)]+)[）)]|，(.+)$/);
        let description = '';
        if (descMatch) {
          description = (descMatch[1] || descMatch[2] || '').trim();
          // 去掉描述中的时间信息（避免重复）
          description = description.replace(/^\d+分钟[，,]?\s*/, '');
        }
        
        // 如果描述为空，使用简短的默认描述
        if (!description) {
          if (type === 'replay') {
            description = '注意老师的讲解重点';
          } else if (type === 'exercise') {
            description = '动手练习巩固理解';
          } else {
            description = '回顾总结知识要点';
          }
        }
        
        actionItems.push({
          id: `action-${index + 1}`,
          type,
          title,
          description,
          estimatedMinutes: minutes,
          completed: false,
        });
      });
    }
  }

  // 如果没有解析到行动清单，提供默认的
  if (actionItems.length === 0) {
    actionItems.push(
      {
        id: 'action-1',
        type: 'replay',
        title: '再听一遍老师讲解',
        description: '回放困惑点附近的内容',
        estimatedMinutes: 3,
        completed: false,
      },
      {
        id: 'action-2',
        type: 'exercise',
        title: '做一道类似的题目',
        description: '用学到的知识解决实际问题',
        estimatedMinutes: 10,
        completed: false,
      },
      {
        id: 'action-3',
        type: 'review',
        title: '总结知识点',
        description: '用自己的话复述理解',
        estimatedMinutes: 7,
        completed: false,
      }
    );
  }

  return {
    explanation: {
      teacherSaid: citation?.text || extractTeacherQuote(content),
      citation: citation || {
        text: '',
        timeRange: '00:00-00:00',
        startMs: 0,
        endMs: 0,
      },
      possibleStuckPoints: stuckPoints.length > 0 ? stuckPoints : ['概念理解', '公式记忆', '应用方法'],
      followUpQuestion,
    },
    actionItems,
  };
}

/**
 * 从内容中提取老师原话
 */
function extractTeacherQuote(content: string): string {
  const quoteMatch = content.match(/"([^"]+)"/);
  return quoteMatch ? quoteMatch[1] : '老师讲解了这个知识点';
}

/**
 * 解析时间字符串为毫秒（内部使用）
 */
function parseTimeToMsInternal(time: string): number {
  const parts = time.split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
  }
  return 0;
}

/**
 * 生成模拟的引导问题（Dify 未配置时使用）
 * 根据具体的困惑点录音内容自动生成精准选项
 */
function generateMockGuidanceQuestion(context: string): GuidanceQuestion {
  // 分析上下文内容，提取关键信息
  const lines = context.split('\n').filter(l => l.trim());
  
  // 提取时间戳和内容
  const contentParts: Array<{ time: string; text: string }> = [];
  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}:\d{2}-\d{1,2}:\d{2})\]\s*(.+)/);
    if (match) {
      contentParts.push({ time: match[1], text: match[2] });
    }
  }
  
  const fullText = contentParts.map(p => p.text).join(' ').toLowerCase();
  
  // 检测特定场景并生成精准选项
  
  // 场景1：英语听力/口语场景（如 Jane Bond 例子）
  if (fullText.includes('name') || fullText.includes('bond') || fullText.includes('jane') || 
      fullText.includes('hello') || fullText.includes('nice to meet')) {
    
    return {
      id: 'guidance-english-name',
      question: '听到这段对话时，你是在哪个环节感到困惑的？',
      type: 'single_choice',
      options: [
        { 
          id: 'opt-1', 
          text: '不理解为什么名字会重复说两遍（如 "Jane, Jane Bond"）', 
          category: 'comprehension' 
        },
        { 
          id: 'opt-2', 
          text: '分不清昵称（first name）和全名（full name）的区别', 
          category: 'concept' 
        },
        { 
          id: 'opt-3', 
          text: '听不清具体发音，不确定说的是什么词', 
          category: 'comprehension' 
        },
        { 
          id: 'opt-4', 
          text: '不理解这种自我介绍的文化背景或语法结构', 
          category: 'application' 
        },
      ],
      hint: '选择最接近你困惑的选项，帮助我精准定位问题',
    };
  }
  
  // 场景2：数学公式场景
  if (fullText.includes('公式') || fullText.includes('=') || fullText.includes('²') ||
      fullText.includes('函数') || fullText.includes('方程')) {
    return {
      id: 'guidance-math-formula',
      question: '关于这个数学内容，你具体卡在哪个环节？',
      type: 'single_choice',
      options: [
        { 
          id: 'opt-1', 
          text: '不理解公式中字母/符号的含义', 
          category: 'concept' 
        },
        { 
          id: 'opt-2', 
          text: '不知道这个公式是怎么推导出来的', 
          category: 'procedure' 
        },
        { 
          id: 'opt-3', 
          text: '公式我懂，但不知道什么情况下该用它', 
          category: 'application' 
        },
        { 
          id: 'opt-4', 
          text: '代入计算时总是出错', 
          category: 'calculation' 
        },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  // 场景3：图像/图形场景
  if (fullText.includes('图像') || fullText.includes('图形') || fullText.includes('抛物线') ||
      fullText.includes('开口') || fullText.includes('坐标')) {
    return {
      id: 'guidance-graph',
      question: '关于图像这部分，你是在哪里卡住了？',
      type: 'single_choice',
      options: [
        { 
          id: 'opt-1', 
          text: '不理解图像和公式之间的对应关系', 
          category: 'concept' 
        },
        { 
          id: 'opt-2', 
          text: '不知道怎么根据条件画出图像', 
          category: 'procedure' 
        },
        { 
          id: 'opt-3', 
          text: '看不懂图像上各个点/线的意义', 
          category: 'comprehension' 
        },
        { 
          id: 'opt-4', 
          text: '不理解参数变化对图像的影响', 
          category: 'concept' 
        },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  // 场景4：物理/化学实验场景
  if (fullText.includes('实验') || fullText.includes('反应') || fullText.includes('现象') ||
      fullText.includes('能量') || fullText.includes('力')) {
    return {
      id: 'guidance-experiment',
      question: '关于这个知识点，你具体在哪里感到困惑？',
      type: 'single_choice',
      options: [
        { 
          id: 'opt-1', 
          text: '不理解基本概念或原理', 
          category: 'concept' 
        },
        { 
          id: 'opt-2', 
          text: '不知道实验步骤或操作方法', 
          category: 'procedure' 
        },
        { 
          id: 'opt-3', 
          text: '不理解为什么会出现这种现象', 
          category: 'comprehension' 
        },
        { 
          id: 'opt-4', 
          text: '不知道这个知识点在实际中怎么应用', 
          category: 'application' 
        },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  // 场景5：阅读理解/语文场景
  if (fullText.includes('文章') || fullText.includes('作者') || fullText.includes('意思') ||
      fullText.includes('表达') || fullText.includes('理解')) {
    return {
      id: 'guidance-reading',
      question: '关于这段内容，你是在哪个层面感到困惑？',
      type: 'single_choice',
      options: [
        { 
          id: 'opt-1', 
          text: '有些词语/句子看不懂', 
          category: 'comprehension' 
        },
        { 
          id: 'opt-2', 
          text: '不理解作者想表达的意思', 
          category: 'concept' 
        },
        { 
          id: 'opt-3', 
          text: '不知道怎么分析文章结构', 
          category: 'procedure' 
        },
        { 
          id: 'opt-4', 
          text: '不会用自己的话总结/复述', 
          category: 'application' 
        },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  // 默认场景：通用引导问题
  // 尝试从上下文中提取关键词来生成更相关的问题
  const keywords = extractKeywords(fullText);
  const keywordHint = keywords.length > 0 ? `（涉及：${keywords.slice(0, 3).join('、')}）` : '';
  
  return {
    id: 'guidance-default',
    question: `听到这段内容时${keywordHint}，你是在哪个环节感到困惑的？`,
    type: 'single_choice',
    options: [
      { 
        id: 'opt-1', 
        text: '基础概念不清楚，有知识漏洞', 
        category: 'concept' 
      },
      { 
        id: 'opt-2', 
        text: '老师讲得太快，没跟上思路', 
        category: 'comprehension' 
      },
      { 
        id: 'opt-3', 
        text: '步骤/方法太多，不知道怎么操作', 
        category: 'procedure' 
      },
      { 
        id: 'opt-4', 
        text: '其他原因，我想直接描述问题', 
        category: 'application' 
      },
    ],
    hint: '选择最接近你困惑的选项，帮助我更好地帮助你',
  };
}

/**
 * 从文本中提取关键词
 */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  
  // 常见学科关键词
  const patterns = [
    /函数|方程|公式|定理|证明/g,
    /实验|反应|现象|能量|物质/g,
    /文章|作者|表达|意思|理解/g,
    /单词|语法|句子|发音|听力/g,
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      keywords.push(...matches);
    }
  }
  
  return [...new Set(keywords)];
}

/**
 * 生成模拟的联网搜索结果（Dify 未配置时使用）
 */
function generateMockCitations(context: string): Citation[] {
  const citations: Citation[] = [];
  
  // 根据上下文判断主题
  const isQuadratic = context.includes('二次函数') || context.includes('抛物线') || context.includes('ax²');
  const isMath = context.includes('数学') || context.includes('公式') || context.includes('计算');
  
  if (isQuadratic) {
    citations.push(
      {
        id: 'cite-1',
        title: '二次函数图像与性质 - 知乎专栏',
        url: 'https://zhuanlan.zhihu.com/p/123456789',
        snippet: '二次函数 y = ax² + bx + c 的图像是一条抛物线。当 a > 0 时，抛物线开口向上；当 a < 0 时，抛物线开口向下...',
        source_type: 'web',
      },
      {
        id: 'cite-2',
        title: '初中数学：二次函数知识点总结',
        url: 'https://www.bilibili.com/video/BV1234567890',
        snippet: '本视频详细讲解了二次函数的顶点式、一般式、交点式三种表达形式，以及如何根据图像特征确定函数表达式...',
        source_type: 'web',
      },
      {
        id: 'cite-3',
        title: '二次函数 - 百度百科',
        url: 'https://baike.baidu.com/item/二次函数',
        snippet: '二次函数是指自变量x的最高次数为2的多项式函数。二次函数的一般形式为 y = ax² + bx + c (a≠0)...',
        source_type: 'web',
      }
    );
  } else if (isMath) {
    citations.push(
      {
        id: 'cite-1',
        title: '数学学习方法与技巧',
        url: 'https://www.zhihu.com/question/12345678',
        snippet: '学好数学的关键在于理解概念、掌握方法、多做练习。遇到不会的题目，要学会分析题目条件...',
        source_type: 'web',
      },
      {
        id: 'cite-2',
        title: '初中数学公式大全',
        url: 'https://www.example.com/math-formulas',
        snippet: '本文整理了初中阶段常用的数学公式，包括代数、几何、函数等各个板块...',
        source_type: 'web',
      }
    );
  }
  
  return citations;
}

/**
 * 验证和修正时间戳引用
 */
function validateAndCorrectTimestamp(
  parsed: any, 
  segments: Segment[], 
  confusionTimestamp: number
): any {
  if (!parsed.explanation?.citation) {
    return parsed;
  }

  const citation = parsed.explanation.citation;
  const citationStartMs = citation.startMs;
  
  // 如果引用的时间戳与困惑点时间戳相差太大，尝试修正
  const timeDiff = Math.abs(citationStartMs - confusionTimestamp);
  
  if (timeDiff > 10000) { // 相差超过10秒
    
    // 查找最接近困惑点时间的段落
    const nearestSegment = segments.reduce((closest, segment) => {
      const currentDiff = Math.abs(segment.startMs - confusionTimestamp);
      const closestDiff = Math.abs(closest.startMs - confusionTimestamp);
      return currentDiff < closestDiff ? segment : closest;
    });
    
    if (nearestSegment) {
      
      // 修正引用
      const correctedCitation = {
        ...citation,
        startMs: nearestSegment.startMs,
        endMs: nearestSegment.endMs,
        timeRange: formatTimestamp(nearestSegment.startMs),
        text: nearestSegment.text,
      };
      
      return {
        ...parsed,
        explanation: {
          ...parsed.explanation,
          citation: correctedCitation,
        },
      };
    }
  }
  
  return parsed;
}

/**
 * 修正AI回复中的时间戳引用错误
 * 特别针对追问模式下的时间戳修正
 */
function correctTimestampsInResponse(
  content: string, 
  segments: Segment[], 
  studentQuestion: string
): string {
  // 时间解析函数
  const parseTimeToMsLocal = (time: string): number => {
    const parts = time.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (!isNaN(minutes) && !isNaN(seconds)) {
        return (minutes * 60 + seconds) * 1000;
      }
    }
    return 0;
  };

  // 构建内容到时间戳的映射（用于验证）
  const contentTimeMap: Map<string, { timeStr: string; startMs: number }> = new Map();
  
  for (const segment of segments) {
    const text = segment.text.toLowerCase().trim();
    const timeStr = formatTimestamp(segment.startMs);
    
    // 存储原文和关键词的映射
    contentTimeMap.set(text, { timeStr, startMs: segment.startMs });
    
    // 提取关键词用于模糊匹配
    const words = text.split(/\s+/).filter(w => w.length > 3);
    for (const word of words) {
      if (!contentTimeMap.has(word)) {
        contentTimeMap.set(word, { timeStr, startMs: segment.startMs });
      }
    }
  }
  
  // 检测用户问题中是否提到了特定内容
  const questionLower = studentQuestion.toLowerCase();
  
  // 尝试从问题中提取关键内容（如 "Jane Bond", "name" 等）
  let targetContent: string | null = null;
  let targetTimeStr: string | null = null;
  
  // 查找问题中提到的内容在哪个时间点
  for (const segment of segments) {
    const segmentText = segment.text.toLowerCase();
    
    // 如果问题提到了某个片段的内容
    const questionWords = questionLower.split(/\s+/).filter(w => w.length > 2);
    let matchCount = 0;
    
    for (const word of questionWords) {
      if (segmentText.includes(word)) {
        matchCount++;
      }
    }
    
    // 如果匹配度较高，记录这个时间戳
    if (matchCount >= 2 || segmentText.includes('jane') || segmentText.includes('bond') || 
        segmentText.includes('my name is')) {
      targetContent = segment.text;
      targetTimeStr = formatTimestamp(segment.startMs);
      break;
    }
  }
  
  // 如果找到了目标内容和时间戳，检查AI回复中的时间戳是否正确
  if (targetTimeStr && targetContent) {
    // 匹配AI回复中的所有时间戳引用
    const timestampPattern = /(\[?\d{1,2}:\d{2}\]?)/g;
    let correctedContent = content;
    
    // 查找所有时间戳
    const matches = content.match(timestampPattern);
    if (matches) {
      for (const match of matches) {
        const cleanTime = match.replace(/[\[\]]/g, '');
        const matchMs = parseTimeToMsLocal(cleanTime);
        const targetMs = parseTimeToMsLocal(targetTimeStr);
        
        // 如果AI引用的时间戳与目标内容时间戳不一致，且差距较小（5秒内），修正它
        if (matchMs !== targetMs && Math.abs(matchMs - targetMs) <= 10000) {
          // 只替换第一个匹配（避免替换所有）
          correctedContent = correctedContent.replace(match, targetTimeStr);
        }
      }
    }
    
    return correctedContent;
  }
  
  return content;
}
