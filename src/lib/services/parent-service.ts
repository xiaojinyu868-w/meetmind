/**
 * 家长端服务 v3.0
 * 
 * 核心理念：聚焦"了解孩子的学习情况"这一单点需求
 * 直接基于 classroomDataService 的真实数据
 */

import { classroomDataService, type ClassSession } from './classroom-data-service';
import { db } from '@/lib/db';
import { chat } from './llm-service';

// ==================== 类型定义 ====================

/**
 * 困惑时刻 - 时间线上的一个点
 */
export interface ConfusionMoment {
  id: string;
  timestamp: number;           // 毫秒时间戳
  timeDisplay: string;         // "09:35" 格式
  
  // 课程信息
  sessionId: string;
  subject: string;             // "数学" | "英语" | "语文"
  
  // 困惑内容
  knowledgePoint: string;      // AI 识别的知识点
  transcriptContext: string;   // 困惑点上下文文字（前后30秒）
  
  // 状态
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: 'ai' | 'parent' | 'self';
  
  // 音频信息
  audioUrl?: string;
  audioStartMs: number;        // 音频片段开始时间
  audioEndMs: number;          // 音频片段结束时间
}

/**
 * 今日学情 - 家长端核心数据结构
 */
export interface TodayLearningStatus {
  studentId: string;
  studentName: string;
  date: string;               // YYYY-MM-DD
  
  // 概览数据
  overview: {
    totalClasses: number;      // 上课节数
    totalConfusions: number;   // 困惑点总数
    resolvedCount: number;     // 已解决数
  };
  
  // 困惑时刻列表（按时间排序）
  confusions: ConfusionMoment[];
  
  // AI 总结
  aiSummary: string;
}

// ==================== 辅助函数 ====================

/**
 * 格式化时间戳为 HH:MM 格式
 */
function formatTimeDisplay(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 从转录文本中提取知识点（简化版）
 */
function extractKnowledgePoint(text: string): string {
  if (!text || text.length < 10) return '课堂内容';
  
  // 尝试提取关键词
  const keywords = [
    '分数', '小数', '方程', '函数', '几何', '三角形', '圆', '面积', '体积',
    '动词', '名词', '时态', '过去式', '现在完成时', '定语从句', '单词',
    '古诗', '文言文', '作文', '阅读理解', '成语', '修辞',
    '物理', '化学', '生物', '力学', '电学', '细胞',
  ];
  
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      return keyword;
    }
  }
  
  // 截取前20个字符作为描述
  return text.slice(0, 20).replace(/\s+/g, '') + '...';
}

/**
 * 根据学科标签推断学科
 */
function inferSubject(session: ClassSession | null, text: string): string {
  if (session?.subject) return session.subject;
  
  // 根据内容推断学科
  const subjectKeywords: Record<string, string[]> = {
    '数学': ['分数', '小数', '方程', '函数', '几何', '代数', '计算', '公式'],
    '英语': ['English', 'word', '单词', '语法', '时态', '动词', 'the', 'is'],
    '语文': ['古诗', '文言文', '作文', '阅读', '成语', '修辞', '段落'],
    '物理': ['力学', '电学', '光学', '运动', '速度', '加速度'],
    '化学': ['元素', '分子', '化合物', '反应', '酸碱'],
  };
  
  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    if (keywords.some(kw => text.includes(kw))) {
      return subject;
    }
  }
  
  return '课程';
}

// ==================== 家长端服务 ====================

