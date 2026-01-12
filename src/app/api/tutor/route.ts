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
        messages.push({
          role: 'user',
          content: `【课堂转录参考】
${contextText}

【学生说】
${studentQuestion}`,
        });
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

请按照格式要求，帮助学生理解这个知识点。`,
      });
    }

    // 调用 LLM
    const response = await chat(messages, model, { temperature: 0.7, maxTokens: 2000 });

    // 如果是追问模式（有学生问题或多模态内容），直接返回原始内容，不解析结构
    if (studentQuestion || messageContent) {
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
    const hasRepetition = /(\w+)[,\s]+\1/i.test(fullText); // 检测重复词（如 Jane, Jane）
    
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
