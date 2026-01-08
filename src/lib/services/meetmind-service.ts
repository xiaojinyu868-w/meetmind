/**
 * MeetMind 核心业务服务
 * 
 * 整合 Discussion + Open Notebook + LongCut 的能力
 * 实现 MeetMind MVP 的核心功能
 */

import { discussionService, type ChatMessage } from './discussion-service';
import { notebookService } from './notebook-service';
import { longcutService, type TranscriptSegment } from './longcut-service';
import { 
  mergeSentences, 
  matchQuotes, 
  formatTimeRange,
  getSegmentsInRange,
  type Segment 
} from './longcut-utils';

// ==================== 类型定义 ====================

export interface Lesson {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  date: string;
  duration: number;  // 毫秒
  audioUrl?: string;
  status: 'recording' | 'processing' | 'ready';
}

export interface Breakpoint {
  id: string;
  lessonId: string;
  studentId: string;
  timestamp: number;  // 毫秒
  type: 'confusion' | 'important' | 'question';
  resolved: boolean;
  createdAt: string;
}

export interface Timeline {
  lessonId: string;
  segments: TranscriptSegment[];
  breakpoints: Breakpoint[];
  topics: Array<{
    id: string;
    title: string;
    startMs: number;
    endMs: number;
  }>;
}

export interface TutorExplanation {
  teacherSaid: string;           // 老师原话
  citation: {                    // 引用
    text: string;
    timeRange: string;           // "mm:ss-mm:ss"
    startMs: number;
    endMs: number;
  };
  possibleStuckPoints: string[]; // 可能卡住的点
  followUpQuestion: string;      // 追问
}

export interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

export interface TutorResponse {
  explanation: TutorExplanation;
  actionItems: ActionItem[];
  conversationId: string;
}

// ==================== AI 家教 Prompt ====================

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

// ==================== MeetMind 服务 ====================