export const parentService = {
  /**
   * 获取今日学情
   * 核心接口：聚合孩子今天的所有学习数据
   */
  async getTodayLearningStatus(
    studentId: string,
    studentName: string,
    date: string = new Date().toISOString().split('T')[0]
  ): Promise<TodayLearningStatus> {
    // 获取所有课程会话
    const allSessions = classroomDataService.getAllSessions();
    
    // 过滤出今天且属于目标学生的会话（避免把其他学生会话计入 totalClasses）
    const todaySessions = allSessions.filter(session => {
      const sessionDate = session.createdAt.split('T')[0];
      if (sessionDate !== date) return false;
      if (session.createdBy === studentId) return true;
      return classroomDataService.getStudentAnchors(session.id, studentId).length > 0;
    });
    
    // 收集今天所有困惑点
    const allConfusions: ConfusionMoment[] = [];
    
    for (const session of todaySessions) {
      // 获取该会话的困惑点
      const anchors = classroomDataService.getStudentAnchors(session.id, studentId);
      
      // 获取转录内容
      const transcripts = await db.transcripts
        .where('sessionId')
        .equals(session.id)
        .sortBy('startMs');
      
      // 转换为 ConfusionMoment
      for (const anchor of anchors) {
        // 获取困惑点前后 30 秒的转录内容
        const startMs = Math.max(0, anchor.timestamp - 30000);
        const endMs = anchor.timestamp + 30000;
        
        const contextSegments = transcripts.filter(
          t => t.startMs < endMs && t.endMs > startMs
        );
        const transcriptContext = contextSegments.map(t => t.text).join(' ');
        
        allConfusions.push({
          id: anchor.id,
          timestamp: anchor.timestamp,
          timeDisplay: formatTimeDisplay(
            new Date(anchor.createdAt).getTime()
          ),
          sessionId: session.id,
          subject: inferSubject(session, transcriptContext),
          knowledgePoint: extractKnowledgePoint(transcriptContext),
          transcriptContext: transcriptContext.slice(0, 200),
          resolved: anchor.resolved || anchor.status === 'resolved',
          resolvedAt: anchor.resolvedAt,
          resolvedBy: anchor.resolvedAt ? 'ai' : undefined,
          audioStartMs: startMs,
          audioEndMs: endMs,
        });
      }
    }
    
    // 按时间排序（最新的在前）
    allConfusions.sort((a, b) => b.timestamp - a.timestamp);
    
    // 统计
    const resolvedCount = allConfusions.filter(c => c.resolved).length;
    
    // 生成 AI 总结
    const aiSummary = await this.generateAISummary(
      studentName,
      allConfusions,
      todaySessions.length
    );
    
    return {
      studentId,
      studentName,
      date,
      overview: {
        totalClasses: todaySessions.length,
        totalConfusions: allConfusions.length,
        resolvedCount,
      },
      confusions: allConfusions,
      aiSummary,
    };
  },

  /**
   * 获取指定学生的所有困惑点（不限日期）
   */
  async getAllConfusions(studentId: string): Promise<ConfusionMoment[]> {
    const allSessions = classroomDataService.getAllSessions();
    const allConfusions: ConfusionMoment[] = [];
    
    for (const session of allSessions) {
      const anchors = classroomDataService.getStudentAnchors(session.id, studentId);
      
      const transcripts = await db.transcripts
        .where('sessionId')
        .equals(session.id)
        .sortBy('startMs');
      
      for (const anchor of anchors) {
        const startMs = Math.max(0, anchor.timestamp - 30000);
        const endMs = anchor.timestamp + 30000;
        
        const contextSegments = transcripts.filter(
          t => t.startMs < endMs && t.endMs > startMs
        );
        const transcriptContext = contextSegments.map(t => t.text).join(' ');
        
        allConfusions.push({
          id: anchor.id,
          timestamp: anchor.timestamp,
          timeDisplay: formatTimeDisplay(new Date(anchor.createdAt).getTime()),
          sessionId: session.id,
          subject: inferSubject(session, transcriptContext),
          knowledgePoint: extractKnowledgePoint(transcriptContext),
          transcriptContext: transcriptContext.slice(0, 200),
          resolved: anchor.resolved || anchor.status === 'resolved',
          resolvedAt: anchor.resolvedAt,
          audioStartMs: startMs,
          audioEndMs: endMs,
        });
      }
    }
    
    return allConfusions.sort((a, b) => b.timestamp - a.timestamp);
  },

  /**
   * 标记困惑点已解决（家长端操作）
   */
  markResolved(confusionId: string): void {
    classroomDataService.updateAnchorStatus(confusionId, 'resolved');
  },

  /**
   * 生成 AI 一句话总结
   */
  async generateAISummary(
    studentName: string,
    confusions: ConfusionMoment[],
    totalClasses: number
  ): Promise<string> {
    // 无数据场景
    if (totalClasses === 0) {
      return `今天还没有学习记录，等${studentName}上课后会自动同步 📚`;
    }
    
    // 无困惑点场景
    if (confusions.length === 0) {
      return `太棒了！${studentName}今天上课没有标记困惑点，状态很好 🎉`;
    }
    
    // 全部解决场景
    const unresolvedCount = confusions.filter(c => !c.resolved).length;
    if (unresolvedCount === 0) {
      return `${studentName}今天的 ${confusions.length} 个困惑都已解决，继续加油！✅`;
    }
    
    // 有未解决困惑点，尝试用 AI 生成个性化总结
    try {
      // 统计学科分布
      const subjectCounts: Record<string, number> = {};
      confusions.filter(c => !c.resolved).forEach(c => {
        subjectCounts[c.subject] = (subjectCounts[c.subject] || 0) + 1;
      });
      
      const topSubject = Object.entries(subjectCounts)
        .sort((a, b) => b[1] - a[1])[0];
      
      const response = await chat(
        [
          {
            role: 'system',
            content: `你是一位温和的家庭教育顾问。请用一句话（不超过50字）总结孩子今天的学习情况，语气亲切，给家长信心。`,
          },
          {
            role: 'user',
            content: `学生：${studentName}
今日困惑点：${confusions.length} 个
未解决：${unresolvedCount} 个
主要学科：${topSubject?.[0] || '综合'}（${topSubject?.[1] || 0} 个困惑）
困惑内容：${confusions.slice(0, 3).map(c => c.knowledgePoint).join('、')}

请生成一句话总结。`,
          },
        ],
        'qwen3-max-2026-01-23',
        { temperature: 0.7, maxTokens: 100 }
      );
      
      return response.content.replace(/"/g, '');
    } catch {
      // AI 失败时使用模板
      const mainSubject = Object.entries(
        confusions.reduce((acc, c) => {
          acc[c.subject] = (acc[c.subject] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1])[0]?.[0] || '学习';
      
      return `${studentName}今天在${mainSubject}上有 ${unresolvedCount} 个困惑待解决，建议今晚看看 💪`;
    }
  },

  /**
   * 获取指定困惑点的音频片段 URL
   * 基于 sessionId 和时间范围
   */
  getAudioClipUrl(sessionId: string, startMs: number, endMs: number): string | null {
    // 目前返回完整音频 URL，前端播放时设置时间范围
    // 后续可以实现服务端音频切片
    return `/api/audio/${sessionId}?start=${startMs}&end=${endMs}`;
  },

  /**
   * 获取演示数据（开发/演示用）
   */
  async getDemoLearningStatus(): Promise<TodayLearningStatus> {
    const demoAnchors = classroomDataService.getDemoAnchors();
    const demoTranscripts = classroomDataService.getDemoTranscripts();
    
    const confusions: ConfusionMoment[] = demoAnchors
      .filter(a => a.status !== 'cancelled')
      .map(anchor => {
        const startMs = Math.max(0, anchor.timestamp - 30000);
        const endMs = anchor.timestamp + 30000;
        
        const contextSegments = demoTranscripts.filter(
          t => t.startMs < endMs && t.endMs > startMs
        );
        const transcriptContext = contextSegments.map(t => t.text).join(' ');
        
        return {
          id: anchor.id,
          timestamp: anchor.timestamp,
          timeDisplay: formatTimeDisplay(Date.now() - (Math.random() * 3600000)),
          sessionId: anchor.sessionId,
          subject: '英语',
          knowledgePoint: extractKnowledgePoint(transcriptContext),
          transcriptContext: transcriptContext.slice(0, 200),
          resolved: anchor.resolved,
          resolvedAt: anchor.resolvedAt,
          audioStartMs: startMs,
          audioEndMs: endMs,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    
    const resolvedCount = confusions.filter(c => c.resolved).length;
    
    return {
      studentId: 'demo-student',
      studentName: '小明',
      date: new Date().toISOString().split('T')[0],
      overview: {
        totalClasses: 3,
        totalConfusions: confusions.length,
        resolvedCount,
      },
      confusions,
      aiSummary: `小明今天在英语课上有 ${confusions.length - resolvedCount} 个困惑点待解决，主要集中在时态变化，建议今晚重点看看 💪`,
    };
  },
};

export default parentService;
