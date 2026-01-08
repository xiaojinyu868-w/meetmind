/**
 * 家长端服务
 * 
 * 生成家长日报和陪学脚本
 */

import type { Anchor } from './anchor-service';
import type { ClassTimeline, TimelineSegment } from './memory-service';
import { chat } from './llm-service';

export interface ConfusionPoint {
  id: string;
  subject: string;
  time: string;
  timestamp: number;
  summary: string;
  teacherQuote: string;
  audioClipUrl?: string;
}

export interface ParentDailyReport {
  date: string;
  studentName: string;
  totalLessons: number;
  totalBreakpoints: number;
  unresolvedBreakpoints: number;
  estimatedMinutes: number;
  confusionPoints: ConfusionPoint[];
  actionScript: string;
  completionStatus: Array<{
    taskId: string;
    title: string;
    completed: boolean;
  }>;
}

/**
 * 家长端服务
 */
export const parentService = {
  /**
   * 生成家长日报
   */
  async generateDailyReport(
    studentName: string,
    timelines: ClassTimeline[],
    date: string = new Date().toISOString().split('T')[0]
  ): Promise<ParentDailyReport> {
    // 收集所有未解决的断点
    const allAnchors: Array<{ anchor: Anchor; timeline: ClassTimeline; segment?: TimelineSegment }> = [];

    for (const timeline of timelines) {
      for (const anchor of timeline.anchors) {
        if (!anchor.resolved && !anchor.cancelled) {
          // 找到断点对应的片段
          const segment = timeline.segments.find(
            s => s.startMs <= anchor.timestamp && s.endMs >= anchor.timestamp
          );
          allAnchors.push({ anchor, timeline, segment });
        }
      }
    }

    // 生成困惑点摘要
    const confusionPoints: ConfusionPoint[] = allAnchors.map(({ anchor, timeline, segment }) => ({
      id: anchor.id,
      subject: timeline.subject,
      time: this.formatTime(anchor.timestamp),
      timestamp: anchor.timestamp,
      summary: segment?.text.slice(0, 50) + '...' || '课堂内容',
      teacherQuote: segment?.text || '',
    }));

    // 估算陪学时间（每个断点约 7 分钟）
    const estimatedMinutes = allAnchors.length * 7;

    // 生成陪学脚本
    const actionScript = await this.generateActionScript(
      studentName,
      confusionPoints,
      estimatedMinutes
    );

    // 生成任务清单
    const completionStatus = confusionPoints.map((point, index) => ({
      taskId: `task-${point.id}`,
      title: `${point.subject} - ${point.time} 的困惑点`,
      completed: false,
    }));

    return {
      date,
      studentName,
      totalLessons: timelines.length,
      totalBreakpoints: allAnchors.length + timelines.reduce((sum, t) => 
        sum + t.anchors.filter(a => a.resolved).length, 0
      ),
      unresolvedBreakpoints: allAnchors.length,
      estimatedMinutes,
      confusionPoints,
      actionScript,
      completionStatus,
    };
  },

  /**
   * 生成陪学脚本
   */
  async generateActionScript(
    studentName: string,
    confusionPoints: ConfusionPoint[],
    estimatedMinutes: number
  ): Promise<string> {
    if (confusionPoints.length === 0) {
      return `🎉 太棒了！${studentName}今天课堂上没有标记困惑点，看起来都听懂了！

建议今晚：
1. 问问孩子今天学了什么新知识
2. 让孩子用自己的话复述一遍
3. 表扬孩子的专注力`;
    }

    // 使用 AI 生成个性化脚本
    try {
      const response = await chat(
        [
          {
            role: 'system',
            content: `你是一位家庭教育顾问。请根据孩子今天课堂上的困惑点，生成一份简洁的"今晚陪学脚本"。

要求：
1. 语气亲切，像朋友一样
2. 给出具体的操作步骤
3. 控制在 ${estimatedMinutes} 分钟左右
4. 包含鼓励和正向引导`,
          },
          {
            role: 'user',
            content: `学生：${studentName}
困惑点数量：${confusionPoints.length}
预计时间：${estimatedMinutes} 分钟

困惑点详情：
${confusionPoints.map((p, i) => `${i + 1}. ${p.subject} ${p.time}：${p.summary}`).join('\n')}

请生成今晚的陪学脚本。`,
          },
        ],
        'qwen3-max',
        { temperature: 0.7, maxTokens: 500 }
      );

      return response.content;
    } catch {
      // 降级到模板脚本
      return this.getTemplateScript(studentName, confusionPoints, estimatedMinutes);
    }
  },

  /**
   * 模板脚本（AI 不可用时使用）
   */
  getTemplateScript(
    studentName: string,
    confusionPoints: ConfusionPoint[],
    estimatedMinutes: number
  ): string {
    const subjects = [...new Set(confusionPoints.map(p => p.subject))];

    return `📚 今晚陪学脚本（约 ${estimatedMinutes} 分钟）

👋 开场（2分钟）
"${studentName}，今天课上有 ${confusionPoints.length} 个地方你按了'没听懂'，我们一起来看看。"

📖 逐个击破（${confusionPoints.length * 5} 分钟）
${confusionPoints.map((p, i) => `
${i + 1}. ${p.subject} - ${p.time}
   - 先问："这里老师讲了什么？"
   - 听孩子说完，再一起看 AI 解释
   - 确认懂了就打勾 ✓`).join('')}

🎯 收尾（3分钟）
- 问问孩子："今天哪个知识点最有意思？"
- 表扬孩子主动标记困惑点的习惯
- 提醒明天课堂继续用 MeetMind

💪 加油！${subjects.join('、')}都是可以攻克的！`;
  },

  /**
   * 格式化时间
   */
  formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  },

  /**
   * 标记任务完成
   */
  markTaskComplete(
    report: ParentDailyReport,
    taskId: string
  ): ParentDailyReport {
    return {
      ...report,
      completionStatus: report.completionStatus.map(task =>
        task.taskId === taskId ? { ...task, completed: true } : task
      ),
    };
  },

  /**
   * 计算完成率
   */
  getCompletionRate(report: ParentDailyReport): number {
    if (report.completionStatus.length === 0) return 100;
    const completed = report.completionStatus.filter(t => t.completed).length;
    return Math.round((completed / report.completionStatus.length) * 100);
  },
};
