'use client';

import React, { useMemo, memo } from 'react';
import { StreamingMarkdown } from './StreamingMarkdown';
import type { Citation } from '@/types/dify';

/**
 * 思维步骤
 */
interface ThinkingStep {
  title: string;
  content: string;
  tip?: string;
}

/**
 * 解析结果
 */
interface ParsedGuide {
  steps: ThinkingStep[];
  methods?: string;
  formalAnswer?: string;
  isValid: boolean;
}

interface ThinkingGuideRendererProps {
  content: string;
  isStreaming?: boolean;
  onTimestampClick?: (timestampMs: number) => void;
  isMobile?: boolean;
  className?: string;
  citations?: Citation[];
}

/**
 * 根据步骤标题智能选择图标
 */
function getStepIcon(title: string): string {
  const t = title.toLowerCase();
  if (/听|审|理解|拆解|看|找|关键|问题|任务|指令/.test(t)) return '🔍';
  if (/回忆|联想|知识|课堂|想起|关联|联系|记得|场景/.test(t)) return '📚';
  if (/推理|判断|思考|对比|比较|推断|逻辑|分析/.test(t)) return '🧩';
  if (/整理|组织|表达|总结|归纳|输出|养成/.test(t)) return '✨';
  if (/验证|检查|确认|核对/.test(t)) return '✅';
  return '💭';
}

/**
 * 判断是否是"正式回答"相关的标题
 */
function isAnswerTitle(title: string): boolean {
  return /正式回答|回答|答案|解答/.test(title);
}

/**
 * 解析学霸思维引导内容
 */
function parseGuide(content: string): ParsedGuide {
  const result: ParsedGuide = {
    steps: [],
    isValid: false,
  };

  if (!content) return result;

  // 检测是否包含思维演示结构
  const hasGuideMarker = content.includes('思维演示') || 
                         (content.includes('【') && content.includes('💡'));
  if (!hasGuideMarker) return result;

  // 移除思维演示分隔符
  let workingContent = content.replace(/---+\s*思维演示\s*---+/gi, '');

  // 提取🌟思维方法总结
  const methodsMatch = workingContent.match(/🌟\s*(?:本次)?(?:思维)?(?:方法)?[：:]*\s*(.+?)(?=\n\n|\n【|---|\*\*|$)/);
  if (methodsMatch) {
    result.methods = methodsMatch[1].trim();
    workingContent = workingContent.replace(methodsMatch[0], '');
  }

  // 解析所有【步骤】
  const stepRegex = /【([^】]+)】([\s\S]*?)(?=【[^】]+】|🌟|---+\s*正式|$)/g;
  let match;
  let lastAnswerContent = '';

  while ((match = stepRegex.exec(workingContent)) !== null) {
    const title = match[1].trim();
    let stepContent = match[2].trim();

    // 如果是"正式回答"标题，收集为正式回答内容
    if (isAnswerTitle(title)) {
      // 提取💡后的内容也算正式回答的一部分
      lastAnswerContent += (lastAnswerContent ? '\n\n' : '') + stepContent;
      continue;
    }

    // 提取💡心得
    let tip: string | undefined;
    const tipMatch = stepContent.match(/💡\s*([\s\S]+?)(?=\n\n|\n【|$)/);
    if (tipMatch) {
      tip = tipMatch[1].trim();
      stepContent = stepContent.replace(tipMatch[0], '').trim();
    }

    if (title && stepContent) {
      result.steps.push({ title, content: stepContent, tip });
    }
  }

  // 处理 ---正式回答--- 格式的分隔
  const formalMatch = workingContent.match(/---+\s*正式回答\s*---+([\s\S]*)$/i);
  if (formalMatch) {
    lastAnswerContent = formalMatch[1].trim();
  }

  if (lastAnswerContent) {
    result.formalAnswer = lastAnswerContent;
  }

  result.isValid = result.steps.length > 0;
  return result;
}

// ==================== 渲染组件 ====================

/**
 * 思维步骤卡片
 */
