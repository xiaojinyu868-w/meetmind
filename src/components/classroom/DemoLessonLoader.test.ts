import { describe, expect, it, vi } from 'vitest';
import { DEMO_ANCHORS, DEMO_AUDIO_URL, DEMO_SEGMENTS } from '@/fixtures/demo-data';
import { loadDemoLesson } from './DemoLessonLoader';
import type { CaptureEditorStore } from '@/stores/capture-editor-store';

describe('loadDemoLesson', () => {
  it('hydrates the full demo classroom scene, not only transcript text', () => {
    const actions = {
      resetCaptureEditorState: vi.fn(),
      setSegments: vi.fn(),
      setAnchors: vi.fn(),
      setTimeline: vi.fn(),
      setAudioUrl: vi.fn(),
    } as unknown as CaptureEditorStore['actions'];

    loadDemoLesson({ actions });

    expect(actions.resetCaptureEditorState).toHaveBeenCalledOnce();
    expect(actions.setSegments).toHaveBeenCalledWith(DEMO_SEGMENTS);
    expect(actions.setAnchors).toHaveBeenCalledWith(DEMO_ANCHORS);
    expect(actions.setTimeline).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'demo-session' }));
    expect(actions.setAudioUrl).toHaveBeenCalledWith(DEMO_AUDIO_URL);
  });
});
