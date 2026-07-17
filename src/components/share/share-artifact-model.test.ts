import { describe, expect, it } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import {
  buildSharedArtifactSnapshot,
  isShareableArtifactAppKey,
} from './share-artifact-model';

const result: AppExecutionResult = {
  pluginId: 'mindmap-outline',
  version: '1',
  cards: [],
  tasks: [],
  trace: [],
  render: {
    mode: 'mindmap',
    title: '线性代数知识结构',
    payload: { root: { title: '向量空间' } },
  },
};

const transcript: TranscriptSegment[] = [
  { id: '1', text: '向量空间需要满足封闭性。', startMs: 1_000, endMs: 4_000, confidence: 0.95, isFinal: true },
  { id: '2', text: '接着讨论基与维数。', startMs: 6_000, endMs: 9_000, confidence: 0.94, isFinal: true },
];

describe('share artifact model', () => {
  it('only exposes scene-level artifacts as shareable', () => {
    expect(isShareableArtifactAppKey('mindmap')).toBe(true);
    expect(isShareableArtifactAppKey('quiz')).toBe(true);
    expect(isShareableArtifactAppKey('flashcards')).toBe(false);
    expect(isShareableArtifactAppKey('audio-overview')).toBe(false);
  });

  it('builds a grounded snapshot without leaking identifier-like nicknames', () => {
    const snapshot = buildSharedArtifactSnapshot({
      appKey: 'mindmap',
      result,
      transcript,
      courseTitle: '线性代数',
      nickname: '13800138000',
      summary: '这一节讨论向量空间、基与维数。',
    });

    expect(snapshot.title).toBe('线性代数');
    expect(snapshot.artifactKind).toBe('mindmap');
    expect(snapshot.sharerNickname).toBeUndefined();
    expect(snapshot.transcriptDigest.totalSec).toBe(9);
    expect(snapshot.transcriptDigest.segments).toHaveLength(2);
    expect(snapshot.artifact?.payload).toEqual({ root: { title: '向量空间' } });
  });

  it('uses the artifact title when the lesson title is only a placeholder', () => {
    const snapshot = buildSharedArtifactSnapshot({
      appKey: 'mindmap',
      result,
      transcript: [],
      courseTitle: '课堂录音',
    });

    expect(snapshot.title).toBe('线性代数知识结构');
  });
});
