import { deletePreference, getPreference, setPreference } from '@/lib/db';
import type { Anchor, TranscriptSegment } from '@/types';

export interface TimelineSegment extends TranscriptSegment {
  anchors: Anchor[];
  type: 'lecture' | 'qa' | 'exercise';
}

export interface ClassTimeline {
  id: string;
  lessonId: string;
  date: string;
  subject: string;
  teacher: string;
  duration: number;
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

const TIMELINE_PREF_PREFIX = 'timeline:';
const timelineCache = new Map<string, ClassTimeline>();

function timelineKey(lessonId: string): string {
  return `${TIMELINE_PREF_PREFIX}${lessonId}`;
}

export const memoryService = {
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
    const timelineSegments: TimelineSegment[] = segments.map((segment) => ({
      ...segment,
      anchors: anchors.filter((anchor) => !anchor.cancelled && anchor.timestamp >= segment.startMs && anchor.timestamp <= segment.endMs),
      type: this.inferSegmentType(segment.text),
    }));

    const duration = segments.length > 0 ? segments[segments.length - 1].endMs : 0;

    return {
      id: `timeline-${lessonId}`,
      lessonId,
      date: metadata.date,
      subject: metadata.subject,
      teacher: metadata.teacher,
      duration,
      segments: timelineSegments,
      anchors: anchors.filter((anchor) => !anchor.cancelled),
    };
  },

  inferSegmentType(text: string): 'lecture' | 'qa' | 'exercise' {
    if (text.includes('？') || text.includes('?') || text.includes('问')) return 'qa';
    if (text.includes('练习') || text.includes('做一个') || text.includes('试试')) return 'exercise';
    return 'lecture';
  },

  extractTopics(segments: TimelineSegment[]): Topic[] {
    if (segments.length === 0) return [];
    const topics: Topic[] = [];
    let currentTopic: Topic | null = null;
    let topicIndex = 0;
    const TOPIC_DURATION = 5 * 60 * 1000;

    for (const segment of segments) {
      if (!currentTopic || segment.startMs - currentTopic.startMs > TOPIC_DURATION) {
        if (currentTopic) {
          currentTopic.endMs = segment.startMs;
          topics.push(currentTopic);
        }
        topicIndex += 1;
        currentTopic = {
          id: `topic-${topicIndex}`,
          title: `主题 ${topicIndex}`,
          startMs: segment.startMs,
          endMs: segment.endMs,
          segmentIds: [segment.id],
        };
      } else {
        currentTopic.endMs = segment.endMs;
        currentTopic.segmentIds.push(segment.id);
      }
    }

    if (currentTopic) topics.push(currentTopic);
    return topics;
  },

  getAnchorContext(
    timeline: ClassTimeline,
    anchor: Anchor,
    beforeMs: number = 60000,
    afterMs: number = 30000
  ): TimelineSegment[] {
    const startMs = Math.max(0, anchor.timestamp - beforeMs);
    const endMs = anchor.timestamp + afterMs;
    return timeline.segments.filter((segment) => segment.endMs >= startMs && segment.startMs <= endMs);
  },

  getConfusionHotspots(timeline: ClassTimeline): Array<{ startMs: number; endMs: number; count: number; anchors: Anchor[] }> {
    const BUCKET_SIZE = 30000;
    const buckets = new Map<number, Anchor[]>();
    for (const anchor of timeline.anchors) {
      const bucketKey = Math.floor(anchor.timestamp / BUCKET_SIZE) * BUCKET_SIZE;
      const bucket = buckets.get(bucketKey) || [];
      bucket.push(anchor);
      buckets.set(bucketKey, bucket);
    }
    return Array.from(buckets.entries())
      .map(([startMs, bucketAnchors]) => ({
        startMs,
        endMs: startMs + BUCKET_SIZE,
        count: bucketAnchors.length,
        anchors: bucketAnchors,
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  save(timeline: ClassTimeline): void {
    timelineCache.set(timeline.lessonId, timeline);
    void setPreference(timelineKey(timeline.lessonId), timeline).catch(() => undefined);
  },

  load(lessonId: string): ClassTimeline | null {
    const cached = timelineCache.get(lessonId);
    if (cached) return cached;
    void getPreference<ClassTimeline | null>(timelineKey(lessonId), null)
      .then((timeline) => {
        if (!timeline) return;
        timelineCache.set(lessonId, timeline);
      })
      .catch(() => undefined);
    return null;
  },

  delete(lessonId: string): void {
    timelineCache.delete(lessonId);
    void deletePreference(timelineKey(lessonId)).catch(() => undefined);
  },
};
