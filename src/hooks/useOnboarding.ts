'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getPreference, setPreference } from '@/lib/db';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  spotlight?: boolean;
  action?: 'click' | 'wait' | 'auto';
  delay?: number;
  // true 表示需要用户点击目标元素触发下一步
  interactive?: boolean;
}

export interface OnboardingFlow {
  id: string;
  name: string;
  steps: OnboardingStep[];
  trigger: 'first-visit' | 'manual' | 'feature-first-use';
}

export const DESKTOP_ONBOARDING_FLOWS: Record<string, OnboardingFlow> = {
  welcome: {
    id: 'welcome',
    name: '欢迎引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'welcome-intro',
        title: '欢迎使用 MeetMind',
        description: '你的专属 AI 同学，让课堂学习更高效。',
        position: 'center',
        action: 'click',
      },
    ],
  },

  recording: {
    id: 'recording',
    name: '录音引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'record-button',
        title: '1/4 开始录音',
        description: '点击录音按钮开始记录课堂内容，系统会实时转写。',
        targetSelector: '[data-onboarding="record-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'video-import',
        title: '2/4 视频导入',
        description: '支持通过视频链接导入课堂内容，快速进入复习流程。',
        targetSelector: '[data-testid="source-video-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'support-source',
        title: '3/4 增强资料',
        description: '可上传 PDF、DOCX、文本等作为增强上下文，提升答疑与转写效果。',
        targetSelector: '[data-testid="source-support-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'mode-switch',
        title: '4/4 录音与复习',
        description: '录音后切到复习模式，查看转录、困惑点并与 AI 互动。',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
    ],
  },

  review: {
    id: 'review',
    name: '复习引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'timeline',
        title: '1/3 功能标签',
        description: '在这里切换时间轴、困惑点、精选和摘要等复习视图。',
        targetSelector: '[data-onboarding="timeline"]',
        position: 'right',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
      {
        id: 'ai-tutor',
        title: '2/3 AI 家教',
        description: '你可以针对课堂内容随时提问，AI 会结合上下文回答。',
        targetSelector: '[data-onboarding="ai-tutor"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
      {
        id: 'action-list',
        title: '3/3 行动清单',
        description: '系统会自动生成学习任务，帮助你快速进入下一步练习。',
        targetSelector: '[data-onboarding="action-list"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },

  workshop: {
    id: 'workshop',
    name: 'AI工坊引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'review-apps-tab',
        title: '1/3 打开 AI 工坊',
        description: '在复习区切换到 AI 工坊，进入应用黄页。',
        targetSelector: '[data-onboarding="review-apps-tab"]',
        position: 'right',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'workshop-generate-all',
        title: '2/3 后台并行生成',
        description: '可一键后台生成多个应用结果，不打断当前复习与对话。',
        targetSelector: '[data-onboarding="workshop-generate-all"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
      {
        id: 'workshop-dock-toggle',
        title: '3/3 任务中心管理',
        description: '在任务中心查看进度、取消、重试并打开结果。',
        targetSelector: '[data-onboarding="workshop-dock-toggle"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },

  'video-review': {
    id: 'video-review',
    name: '视频回放引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'learning-track',
        title: '1/1 学习时间轴',
        description: '学习时间轴用于字幕同步和困惑点定位，不替代上方平台原生进度条。',
        targetSelector: '[data-onboarding="learning-track"]',
        position: 'top',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },
};

export const MOBILE_ONBOARDING_FLOWS: Record<string, OnboardingFlow> = {
  welcome: {
    id: 'welcome',
    name: '欢迎引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'welcome-intro',
        title: '欢迎使用 MeetMind',
        description: '你的专属 AI 同学，让课堂学习更高效。',
        position: 'center',
        action: 'click',
      },
    ],
  },

  recording: {
    id: 'recording',
    name: '录音引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'record-button',
        title: '1/4 开始录音',
        description: '点击录音按钮开始记录课堂内容，系统会实时转写。',
        targetSelector: '[data-onboarding="record-button"]',
        position: 'top',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'video-import',
        title: '2/4 视频导入',
        description: '支持通过视频链接导入课堂内容，快速进入复习流程。',
        targetSelector: '[data-testid="source-video-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'support-source',
        title: '3/4 增强资料',
        description: '可上传 PDF、DOCX、文本等作为增强上下文，提升答疑与转写效果。',
        targetSelector: '[data-testid="source-support-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'mode-switch',
        title: '4/4 录音与复习',
        description: '录音后切到复习模式，查看转录、困惑点并与 AI 互动。',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
    ],
  },

  review: {
    id: 'review',
    name: '复习引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'ai-fab',
        title: '1/2 AI 助教',
        description: '点击这里可以针对当前课程随时向 AI 提问。',
        targetSelector: '[data-onboarding="ai-fab"]',
        position: 'top',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
      {
        id: 'menu-button',
        title: '2/2 更多功能',
        description: '通过菜单可以查看精选片段、摘要和其他复习入口。',
        targetSelector: '[data-onboarding="menu-button"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },

  workshop: {
    id: 'workshop',
    name: 'AI工坊引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'menu-button-workshop',
        title: '1/3 打开菜单',
        description: '先打开菜单面板，进入 AI 工坊入口。',
        targetSelector: '[data-onboarding="menu-button"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'menu-apps-item',
        title: '2/3 进入 AI 工坊',
        description: '点击菜单里的 AI 工坊，查看可用学习应用。',
        targetSelector: '[data-onboarding="menu-apps"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: true,
      },
      {
        id: 'mobile-workshop-panel',
        title: '3/3 使用工坊应用',
        description: '在这里可后台生成应用结果并继续学习。',
        targetSelector: '[data-onboarding="mobile-workshop-panel"]',
        position: 'top',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },

  'video-review': {
    id: 'video-review',
    name: '视频回放引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'learning-track',
        title: '1/1 学习时间轴',
        description: '学习时间轴用于字幕同步和困惑点定位，建议先展开看一遍。',
        targetSelector: '[data-onboarding="learning-track"]',
        position: 'top',
        spotlight: true,
        action: 'click',
        interactive: false,
      },
    ],
  },
};

export const ONBOARDING_FLOWS = DESKTOP_ONBOARDING_FLOWS;

export function getOnboardingFlows(isMobile: boolean): Record<string, OnboardingFlow> {
  return isMobile ? MOBILE_ONBOARDING_FLOWS : DESKTOP_ONBOARDING_FLOWS;
}

const ONBOARDING_STATE_KEY = 'onboarding_state';
const ONBOARDING_IN_PROGRESS_MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours

interface OnboardingState {
  completedFlows: string[];
  skippedFlows: string[];
  currentFlow: string | null;
  currentStepIndex: number;
  lastUpdated: number;
}

const DEFAULT_STATE: OnboardingState = {
  completedFlows: [],
  skippedFlows: [],
  currentFlow: null,
  currentStepIndex: 0,
  lastUpdated: Date.now(),
};

function sanitizeState(
  rawState: OnboardingState | null | undefined,
  flows: Record<string, OnboardingFlow>
): OnboardingState {
  if (!rawState || typeof rawState !== 'object') {
    return { ...DEFAULT_STATE, lastUpdated: Date.now() };
  }

  const completedFlows = Array.from(
    new Set((rawState.completedFlows || []).filter((id) => typeof id === 'string' && Boolean(flows[id])))
  );
  const skippedFlows = Array.from(
    new Set((rawState.skippedFlows || []).filter((id) => typeof id === 'string' && Boolean(flows[id])))
  );

  const hasValidCurrentFlow =
    typeof rawState.currentFlow === 'string' &&
    Boolean(flows[rawState.currentFlow]) &&
    !completedFlows.includes(rawState.currentFlow) &&
    !skippedFlows.includes(rawState.currentFlow);

  const lastUpdated = Number.isFinite(rawState.lastUpdated)
    ? Number(rawState.lastUpdated)
    : Date.now();

  const isInProgressStateStale =
    hasValidCurrentFlow && Date.now() - lastUpdated > ONBOARDING_IN_PROGRESS_MAX_AGE_MS;

  if (!hasValidCurrentFlow || isInProgressStateStale) {
    return {
      completedFlows,
      skippedFlows,
      currentFlow: null,
      currentStepIndex: 0,
      lastUpdated: Date.now(),
    };
  }

  const currentFlowId = rawState.currentFlow as string;
  const stepLength = flows[currentFlowId]?.steps.length || 0;
  const safeStepIndex = Number.isFinite(rawState.currentStepIndex)
    ? Math.max(0, Math.min(Number(rawState.currentStepIndex), Math.max(0, stepLength - 1)))
    : 0;

  return {
    completedFlows,
    skippedFlows,
    currentFlow: currentFlowId,
    currentStepIndex: safeStepIndex,
    lastUpdated,
  };
}

export interface UseOnboardingOptions {
  isMobile?: boolean;
}

export function useOnboarding(options: UseOnboardingOptions = {}) {
  const { isMobile = false } = options;

  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const stateRef = useRef(state);

  const flows = useMemo(() => getOnboardingFlows(isMobile), [isMobile]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await getPreference<OnboardingState>(ONBOARDING_STATE_KEY, DEFAULT_STATE);
        const sanitized = sanitizeState(saved, flows);
        setState(sanitized);
        stateRef.current = sanitized;
        setIsActive(Boolean(sanitized.currentFlow));
      } catch (err) {
        console.error('Failed to load onboarding state:', err);
      } finally {
        setIsHydrated(true);
      }
    };

    void loadState();
  }, [flows]);

  const saveState = useCallback(async (newState: OnboardingState) => {
    setState(newState);
    stateRef.current = newState;
    try {
      await setPreference(ONBOARDING_STATE_KEY, newState);
    } catch (err) {
      console.error('Failed to save onboarding state:', err);
    }
  }, []);

  const shouldShowFlow = useCallback((flowId: string): boolean => {
    if (!isHydrated) return false;
    const s = stateRef.current;
    if (!flows[flowId]) return false;
    return !s.completedFlows.includes(flowId) && !s.skippedFlows.includes(flowId);
  }, [flows, isHydrated]);

  const completeFlow = useCallback(() => {
    const s = stateRef.current;
    const flowToComplete = s.currentFlow;

    setIsActive(false);

    if (!flowToComplete) return;

    saveState({
      ...s,
      completedFlows: s.completedFlows.includes(flowToComplete)
        ? s.completedFlows
        : [...s.completedFlows, flowToComplete],
      currentFlow: null,
      currentStepIndex: 0,
      lastUpdated: Date.now(),
    });
  }, [saveState]);

  const skipFlow = useCallback(() => {
    const s = stateRef.current;
    const flowToSkip = s.currentFlow;

    setIsActive(false);

    if (!flowToSkip) return;

    saveState({
      ...s,
      skippedFlows: s.skippedFlows.includes(flowToSkip)
        ? s.skippedFlows
        : [...s.skippedFlows, flowToSkip],
      currentFlow: null,
      currentStepIndex: 0,
      lastUpdated: Date.now(),
    });
  }, [saveState]);

  const markFlowComplete = useCallback((flowId: string) => {
    const s = stateRef.current;
    if (!flows[flowId] || s.completedFlows.includes(flowId)) return;

    saveState({
      ...s,
      completedFlows: [...s.completedFlows, flowId],
      lastUpdated: Date.now(),
    });
  }, [saveState, flows]);

  const markFlowSkipped = useCallback((flowId: string) => {
    const s = stateRef.current;
    if (!flows[flowId] || s.skippedFlows.includes(flowId)) return;

    saveState({
      ...s,
      skippedFlows: [...s.skippedFlows, flowId],
      lastUpdated: Date.now(),
    });
  }, [saveState, flows]);

  const startFlow = useCallback((flowId: string) => {
    if (!isHydrated) return;

    const flow = flows[flowId];
    if (!flow) {
      console.warn(`Onboarding flow "${flowId}" not found`);
      return;
    }

    const s = stateRef.current;
    if (s.completedFlows.includes(flowId) || s.skippedFlows.includes(flowId)) {
      return;
    }

    if (s.currentFlow === flowId) {
      setIsActive(true);
      return;
    }

    setIsActive(true);

    saveState({
      ...s,
      currentFlow: flowId,
      currentStepIndex: 0,
      lastUpdated: Date.now(),
    });
  }, [saveState, flows, isHydrated]);

  const nextStep = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentFlow) return;

    const flow = flows[s.currentFlow];
    if (!flow) return;

    const nextIndex = s.currentStepIndex + 1;
    if (nextIndex >= flow.steps.length) {
      completeFlow();
      return;
    }

    saveState({
      ...s,
      currentStepIndex: nextIndex,
      lastUpdated: Date.now(),
    });
  }, [saveState, completeFlow, flows]);

  const resetAll = useCallback(() => {
    setIsActive(false);
    void saveState({ ...DEFAULT_STATE, lastUpdated: Date.now() });
  }, [saveState]);

  const currentStep = state.currentFlow
    ? flows[state.currentFlow]?.steps[state.currentStepIndex] ?? null
    : null;

  const currentFlow = state.currentFlow
    ? flows[state.currentFlow] ?? null
    : null;

  const totalSteps = currentFlow?.steps.length || 0;

  return {
    isLoading: !isHydrated,
    isHydrated,
    isActive,
    isMobile,
    currentFlow,
    currentStep,
    currentStepIndex: state.currentStepIndex,
    totalSteps,
    shouldShowFlow,
    startFlow,
    nextStep,
    completeFlow,
    skipFlow,
    markFlowComplete,
    markFlowSkipped,
    resetAll,
  };
}
