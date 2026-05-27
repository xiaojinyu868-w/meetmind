# Post-Class Three-Pane Learning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn video and audio post-class review into a shared three-pane experience: left evidence, middle learning workspace, right tutor reflection.

**Architecture:** Keep existing review route and app execution primitives. Move structured products out of chat bubbles into the middle workspace. Middle workspace and right-side Tutor communicate through a small review learning blackboard: Tutor and apps write lightweight natural-language notes about what happened in the learning scene; Tutor reads the formatted snapshot as context. The blackboard must not contain model-facing directives such as “if/should/remind/suggest”. Reuse `AppRenderSurface` for app rendering and `app_workspace_result:*` cache for continuity.

**Tech Stack:** Next.js/React, Zustand stores, AI SDK `TutorAgentPanel`, existing Workshop app plugins/renderers, Vitest.

---

### Task 1: Shared review workspace app surface

**Files:**
- Create: `src/components/ReviewLearningWorkspace.tsx`
- Modify: `src/components/SharedWorkspacePanel.tsx`
- Test: `src/components/review-learning-activity.test.ts`
- Test: `src/components/review-learning-blackboard.test.ts`

Steps:
1. Add a small pure formatter for learning activity events and verify it with Vitest.
2. Create `ReviewLearningWorkspace` that renders either `WorkshopYellowPage` or a selected `AppRenderSurface` in the middle pane.
3. Use `useAppExecution` so selected apps auto-run and reuse cache.

### Task 2: Tutor marker routes to middle workspace

**Files:**
- Modify: `src/components/tutor/TutorAgentPanel.tsx`
- Modify: `src/components/SafeAITutor.tsx`
- Modify: `src/components/tutor/tutor-types.ts`

Steps:
1. Add `onOpenAppInWorkspace(appKey)` prop.
2. When review Tutor sees `<open_app:KEY/>`, call the parent callback instead of rendering a full inline card.
3. Keep old inline card path as fallback when no parent callback exists.

### Task 3: Three-pane desktop review layout

**Files:**
- Modify: `src/components/DesktopVideoReviewLayout.tsx`
- Modify: `src/app/(main)/app/page.tsx`

Steps:
1. Video review: left video/timeline, middle transcript/confusion/apps workspace, right Tutor.
2. Audio review: left waveform/timeline/anchor detail, middle apps workspace, right Tutor.
3. App open events set the middle workspace to apps and select the requested app.

### Task 4: Learning activity context

**Files:**
- Modify: `src/components/apps/windows/AppRenderSurface.tsx`
- Modify: `src/components/apps/windows/QuizWindow.tsx`
- Modify: `src/components/apps/windows/FlashcardsWindow.tsx`
- Modify: `src/components/SafeAITutor.tsx`

Steps:
1. Quiz/flashcards emit compact factual notes when user answers/scores/completes.
2. Desktop layout writes app-open facts and app activity notes into `review-learning-blackboard` instead of passing raw component-local lines directly.
3. Tutor reads the formatted blackboard snapshot as learning-scene context; the blackboard itself does not tell the model what to say next.

### Task 5: Docs and verification

**Files:**
- Modify: `src/components/DOMAIN.md`
- Modify: `src/components/tutor/DOMAIN.md`
- Modify: `AGENTS.md`

Commands:
- `npx vitest run src/components/review-learning-blackboard.test.ts src/components/review-learning-activity.test.ts src/components/tutor/tutor-inline-app-cache.test.ts`
- `make check`
- `make deploy`
