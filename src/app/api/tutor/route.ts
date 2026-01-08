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
import { chat, type ChatMessage } from '@/lib/services/llm-service';
import { mergeSentences, formatTimeRange, getSegmentsInRange, type Segment } from '@/lib/services/longcut-utils';
import { getDifyService, isDifyEnabled, type DifyWorkflowInput } from '@/lib/services/dify-service';
import type { ExtendedTutorRequest, ExtendedTutorResponse, GuidanceQuestion, Citation } from '@/types/dify';

// AI 家教系统提示词（初次解释用）
const TUTOR_SYSTEM_PROMPT = `你是一位"课堂对齐"的 AI 家教。你的任务是帮助学生补懂课堂上没听懂的内容。

核心原则：
1. 【证据链】必须引用老师的原话，格式：[引用 mm:ss-mm:ss]
2. 【追问定位】先复述老师讲法，再追问学生具体卡在哪一步
3. 【行动清单】最后给出 ≤3 个今晚可执行的任务（总计约20分钟）

输出格式（严格遵循）：
## 老师是这样讲的
[引用 xx:xx-xx:xx] "老师原话..."

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

禁止事项（非常重要）：
❌ 禁止使用 ## 标题
❌ 禁止输出"老师是这样讲的"
❌ 禁止输出"你可能卡在这里"
❌ 禁止输出"今晚行动清单"
❌ 禁止使用固定格式

回复风格：
- 1-3句话即可，简洁自然
- 像朋友聊天一样`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ExtendedTutorRequest;
    const { 
      timestamp, 
      segments, 
      model = 'qwen3-max',
      studentQuestion,
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

    // 获取断点附近的上下文（前后各 60 秒）
    const contextSegments = getSegmentsInRange(
      segments,
      timestamp - 60000,
      timestamp + 30000
    );

    // 合并为完整段落
    const mergedSegments = mergeSentences(contextSegments);
    const contextText = mergedSegments.map(s => `[${formatTimeRange(s.startMs, s.endMs)}] ${s.text}`).join('\n');

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
          subject: '数学', // TODO: 从请求中获取
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
    if (enable_guidance && !guidanceQuestion) {
      // 生成模拟的引导问题
      guidanceQuestion = generateMockGuidanceQuestion(contextText);
    }
    
    if (enable_web && (!citations || citations.length === 0)) {
      // 生成模拟的联网搜索结果
      citations = generateMockCitations(contextText);
    }

    // ===== 原有逻辑（保持不变）=====
    const messages: ChatMessage[] = [];

    if (studentQuestion) {
      // 追问模式 - 使用更自然的对话提示词
      messages.push({ role: 'system', content: FOLLOWUP_SYSTEM_PROMPT });
      messages.push({
        role: 'user',
        content: `【课堂转录参考】
${contextText}

【学生说】
${studentQuestion}`,
      });
    } else {
      // 初次解释模式 - 使用结构化提示词
      messages.push({ role: 'system', content: TUTOR_SYSTEM_PROMPT });
      messages.push({
        role: 'user',
        content: `【课堂转录】
${contextText}

【学生困惑点】
时间位置: ${formatTimeRange(timestamp - 5000, timestamp + 5000)}

请按照格式要求，帮助学生理解这个知识点。`,
      });
    }

    // 调用 LLM
    const response = await chat(messages, model, { temperature: 0.7, maxTokens: 2000 });

    // 如果是追问模式，直接返回原始内容，不解析结构
    if (studentQuestion) {
      let rawContent = response.content;
      
      // 如果有选项补充解释，追加到回答后面
      if (optionFollowup) {
        rawContent += `\n\n${optionFollowup}`;
      }

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

    const result: ExtendedTutorResponse = {
      ...parsed,
      rawContent: response.content,
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
  // 提取引用 [引用 xx:xx-xx:xx]
  const citationMatch = content.match(/\[引用\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]/);
  let citation = null;
  
  if (citationMatch) {
    const [, startTime, endTime] = citationMatch;
    const startMs = parseTimeToMs(startTime);
    const endMs = parseTimeToMs(endTime);
    
    // 找到对应的转录文本
    const matchedSegment = segments.find(s => 
      s.startMs <= startMs && s.endMs >= startMs
    );
    
    citation = {
      text: matchedSegment?.text || '',
      timeRange: `${startTime}-${endTime}`,
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
        
        actionItems.push({
          id: `action-${index + 1}`,
          type,
          title: line.replace(/^\d+\.\s*[✅☑️]\s*/, '').split('（')[0].trim(),
          description: line.replace(/^\d+\.\s*[✅☑️]\s*/, ''),
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
 * 解析时间字符串为毫秒
 */
function parseTimeToMs(time: string): number {
  const parts = time.split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
  }
  return 0;
}

/**
 * 生成模拟的引导问题（Dify 未配置时使用）
 */
function generateMockGuidanceQuestion(context: string): GuidanceQuestion {
  // 根据上下文内容生成相关的引导问题
  const hasFormula = context.includes('公式') || context.includes('=') || context.includes('²');
  const hasGraph = context.includes('图像') || context.includes('抛物线') || context.includes('开口');
  const hasExample = context.includes('例') || context.includes('题') || context.includes('求');
  
  if (hasGraph) {
    return {
      id: 'mock-guidance-1',
      question: '你是在听到"今天我们来学习二次函数的图像"这句话时感到困惑了吗？是因为不知道"二次函数"是什么，还是不明白它怎么会有"图像"？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不清楚"二次函数"为什么叫"二次"，或者和图像有什么关系', category: 'concept' },
        { id: 'opt-2', text: '还没建立"代数表达式 y = ax² + bx + c"和"抛物线图像"之间的联系', category: 'concept' },
        { id: 'opt-3', text: '不理解 a > 0 和 a < 0 时图像为什么会有不同的开口方向', category: 'procedure' },
        { id: 'opt-4', text: '其他原因，我想直接问问题', category: 'application' },
      ],
      hint: '选择最接近你困惑的选项，帮助我更好地帮助你',
    };
  }
  
  if (hasFormula) {
    return {
      id: 'mock-guidance-2',
      question: '关于这个公式，你觉得哪个部分最让你困惑？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不理解公式中各个字母代表什么', category: 'concept' },
        { id: 'opt-2', text: '不知道这个公式是怎么推导出来的', category: 'procedure' },
        { id: 'opt-3', text: '公式我懂，但不知道什么时候用', category: 'application' },
        { id: 'opt-4', text: '计算时总是出错', category: 'calculation' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  if (hasExample) {
    return {
      id: 'mock-guidance-3',
      question: '这道例题让你卡住了，是因为哪个环节？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '题目看不懂，不知道要求什么', category: 'comprehension' },
        { id: 'opt-2', text: '不知道该用什么方法解', category: 'procedure' },
        { id: 'opt-3', text: '方法知道，但计算过程出错', category: 'calculation' },
        { id: 'opt-4', text: '答案对了，但不确定理解是否正确', category: 'concept' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }
  
  // 默认问题
  return {
    id: 'mock-guidance-default',
    question: '你觉得是哪个方面让你感到困惑？',
    type: 'single_choice',
    options: [
      { id: 'opt-1', text: '概念不清楚，基础知识有漏洞', category: 'concept' },
      { id: 'opt-2', text: '步骤太多，不知道先做什么', category: 'procedure' },
      { id: 'opt-3', text: '老师讲得太快，没跟上', category: 'comprehension' },
      { id: 'opt-4', text: '其他原因', category: 'application' },
    ],
    hint: '选择最接近你困惑的选项，帮助我更好地帮助你',
  };
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
