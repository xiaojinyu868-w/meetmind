/**
 * 演示数据 - 用于开发和测试
 */

import type { TranscriptSegment, Anchor, ClassTimeline, TimelineSegment } from '@/types';

/**
 * 演示课程：二次函数
 */
export const DEMO_SESSION_ID = 'demo-session';

export const DEMO_SEGMENTS: TranscriptSegment[] = [
  { id: 's1', text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000, confidence: 0.95 },
  { id: 's2', text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000, confidence: 0.92 },
  { id: 's3', text: '其中 a 不等于 0，a 的正负决定了抛物线的开口方向', startMs: 35000, endMs: 60000, confidence: 0.94 },
  { id: 's4', text: '当 a 大于 0 时，抛物线开口向上', startMs: 60000, endMs: 85000, confidence: 0.96 },
  { id: 's5', text: '当 a 小于 0 时，抛物线开口向下', startMs: 85000, endMs: 110000, confidence: 0.93 },
  { id: 's6', text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000, confidence: 0.91 },
  { id: 's7', text: '这个公式很重要，大家要记住', startMs: 150000, endMs: 170000, confidence: 0.97 },
  { id: 's8', text: '我们来看一个例题', startMs: 170000, endMs: 190000, confidence: 0.95 },
  { id: 's9', text: '求 y = 2x² - 4x + 1 的顶点坐标', startMs: 190000, endMs: 220000, confidence: 0.94 },
  { id: 's10', text: '首先 a = 2, b = -4, c = 1', startMs: 220000, endMs: 250000, confidence: 0.96 },
  { id: 's11', text: '代入公式 x = -b/2a = 4/4 = 1', startMs: 250000, endMs: 280000, confidence: 0.93 },
  { id: 's12', text: 'y = 2(1)² - 4(1) + 1 = -1', startMs: 280000, endMs: 310000, confidence: 0.92 },
  { id: 's13', text: '所以顶点坐标是 (1, -1)', startMs: 310000, endMs: 340000, confidence: 0.98 },
];

export const DEMO_ANCHORS: Anchor[] = [
  {
    id: 'anchor-demo-1',
    sessionId: DEMO_SESSION_ID,
    studentId: 'student-1',
    timestamp: 125000,  // 在顶点公式讲解时
    type: 'confusion',
    cancelled: false,
    resolved: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'anchor-demo-2',
    sessionId: DEMO_SESSION_ID,
    studentId: 'student-1',
    timestamp: 260000,  // 在代入公式计算时
    type: 'confusion',
    cancelled: false,
    resolved: false,
    createdAt: new Date().toISOString(),
  },
];

/**
 * 生成演示时间轴
 */
export function createDemoTimeline(): ClassTimeline {
  const timelineSegments: TimelineSegment[] = DEMO_SEGMENTS.map(seg => ({
    ...seg,
    anchors: DEMO_ANCHORS.filter(
      a => !a.cancelled && a.timestamp >= seg.startMs && a.timestamp <= seg.endMs
    ),
    type: inferSegmentType(seg.text),
  }));

  return {
    id: `timeline-${DEMO_SESSION_ID}`,
    lessonId: DEMO_SESSION_ID,
    date: new Date().toISOString().split('T')[0],
    subject: '数学',
    teacher: '张老师',
    duration: DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1].endMs,
    segments: timelineSegments,
    anchors: DEMO_ANCHORS,
  };
}

/**
 * 推断片段类型
 */
function inferSegmentType(text: string): 'lecture' | 'qa' | 'exercise' {
  if (text.includes('？') || text.includes('?') || text.includes('问')) {
    return 'qa';
  }
  if (text.includes('练习') || text.includes('做一下') || text.includes('试试') || text.includes('例题')) {
    return 'exercise';
  }
  return 'lecture';
}

/**
 * 更多演示课程（可扩展）
 */
export const DEMO_COURSES = [
  {
    id: 'demo-session',
    subject: '数学',
    title: '二次函数的图像与性质',
    teacher: '张老师',
    duration: 340000,
  },
  {
    id: 'demo-physics',
    subject: '物理',
    title: '牛顿第二定律',
    teacher: '李老师',
    duration: 0,  // 未实现
  },
  {
    id: 'demo-english',
    subject: '英语',
    title: '过去完成时',
    teacher: '王老师',
    duration: 0,  // 未实现
  },
];