const StepCard = memo(function StepCard({
  step,
  index,
  total,
  onTimestampClick,
  isMobile,
  citations,
}: {
  step: ThinkingStep;
  index: number;
  total: number;
  onTimestampClick?: (ms: number) => void;
  isMobile?: boolean;
  citations?: Citation[];
}) {
  const icon = getStepIcon(step.title);
  const isLast = index === total - 1;

  // 统一布局：移动端和桌面端共用时间线布局，仅调整尺寸和间距
  return (
    <div className="relative">
      {/* 左侧时间线 - 移动端左移 */}
      <div className={`absolute top-0 bottom-0 flex flex-col items-center ${isMobile ? 'left-1' : 'left-4'}`}>
        <div className={`rounded-full bg-violet-100 border-2 border-violet-300 flex items-center justify-center z-10 ${isMobile ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'}`}>
          {icon}
        </div>
        {!isLast && <div className="flex-1 w-0.5 bg-violet-200 mt-1" />}
      </div>

      {/* 内容区域 - 移动端左边距缩小 */}
      <div className={`pb-4 ${isMobile ? 'ml-9' : 'ml-14'}`}>
        {/* 标题 */}
        <div className={`font-medium text-violet-800 mb-1.5 ${isMobile ? 'text-xs' : 'text-sm'}`}>
          {step.title}
        </div>

        {/* 内容 */}
        <div className={`text-gray-700 leading-relaxed bg-white/60 rounded-lg border border-gray-100 ${isMobile ? 'text-xs px-2 py-1.5' : 'text-sm px-3 py-2'}`}>
          <StreamingMarkdown
            content={step.content}
            isStreaming={false}
            onTimestampClick={onTimestampClick}
            citations={citations}
          />
        </div>

        {/* 💡心得 */}
        {step.tip && (
          <div className={`mt-2 flex items-start gap-1.5 bg-amber-50 rounded-lg border border-amber-100 ${isMobile ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
            <span className={`text-amber-500 ${isMobile ? 'text-xs' : 'text-sm'}`}>💡</span>
            <div className={`text-amber-700 leading-relaxed ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
              <StreamingMarkdown
                content={step.tip}
                isStreaming={false}
                onTimestampClick={onTimestampClick}
                citations={citations}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * 学霸思维引导渲染器
 */
export const ThinkingGuideRenderer = memo(function ThinkingGuideRenderer({
  content,
  isStreaming = false,
  onTimestampClick,
  isMobile = false,
  className = '',
  citations,
}: ThinkingGuideRendererProps) {

  const parsed = useMemo(() => parseGuide(content), [content]);

  // 没有解析出引导结构，回退为普通渲染
  if (!parsed.isValid) {
    return (
      <StreamingMarkdown
        content={content}
        isStreaming={isStreaming}
        onTimestampClick={onTimestampClick}
        className={className}
        citations={citations}
      />
    );
  }

  return (
    <div className={className}>
      {/* ===== 思维演示区 ===== */}
      <div className={`bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl border border-violet-100 ${isMobile ? 'p-3' : 'p-4'}`}>
        {/* 标题 */}
        <div className={`flex items-center gap-2 ${isMobile ? 'mb-3' : 'mb-4'}`}>
          <span className={isMobile ? 'text-base' : 'text-lg'}>🧠</span>
          <span className={`font-semibold text-violet-800 ${isMobile ? 'text-xs' : 'text-base'}`}>
            跟我一起理清思路
          </span>
        </div>

        {/* 思维步骤 */}
        <div className="relative">
          {parsed.steps.map((step, index) => (
            <StepCard
              key={index}
              step={step}
              index={index}
              total={parsed.steps.length}
              onTimestampClick={onTimestampClick}
              isMobile={isMobile}
              citations={citations}
            />
          ))}
        </div>

        {/* 思维方法总结 - 统一使用左边距 */}
        {parsed.methods && (
          <div className={`mt-2 flex items-start gap-2 bg-emerald-50 rounded-lg border border-emerald-200 ${isMobile ? 'ml-9 px-2 py-1.5' : 'ml-14 px-3 py-2'}`}>
            <span className="text-emerald-500 flex-shrink-0">🌟</span>
            <div className={`min-w-0 text-emerald-700 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
              <div className="mb-1 font-medium">思维方法：</div>
              <StreamingMarkdown
                content={parsed.methods}
                isStreaming={false}
                onTimestampClick={onTimestampClick}
                citations={citations}
              />
            </div>
          </div>
        )}
      </div>

      {/* ===== 正式回答区 ===== */}
      {parsed.formalAnswer && (
        <div className={`mt-3 bg-white rounded-xl border border-blue-100 shadow-sm ${isMobile ? 'p-3' : 'p-4'}`}>
          {/* 标题 */}
          <div className={`flex items-center gap-2 pb-2 border-b border-blue-100 ${isMobile ? 'mb-2' : 'mb-3'}`}>
            <span className={isMobile ? 'text-base' : 'text-lg'}>📝</span>
            <span className={`font-semibold text-blue-800 ${isMobile ? 'text-xs' : 'text-base'}`}>
              正式回答
            </span>
          </div>

          {/* 回答内容 */}
          <div className={`${isMobile ? 'text-xs' : 'text-sm'} text-gray-800 leading-relaxed`}>
            <StreamingMarkdown
              content={parsed.formalAnswer}
              isStreaming={false}
              onTimestampClick={onTimestampClick}
              citations={citations}
            />
          </div>
        </div>
      )}

      {/* 流式加载提示 */}
      {isStreaming && (
        <div className="flex items-center justify-center gap-2 py-2 text-violet-500 mt-2">
          <div className="loading-dots scale-75">
            <span></span><span></span><span></span>
          </div>
          <span className={`${isMobile ? 'text-[10px]' : 'text-xs'}`}>继续输出中...</span>
        </div>
      )}
    </div>
  );
});

export default ThinkingGuideRenderer;
