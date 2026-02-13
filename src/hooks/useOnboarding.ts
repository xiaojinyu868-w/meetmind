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
        title: '1/3 开始录音',
        description: '点击录音按钮开始记录课堂内容，系统会实时转写。',
        targetSelector: '[data-onboarding="record-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'input-method',
        title: '2/3 输入方式',
        description: '你也可以上传音频或使用历史会话继续学习。',
        targetSelector: '[data-onboarding="input-methods"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'mode-switch',
        title: '3/3 录音与复习',
        description: '录音后切到复习模式，查看转录、困惑点并与 AI 互动。',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
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
        title: '1/3 开始录音',
        description: '点击录音按钮开始记录课堂内容，系统会实时转写。',
        targetSelector: '[data-onboarding="record-button"]',
        position: 'top',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'input-method',
        title: '2/3 输入方式',
        description: '你也可以上传音频或使用历史会话继续学习。',
        targetSelector: '[data-onboarding="input-methods"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'mode-switch',
        title: '3/3 录音与复习',
        description: '录音后切到复习模式，查看转录、困惑点并与 AI 互动。',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
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
        if (saved) {
          setState(saved);
          stateRef.current = saved;
        }
      } catch (err) {
        console.error('Failed to load onboarding state:', err);
      } finally {
        setIsHydrated(true);
      }
    };

    void loadState();
  }, []);

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
    const s = stateRef.current;
    if (!flows[flowId]) return false;
    return !s.completedFlows.includes(flowId) && !s.skippedFlows.includes(flowId);
  }, [flows]);

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
    const flow = flows[flowId];
    if (!flow) {
      console.warn(`Onboarding flow "${flowId}" not found`);
      return;
    }

    const s = stateRef.current;
    setIsActive(true);

    saveState({
      ...s,
      currentFlow: flowId,
      currentStepIndex: 0,
      lastUpdated: Date.now(),
    });
  }, [saveState, flows]);

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
    isLoading: false,
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