export const meetmindService = {
  // ========== 课堂管理 ==========

  /**
   * 获取今日课程列表
   */
  async getTodayLessons(studentId: string): Promise<Lesson[]> {
    // TODO: 从数据库获取，目前返回 Mock 数据
    return [
      {
        id: 'lesson-1',
        courseId: 'math-101',
        courseName: '数学',
        title: '二次函数的图像与性质',
        date: new Date().toISOString().split('T')[0],
        duration: 40 * 60 * 1000,
        status: 'ready',
      },
      {
        id: 'lesson-2',
        courseId: 'physics-101',
        courseName: '物理',
        title: '牛顿第二定律',
        date: new Date().toISOString().split('T')[0],
        duration: 45 * 60 * 1000,
        status: 'ready',
      },
    ];
  },

  /**
   * 获取课堂时间轴
   */
  async getLessonTimeline(lessonId: string): Promise<Timeline> {
    // TODO: 从数据库获取真实数据
    // 目前返回 Mock 数据
    const mockSegments: TranscriptSegment[] = [
      { id: 's1', text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000 },
      { id: 's2', text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000 },
      { id: 's3', text: '其中 a 不等于 0，a 的正负决定了抛物线的开口方向', startMs: 35000, endMs: 60000 },
      { id: 's4', text: '当 a 大于 0 时，抛物线开口向上', startMs: 60000, endMs: 85000 },
      { id: 's5', text: '当 a 小于 0 时，抛物线开口向下', startMs: 85000, endMs: 110000 },
      { id: 's6', text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000 },
      { id: 's7', text: '这个公式很重要，大家要记住', startMs: 150000, endMs: 170000 },
      { id: 's8', text: '我们来看一个例题', startMs: 170000, endMs: 190000 },
    ];

    const mockBreakpoints: Breakpoint[] = [
      {
        id: 'bp-1',
        lessonId,
        studentId: 'student-1',
        timestamp: 120000,  // 2:00 - 顶点公式那里
        type: 'confusion',
        resolved: false,
        createdAt: new Date().toISOString(),
      },
    ];

    return {
      lessonId,
      segments: mockSegments,
      breakpoints: mockBreakpoints,
      topics: [
        { id: 't1', title: '二次函数定义', startMs: 0, endMs: 60000 },
        { id: 't2', title: '开口方向', startMs: 60000, endMs: 110000 },
        { id: 't3', title: '顶点公式', startMs: 110000, endMs: 190000 },
      ],
    };
  },

  // ========== 断点管理 ==========

  /**
   * 标记断点
   */
  async markBreakpoint(
    lessonId: string,
    studentId: string,
    timestamp: number,
    type: Breakpoint['type'] = 'confusion'
  ): Promise<Breakpoint> {
    const breakpoint: Breakpoint = {
      id: `bp-${Date.now()}`,
      lessonId,
      studentId,
      timestamp,
      type,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    // TODO: 保存到数据库
    return breakpoint;
  },

  /**
   * 解决断点
   */
  async resolveBreakpoint(breakpointId: string): Promise<void> {
    // TODO: 更新数据库
    console.log(`Resolved breakpoint: ${breakpointId}`);
  },

  // ========== AI 家教 ==========

  /**
   * 解释断点（核心功能）
   * 
   * 整合能力：
   * - LongCut: 获取断点附近的转录片段
   * - Discussion: 调用通义千问生成解释
   * - LongCut: 匹配引用
   */
  async explainBreakpoint(
    breakpoint: Breakpoint,
    timeline: Timeline
  ): Promise<TutorResponse> {
    // 1. 获取断点附近的上下文（前后各 60 秒）
    const contextSegments = getSegmentsInRange(
      timeline.segments,
      breakpoint.timestamp - 60000,
      breakpoint.timestamp + 30000
    );

    // 2. 合并为完整段落
    const mergedSegments = mergeSentences(contextSegments);
    const contextText = mergedSegments.map(s => s.text).join('\n');

    // 3. 构建 Prompt
    const userMessage = `【课堂转录】
${contextText}

【学生困惑点】
时间位置: ${formatTimeRange(breakpoint.timestamp - 5000, breakpoint.timestamp + 5000)}

请按照格式要求，帮助学生理解这个知识点。`;

    // 4. 调用 Discussion 的 LLM 服务
    const messages: ChatMessage[] = [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await discussionService.chat(messages, contextText);
      
      // 5. 解析响应，提取结构化数据
      const parsed = this.parseTutorResponse(response.content, mergedSegments);
      
      return {
        ...parsed,
        conversationId: `conv-${Date.now()}`,
      };
    } catch (error) {
      // 如果 Discussion 服务不可用，返回 Mock 数据
      console.warn('Discussion service unavailable, using mock response');
      return this.getMockTutorResponse(breakpoint, mergedSegments);
    }
  },

  /**
   * 追问对话
   */
  async followUp(
    conversationId: string,
    message: string,
    context: string
  ): Promise<{ response: string; citations: Array<{ text: string; timeRange: string }> }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      { role: 'user', content: message },
    ];

    try {
      const response = await discussionService.chat(messages, context);
      return {
        response: response.content,
        citations: response.citations?.map(c => ({
          text: c.text,
          timeRange: formatTimeRange(c.startTime, c.endTime),
        })) || [],
      };
    } catch {
      return {
        response: '抱歉，我暂时无法回答。请稍后再试。',
        citations: [],
      };
    }
  },

  /**
   * 解析 AI 响应为结构化数据
   */
  parseTutorResponse(
    content: string,
    segments: Segment[]
  ): Omit<TutorResponse, 'conversationId'> {
    // 提取引用
    const citations = matchQuotes(content, segments);
    const firstCitation = citations[0];

    // 提取行动清单
    const actionItems = this.extractActionItems(content);

    return {
      explanation: {
        teacherSaid: firstCitation?.text || '老师讲解了这个知识点',
        citation: firstCitation ? {
          text: firstCitation.text,
          timeRange: formatTimeRange(firstCitation.startMs, firstCitation.endMs),
          startMs: firstCitation.startMs,
          endMs: firstCitation.endMs,
        } : {
          text: '',
          timeRange: '00:00-00:00',
          startMs: 0,
          endMs: 0,
        },
        possibleStuckPoints: ['概念理解', '公式记忆', '应用方法'],
        followUpQuestion: '你觉得哪一步最让你困惑？',
      },
      actionItems,
    };
  },

  /**
   * 从响应中提取行动清单
   */
  extractActionItems(content: string): ActionItem[] {
    // 简化实现：返回默认的行动清单
    // TODO: 用正则或 LLM 解析实际内容
    return [
      {
        id: 'action-1',
        type: 'replay',
        title: '再听一遍老师讲解',
        description: '回放 01:50-02:30 的内容，注意老师强调的关键点',
        estimatedMinutes: 3,
        completed: false,
        relatedTimestamp: 110000,
      },
      {
        id: 'action-2',
        type: 'exercise',
        title: '做一道类似的题目',
        description: '用顶点公式求 y = 2x² - 4x + 1 的顶点坐标',
        estimatedMinutes: 10,
        completed: false,
      },
      {
        id: 'action-3',
        type: 'review',
        title: '总结公式',
        description: '用自己的话写出顶点公式，并解释每个字母的含义',
        estimatedMinutes: 7,
        completed: false,
      },
    ];
  },

  /**
   * Mock 响应（服务不可用时使用）
   */
  getMockTutorResponse(
    breakpoint: Breakpoint,
    segments: Segment[]
  ): TutorResponse {
    const nearestSegment = segments.find(s => 
      s.startMs <= breakpoint.timestamp && s.endMs >= breakpoint.timestamp
    ) || segments[0];

    return {
      explanation: {
        teacherSaid: nearestSegment?.text || '老师讲解了这个知识点',
        citation: {
          text: nearestSegment?.text || '',
          timeRange: nearestSegment 
            ? formatTimeRange(nearestSegment.startMs, nearestSegment.endMs)
            : '00:00-00:00',
          startMs: nearestSegment?.startMs || 0,
          endMs: nearestSegment?.endMs || 0,
        },
        possibleStuckPoints: [
          '公式的推导过程',
          '各个字母代表的含义',
          '如何应用到具体题目',
        ],
        followUpQuestion: '你是在公式记忆上有困难，还是不知道怎么用这个公式？',
      },
      actionItems: this.extractActionItems(''),
      conversationId: `conv-${Date.now()}`,
    };
  },

  // ========== 家长端 ==========

  /**
   * 生成家长日报
   */
  async generateParentReport(studentId: string, date: string) {
    const lessons = await this.getTodayLessons(studentId);
    const allBreakpoints: Breakpoint[] = [];

    for (const lesson of lessons) {
      const timeline = await this.getLessonTimeline(lesson.id);
      allBreakpoints.push(...timeline.breakpoints);
    }

    const unresolvedCount = allBreakpoints.filter(b => !b.resolved).length;

    return {
      date,
      studentName: '小明',
      totalBreakpoints: allBreakpoints.length,
      unresolvedBreakpoints: unresolvedCount,
      estimatedMinutes: unresolvedCount * 7,  // 每个断点约 7 分钟
      breakpoints: allBreakpoints.slice(0, 3).map(bp => ({
        id: bp.id,
        course: lessons.find(l => l.id === bp.lessonId)?.courseName || '未知',
        timestamp: bp.timestamp,
        resolved: bp.resolved,
      })),
      script: `今晚大约需要 ${unresolvedCount * 7} 分钟陪孩子复习。

1. 先问问孩子今天课上有没有不懂的地方
2. 一起看看 MeetMind 标记的 ${unresolvedCount} 个困惑点
3. 让孩子完成行动清单上的任务
4. 完成后在 App 上打勾确认`,
    };
  },
};
