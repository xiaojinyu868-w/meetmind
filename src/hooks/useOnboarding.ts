'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPreference, setPreference } from '@/lib/db';

// 引导步骤定义
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  spotlight?: boolean;
  action?: 'click' | 'wait' | 'auto';
  delay?: number;
}

// 引导流程定义
export interface OnboardingFlow {
  id: string;
  name: string;
  steps: OnboardingStep[];
  trigger: 'first-visit' | 'manual' | 'feature-first-use';
}

// 预定义的引导流程
export const ONBOARDING_FLOWS: Record<string, OnboardingFlow> = {
  welcome: {
    id: 'welcome',
    name: '欢迎引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'welcome-intro',
        title: '欢迎使用 MeetMind',
        description: '你的专属 AI 同桌，让课堂学习更高效',
        position: 'center',
        action: 'click',
      },
    ],
  },
  
  // 首次进入录音页面的引导（3步）
  recording: {
    id: 'recording',
    name: '录音引导',
    trigger: 'first-visit',
    steps: [
      {
        id: 'record-button',
        title: '1/3 开始录音',
        description: '点击红色按钮开始录制课堂内容，AI 会实时将语音转换为文字',
        targetSelector: '[data-onboarding="record-button"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'input-method',
        title: '2/3 多种输入方式',
        description: '除了实时录音，你还可以上传已有的音频文件，或查看历史录音记录',
        targetSelector: '[data-onboarding="input-methods"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'mode-switch',
        title: '3/3 录音与复习',
        description: '录音完成后切换到「复习」模式，可以回放音频、查看转录、与 AI 对话',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
    ],
  },
  
  // 复习模式引导（首次进入复习时触发）
  review: {
    id: 'review',
    name: '复习引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'timeline',
        title: '课堂时间轴',
        description: '这里展示课堂内容的时间轴，点击可跳转到对应位置',
        targetSelector: '[data-onboarding="timeline"]',
        position: 'right',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'ai-tutor',
        title: 'AI 家教',
        description: '有问题随时问 AI，它会根据课堂内容为你解答',
        targetSelector: '[data-onboarding="ai-tutor"]',
        position: 'left',
        spotlight: true,
        action: 'click',
      },
    ],
  },
};

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

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const stateRef = useRef(state);
  
  // 保持 ref 同步
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 加载状态
  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await getPreference<OnboardingState>(ONBOARDING_STATE_KEY);
        if (saved) {
          setState(saved);
          stateRef.current = saved;
        }
      } catch (err) {
        console.error('Failed to load onboarding state:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, []);

  // 保存状态
  const saveState = useCallback(async (newState: OnboardingState) => {
    setState(newState);
    stateRef.current = newState;
    try {
      await setPreference(ONBOARDING_STATE_KEY, newState);
    } catch (err) {
      console.error('Failed to save onboarding state:', err);
    }
  }, []);

  // 检查是否需要显示某个引导流程
  const shouldShowFlow = useCallback((flowId: string): boolean => {
    const s = stateRef.current;
    return !s.completedFlows.includes(flowId) && !s.skippedFlows.includes(flowId);
  }, []);

  // 完成当前流程
  const completeFlow = useCallback(() => {
    const s = stateRef.current;
    const flowToComplete = s.currentFlow;
    
    setIsActive(false);
    
    if (flowToComplete) {
      saveState({
        ...s,
        completedFlows: [...s.completedFlows, flowToComplete],
        currentFlow: null,
        currentStepIndex: 0,
        lastUpdated: Date.now(),
      });
    }
  }, [saveState]);

  // 跳过当前流程
  const skipFlow = useCallback(() => {
    const s = stateRef.current;
    const flowToSkip = s.currentFlow;
    
    setIsActive(false);
    
    if (flowToSkip) {
      saveState({
        ...s,
        skippedFlows: [...s.skippedFlows, flowToSkip],
        currentFlow: null,
        currentStepIndex: 0,
        lastUpdated: Date.now(),
      });
    }
  }, [saveState]);

  // 开始引导流程
  const startFlow = useCallback((flowId: string) => {
    const flow = ONBOARDING_FLOWS[flowId];
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
  }, [saveState]);

  // 进入下一步
  const nextStep = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentFlow) return;

    const flow = ONBOARDING_FLOWS[s.currentFlow];
    if (!flow) return;

    const nextIndex = s.currentStepIndex + 1;
    
    if (nextIndex >= flow.steps.length) {
      // 流程完成
      completeFlow();
    } else {
      saveState({
        ...s,
        currentStepIndex: nextIndex,
        lastUpdated: Date.now(),
      });
    }
  }, [saveState, completeFlow]);

  // 重置所有引导
  const resetAll = useCallback(() => {
    setIsActive(false);
    saveState(DEFAULT_STATE);
  }, [saveState]);

  // 获取当前步骤
  const currentStep = state.currentFlow 
    ? ONBOARDING_FLOWS[state.currentFlow]?.steps[state.currentStepIndex] 
    : null;

  const currentFlow = state.currentFlow 
    ? ONBOARDING_FLOWS[state.currentFlow] 
    : null;

  const totalSteps = currentFlow?.steps.length || 0;

  return {
    isLoading,
    isActive,
    currentFlow,
    currentStep,
    currentStepIndex: state.currentStepIndex,
    totalSteps,
    shouldShowFlow,
    startFlow,
    nextStep,
    completeFlow,
    skipFlow,
    resetAll,
  };
}
