/**
 * 课堂时间轴服务
 * 
 * 整合转录结果和断点，生成课堂时间轴
 */

import type { TranscriptSegment } from './capture-service';
import type { Anchor } from './anchor-service';

export interface TimelineSegment extends TranscriptSegment {
  anchors: Anchor[];  // 该片段关联的断点
  type: 'lecture' | 'qa' | 'exercise';  // 段落类型
}

export interface ClassTimeline {
  id: string;
  lessonId: string;
  date: string;
  subject: string;
  teacher: string;
  duration: number;  // 总时长（毫秒）
  segments: TimelineSegment[];
  anchors: Anchor[];
  audioUrl?: string;
}

export interface Topic {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
}

/**
 * 课堂时间轴服务
 */
export const memoryService = {
  /**
   * 从转录结果和断点生成时间轴
   */
  buildTimeline(
    lessonId: string,
    segments: TranscriptSegment[],
    anchors: Anchor[],
    metadata: {
      subject: string;
      teacher: string;
      date: string;
    }
  ): ClassTimeline {
    // 为每个片段关联断点
    const timelineSegments: TimelineSegment[] = segments.map(seg => ({
      ...seg,
      anchors: anchors.filter(
        a => !a.cancelled && a.timestamp >= seg.startMs && a.timestamp <= seg.endMs
      ),
      type: this.inferSegmentType(seg.text),
    }));

    // 计算总时长
    const duration = segments.length > 0
      ? segments[segments.length - 1].endMs
      : 0;

    return {
      id: `timeline-${lessonId}`,
      lessonId,
      date: metadata.date,
      subject: metadata.subject,
      teacher: metadata.teacher,
      duration,
      segments: timelineSegments,
      anchors: anchors.filter(a => !a.cancelled),
    };
  },

  /**
   * 推断片段类型
   */
  inferSegmentType(text: string): 'lecture' | 'qa' | 'exercise' {
    // 简单规则推断
    if (text.includes('？') || text.includes('?') || text.includes('问')) {
      return 'qa';
    }
    if (text.includes('练习') || text.includes('做一下') || text.includes('试试')) {
      return 'exercise';
    }
    return 'lecture';
  },

  /**
   * 自动分块（按主题）
   */
  extractTopics(segments: TimelineSegment[]): Topic[] {
    if (segments.length === 0) return [];

    const topics: Topic[] = [];
    let currentTopic: Topic | null = null;
    let topicIndex = 0;

    // 简单策略：每 5 分钟或检测到主题变化时分块
    const TOPIC_DURATION = 5 * 60 * 1000;  // 5 分钟

    for (const seg of segments) {
      if (!currentTopic || seg.startMs - currentTopic.startMs > TOPIC_DURATION) {
        // 结束当前主题
        if (currentTopic) {
          currentTopic.endMs = seg.startMs;
          topics.push(currentTopic);
        }

        // 开始新主题
        topicIndex++;
        currentTopic = {
          id: `topic-${topicIndex}`,
          title: `主题 ${topicIndex}`,
          startMs: seg.startMs,
          endMs: seg.endMs,
          segmentIds: [seg.id],
        };
      } else {
        // 继续当前主题
        currentTopic.endMs = seg.endMs;
        currentTopic.segmentIds.push(seg.id);
      }
    }

    // 添加最后一个主题
    if (currentTopic) {
      topics.push(currentTopic);
    }

    return topics;
  },

  /**
   * 获取断点附近的上下文
   */
  getAnchorContext(
    timeline: ClassTimeline,
    anchor: Anchor,
    beforeMs: number = 60000,
    afterMs: number = 30000
  ): TimelineSegment[] {
    const startMs = Math.max(0, anchor.timestamp - beforeMs);
    const endMs = anchor.timestamp + afterMs;

    return timeline.segments.filter(
      seg => seg.endMs >= startMs && seg.startMs <= endMs
    );
  },

  /**
   * 获取困惑热区（教师端用）
   */
  getConfusionHotspots(timeline: ClassTimeline): Array<{
    startMs: number;
    endMs: number;
    count: number;
    anchors: Anchor[];
  }> {
    // 按 30 秒分桶统计断点
    const BUCKET_SIZE = 30000;
    const buckets = new Map<number, Anchor[]>();

    for (const anchor of timeline.anchors) {
      const bucketKey = Math.floor(anchor.timestamp / BUCKET_SIZE) * BUCKET_SIZE;
      const bucket = buckets.get(bucketKey) || [];
      bucket.push(anchor);
      buckets.set(bucketKey, bucket);
    }

    // 转换为热区数组
    return Array.from(buckets.entries())
      .map(([startMs, anchors]) => ({
        startMs,
        endMs: startMs + BUCKET_SIZE,
        count: anchors.length,
        anchors,
      }))
      .filter(h => h.count > 0)
      .sort((a, b) => b.count - a.count);  // 按热度排序
  },

  /**
   * 保存时间轴到本地存储
   */
  save(timeline: ClassTimeline): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`meetmind_timeline_${timeline.lessonId}`, JSON.stringify(timeline));
  },

  /**
   * 从本地存储加载时间轴
   */
  load(lessonId: string): ClassTimeline | null {
    if (typeof window === 'undefined') return null;
    try {
      const data = localStorage.getItem(`meetmind_timeline_${lessonId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },
};
