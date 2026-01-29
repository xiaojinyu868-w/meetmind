'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  /** 是否为交互式步骤（用户点击目标元素进入下一步）
   * - true: 用户需要点击目标元素，元素的原有功能会生效
   * - false: 用户点击"下一步"按钮，不触发元素功能
   * - 默认为 true
   */
  interactive?: boolean;
}

// 引导流程定义
export interface OnboardingFlow {
  id: string;
  name: string;
  steps: OnboardingStep[];
  trigger: 'first-visit' | 'manual' | 'feature-first-use';
}

// 桌面端引导流程
export const DESKTOP_ONBOARDING_FLOWS: Record<string, OnboardingFlow> = {
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
  
  // 复习模式引导（首次进入复习时触发）- 桌面端
  review: {
    id: 'review',
    name: '复习引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'timeline',
        title: '1/3 功能标签栏',
        description: '点击「时间轴」按钮，可以查看课堂内容。还有困惑点、精选、摘要等功能等你探索',
        targetSelector: '[data-onboarding="timeline"]',
        position: 'right',
        spotlight: true,
        action: 'click',
        interactive: true, // 点击真的切换 Tab
      },
      {
        id: 'ai-tutor',
        title: '2/3 AI 家教',
        description: '有问题随时问 AI，它会根据课堂内容为你解答疑惑',
        targetSelector: '[data-onboarding="ai-tutor"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: false, // 点击进入下一步，不触发功能
      },
      {
        id: 'action-list',
        title: '3/3 行动清单',
        description: 'AI 会根据课堂内容生成学习任务，点击查看',
        targetSelector: '[data-onboarding="action-list"]',
        position: 'left',
        spotlight: true,
        action: 'click',
        interactive: true, // 点击真的展开抽屉
      },
    ],
  },
};

// 移动端引导流程 - 针对移动端布局优化
export const MOBILE_ONBOARDING_FLOWS: Record<string, OnboardingFlow> = {
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
  
  // 移动端录音引导（3步）- 适配移动端垂直布局
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
        position: 'top',  // 移动端录音按钮在下方，tooltip 显示在上方
        spotlight: true,
        action: 'click',
      },
      {
        id: 'input-method',
        title: '2/3 多种输入方式',
        description: '除了实时录音，你还可以上传音频文件或查看历史记录',
        targetSelector: '[data-onboarding="input-methods"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
      {
        id: 'mode-switch',
        title: '3/3 录音与复习',
        description: '录音完成后切换到「复习」模式，回放音频、与 AI 对话',
        targetSelector: '[data-onboarding="mode-switch"]',
        position: 'bottom',
        spotlight: true,
        action: 'click',
      },
    ],
  },
  
  // 移动端复习引导 - 引导 AI 对话入口
  review: {
    id: 'review',
    name: '复习引导',
    trigger: 'feature-first-use',
    steps: [
      {
        id: 'ai-fab',
        title: '1/2 AI 助教',
        description: '点这里可以问 AI 任何关于这节课的问题',
        targetSelector: '[data-onboarding="ai-fab"]',
        position: 'top',  // 悬浮按钮在底部，tooltip 在上方
        spotlight: true,
        action: 'click',
        interactive: true, // 点击打开 AI 对话
      },
      {
        id: 'menu-button',
        title: '2/2 更多功能',
        description: '点击菜单查看精选片段、生成摘要等',
        targetSelector: '[data-onboarding="menu-button"]',
        position: 'left',  // 菜单按钮在右上角，tooltip 在左侧
        spotlight: true,
        action: 'click',
        interactive: true, // 点击展开菜单
      },
    ],
  },
};

// 兼容旧代码的导出（默认使用桌面端流程）
export const ONBOARDING_FLOWS = DESKTOP_ONBOARDING_FLOWS;

// 根据设备类型获取引导流程
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

// Hook 配置选项
export interface UseOnboardingOptions {
  isMobile?: boolean;
}

export function useOnboarding(options: UseOnboardingOptions = {}) {
  const { isMobile = false } = options;
  
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const stateRef = useRef(state);
  
  // 根据设备类型获取对应的引导流程
  const flows = useMemo(() => getOnboardingFlows(isMobile), [isMobile]);
  
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

  // 直接标记某个流程为完成（不依赖 currentFlow，用于外部弹窗如 WelcomeModal）
  const markFlowComplete = useCallback((flowId: string) => {
    const s = stateRef.current;
    if (s.completedFlows.includes(flowId)) return; // 已完成则跳过
    
    saveState({
      ...s,
      completedFlows: [...s.completedFlows, flowId],
      lastUpdated: Date.now(),
    });
  }, [saveState]);

  // 直接标记某个流程为跳过（不依赖 currentFlow）
  const markFlowSkipped = useCallback((flowId: string) => {
    const s = stateRef.current;
    if (s.skippedFlows.includes(flowId)) return; // 已跳过则跳过
    
    saveState({
      ...s,
      skippedFlows: [...s.skippedFlows, flowId],
      lastUpdated: Date.now(),
    });
  }, [saveState]);

  // 开始引导流程
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

  // 进入下一步
  const nextStep = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentFlow) return;

    const flow = flows[s.currentFlow];
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
  }, [saveState, completeFlow, flows]);

  // 重置所有引导
  const resetAll = useCallback(() => {
    setIsActive(false);
    saveState(DEFAULT_STATE);
  }, [saveState]);

  // 获取当前步骤（使用设备对应的流程）
  const currentStep = state.currentFlow 
    ? flows[state.currentFlow]?.steps[state.currentStepIndex] 
    : null;

  const currentFlow = state.currentFlow 
    ? flows[state.currentFlow] 
    : null;

  const totalSteps = currentFlow?.steps.length || 0;

  return {
    isLoading,
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
