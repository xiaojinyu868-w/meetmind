/**
 * 演示数据 - 用于开发和测试
 */

import type { TranscriptSegment, Anchor, ClassTimeline, TimelineSegment } from '@/types';

/**
 * 演示课程：英语听力练习 - Australia's Moving Experience
 * 音频时长：1分33秒（93秒）
 */
export const DEMO_SESSION_ID = 'demo-session';
export const DEMO_AUDIO_URL = '/demo-audio.mp3';

export const DEMO_SEGMENTS: TranscriptSegment[] = [
  { id: 's1', text: "Good morning ma'am and welcome to Australia's Moving Experience. How can I help you?", startMs: 0, endMs: 6000, confidence: 0.95 },
  { id: 's2', text: "Well, I hope you can help me. I'm so up in the air right now.", startMs: 6000, endMs: 11000, confidence: 0.94 },
  { id: 's3', text: "Just calm down now. Let me guess, you're moving and it has you a little confused.", startMs: 11000, endMs: 17000, confidence: 0.93 },
  { id: 's4', text: "That's it exactly. You see, I'm relocating to the United States next month and I'm having a hard time getting organised.", startMs: 17000, endMs: 25000, confidence: 0.95 },
  { id: 's5', text: "Here, fill out your name and address and let me ask you a few questions. Oh, what should I call you?", startMs: 25000, endMs: 30000, confidence: 0.94 },
  { id: 's6', text: "My name is Jane, Jane Bond.", startMs: 30000, endMs: 34000, confidence: 0.96 },
  { id: 's7', text: "The woman says that her full name is Jane Bond, so Jane Bond has been written in the space.", startMs: 34000, endMs: 42000, confidence: 0.95 },
  { id: 's8', text: "Now we shall begin. You should answer the questions as you listen, because you will not hear the recording a second time.", startMs: 42000, endMs: 50000, confidence: 0.94 },
  { id: 's9', text: "Listen carefully and answer questions one to six.", startMs: 50000, endMs: 56000, confidence: 0.96 },
  { id: 's10', text: "Good morning ma'am and welcome to Australia's Moving Experience. How can I help you?", startMs: 56000, endMs: 61000, confidence: 0.95 },
  { id: 's11', text: "Well, I hope you can help me. I'm so up in the air right now.", startMs: 61000, endMs: 66000, confidence: 0.94 },
  { id: 's12', text: "Just calm down now. Let me guess, you're moving and it has you a little confused.", startMs: 66000, endMs: 72000, confidence: 0.93 },
  { id: 's13', text: "That's it exactly. You see, I'm relocating to the United States next month and I'm having a hard time getting organised.", startMs: 72000, endMs: 80000, confidence: 0.95 },
  { id: 's14', text: "Here, fill out your name and address and let me ask you a few questions. Oh, what should I call you?", startMs: 80000, endMs: 85000, confidence: 0.94 },
  { id: 's15', text: "My name is Jane, Jane Bond.", startMs: 85000, endMs: 88000, confidence: 0.96 },
  { id: 's16', text: "OK Jane, first of all, what's your work phone number?", startMs: 88000, endMs: 93000, confidence: 0.95 },
];

export const DEMO_ANCHORS: Anchor[] = [
  {
    id: 'anchor-demo-1',
    sessionId: DEMO_SESSION_ID,
    studentId: 'student-1',
    timestamp: 30000,  // 30秒处 - "My name is Jane, Jane Bond"
    type: 'confusion',
    cancelled: false,
    resolved: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'anchor-demo-2',
    sessionId: DEMO_SESSION_ID,
    studentId: 'student-1',
    timestamp: 72000,  // 72秒处 - "relocating to the United States"
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
    subject: '英语',
    teacher: 'Demo Teacher',
    duration: DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1].endMs,
    segments: timelineSegments,
    anchors: DEMO_ANCHORS,
  };
}

/**
 * 推断片段类型
 */
function inferSegmentType(text: string): 'lecture' | 'qa' | 'exercise' {
  if (text.includes('？') || text.includes('?') || text.includes('问') || text.includes('How can')) {
    return 'qa';
  }
  if (text.includes('练习') || text.includes('做一下') || text.includes('试试') || text.includes('例题') || text.includes('answer questions')) {
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
    subject: '英语',
    title: "Australia's Moving Experience - 听力练习",
    teacher: 'Demo Teacher',
    duration: 93000,
  },
  {
    id: 'demo-physics',
    subject: '物理',
    title: '牛顿第二定律',
    teacher: '李老师',
    duration: 0,  // 未实现
  },
  {
    id: 'demo-math',
    subject: '数学',
    title: '二次函数的图像与性质',
    teacher: '张老师',
    duration: 0,  // 未实现
  },
];
