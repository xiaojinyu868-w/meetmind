import { describe, expect, it } from 'vitest';
import {
  applyReviewPaneDrag,
  getDefaultReviewPaneLayout,
  restoreReviewPane,
  toReviewCurrentTimeSec,
} from './desktop-video-review-layout-model';

describe('desktop video review layout model', () => {
  it('converts player milliseconds into tutor agent seconds', () => {
    expect(toReviewCurrentTimeSec(65_432)).toBe(65);
  });

  it('keeps invalid or negative player time from polluting tutor context', () => {
    expect(toReviewCurrentTimeSec(-1200)).toBe(0);
    expect(toReviewCurrentTimeSec(Number.NaN)).toBe(0);
  });

  it('gives video review a source-first default layout so the video remains watchable', () => {
    const layout = getDefaultReviewPaneLayout('video');
    expect(layout.source).toBeGreaterThan(layout.workspace);
    expect(layout.source).toBeGreaterThan(layout.tutor);
    expect(layout.source).toBeGreaterThanOrEqual(48);
  });

  it('collapses the tutor pane when the right divider squeezes it below threshold', () => {
    const layout = applyReviewPaneDrag(getDefaultReviewPaneLayout('video'), 'workspace-tutor', 12, 'video');
    expect(layout.tutorCollapsed).toBe(true);
    expect(layout.workspace).toBeGreaterThan(getDefaultReviewPaneLayout('video').workspace);
  });

  it('collapses the workspace pane before allowing the source evidence pane to become unreadable', () => {
    const layout = applyReviewPaneDrag(getDefaultReviewPaneLayout('video'), 'source-workspace', 28, 'video');
    expect(layout.workspaceCollapsed).toBe(true);
    expect(layout.source).toBeGreaterThanOrEqual(70);
  });

  it('restores a collapsed pane to the mode default', () => {
    const collapsed = applyReviewPaneDrag(getDefaultReviewPaneLayout('video'), 'workspace-tutor', 12, 'video');
    expect(restoreReviewPane(collapsed, 'tutor', 'video')).toMatchObject({ tutorCollapsed: false, tutor: 22 });
  });
});
