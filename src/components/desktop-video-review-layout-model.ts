export type ReviewPaneMode = 'video' | 'audio';
export type ReviewPaneDivider = 'source-workspace' | 'workspace-tutor';
export type CollapsibleReviewPane = 'workspace' | 'tutor';

export interface ReviewPaneLayout {
  source: number;
  workspace: number;
  tutor: number;
  workspaceCollapsed: boolean;
  tutorCollapsed: boolean;
}

const DEFAULTS: Record<ReviewPaneMode, ReviewPaneLayout> = {
  // 视频仍以原件为根，但要给中间学习区留下可完成任务的宽度。
  video: { source: 46, workspace: 34, tutor: 20, workspaceCollapsed: false, tutorCollapsed: false },
  // 音频证据以波形 + 转录为主，中间学习区是课后首要工作面。
  audio: { source: 27, workspace: 49, tutor: 24, workspaceCollapsed: false, tutorCollapsed: false },
};

const SOURCE_MIN: Record<ReviewPaneMode, number> = {
  video: 38,
  audio: 22,
};
const WORKSPACE_MIN = 26;
const TUTOR_MIN = 18;
const WORKSPACE_COLLAPSE_AT = 18;
const TUTOR_COLLAPSE_AT = 18;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalize(layout: ReviewPaneLayout, mode: ReviewPaneMode): ReviewPaneLayout {
  const next = { ...layout };

  if (next.workspaceCollapsed) next.workspace = 0;
  if (next.tutorCollapsed) next.tutor = 0;

  const sourceMin = SOURCE_MIN[mode];
  next.source = Math.max(sourceMin, next.source);

  if (!next.workspaceCollapsed) next.workspace = Math.max(WORKSPACE_MIN, next.workspace);
  if (!next.tutorCollapsed) next.tutor = Math.max(TUTOR_MIN, next.tutor);

  const total = next.source + next.workspace + next.tutor;
  if (total <= 0) return getDefaultReviewPaneLayout(mode);

  next.source = round((next.source / total) * 100);
  next.workspace = round((next.workspace / total) * 100);
  next.tutor = round(Math.max(0, 100 - next.source - next.workspace));

  return next;
}

export function getDefaultReviewPaneLayout(mode: ReviewPaneMode): ReviewPaneLayout {
  return { ...DEFAULTS[mode] };
}

export function applyReviewPaneDrag(
  layout: ReviewPaneLayout,
  divider: ReviewPaneDivider,
  deltaPercent: number,
  mode: ReviewPaneMode,
): ReviewPaneLayout {
  const next = { ...layout };

  if (divider === 'source-workspace') {
    next.source += deltaPercent;
    next.workspace -= deltaPercent;
    if (next.workspace < WORKSPACE_COLLAPSE_AT) {
      next.source += Math.max(0, next.workspace);
      next.workspace = 0;
      next.workspaceCollapsed = true;
    }
  } else {
    next.workspace += deltaPercent;
    next.tutor -= deltaPercent;
    if (next.tutor < TUTOR_COLLAPSE_AT) {
      next.workspace += Math.max(0, next.tutor);
      next.tutor = 0;
      next.tutorCollapsed = true;
    }
  }

  return normalize(next, mode);
}

export function restoreReviewPane(
  layout: ReviewPaneLayout,
  pane: CollapsibleReviewPane,
  mode: ReviewPaneMode,
): ReviewPaneLayout {
  const defaults = getDefaultReviewPaneLayout(mode);
  if (pane === 'workspace') {
    return normalize({ ...defaults, tutorCollapsed: layout.tutorCollapsed }, mode);
  }
  return normalize({ ...defaults, workspaceCollapsed: layout.workspaceCollapsed }, mode);
}

export function toReviewCurrentTimeSec(currentTimeMs: number): number {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs <= 0) return 0;
  return Math.floor(currentTimeMs / 1000);
}
