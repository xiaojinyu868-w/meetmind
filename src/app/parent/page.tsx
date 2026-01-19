'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { parentService, type TodayLearningStatus, type ConfusionMoment } from '@/lib/services/parent-service';
import {
  TodayOverview,
  ConfusionTimeline,
  TeacherAudioPlayer,
  AISummaryCard,
  ParentEmptyState,
} from '@/components/parent';
import { cn } from '@/lib/utils';

export default function ParentPage() {
  const { user } = useAuth();
  
  // 核心状态
  const [learningStatus, setLearningStatus] = useState<TodayLearningStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 播放器状态
  const [selectedConfusion, setSelectedConfusion] = useState<ConfusionMoment | null>(null);
  
  // 学生信息（实际应从绑定关系获取）
  const studentId = 'demo-student';
  const studentName = '小明';
  
  // 加载今日学情
  const loadTodayStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 优先使用真实数据，没有则用演示数据
      let status = await parentService.getTodayLearningStatus(
        studentId,
        studentName
      );
      
      // 如果没有真实数据，使用演示数据
      if (status.overview.totalClasses === 0) {
        status = await parentService.getDemoLearningStatus();
      }
      
      setLearningStatus(status);
    } catch (err) {
      console.error('Failed to load learning status:', err);
      setError('加载失败，请稍后重试');
      // 降级到演示数据
      try {
        const demoStatus = await parentService.getDemoLearningStatus();
        setLearningStatus(demoStatus);
      } catch {
        // 静默失败
      }
    } finally {
      setIsLoading(false);
    }
  }, [studentId, studentName]);
  
  // 初始加载
  useEffect(() => {
    loadTodayStatus();
  }, [loadTodayStatus]);
  
  // 标记已解决
  const handleMarkResolved = useCallback((confusionId: string) => {
    parentService.markResolved(confusionId);
    
    // 乐观更新 UI
    setLearningStatus(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        overview: {
          ...prev.overview,
          resolvedCount: prev.overview.resolvedCount + 1,
        },
        confusions: prev.confusions.map(c =>
          c.id === confusionId
            ? { ...c, resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: 'parent' as const }
            : c
        ),
      };
    });
  }, []);
  
  // 播放老师原话
  const handlePlayAudio = useCallback((confusion: ConfusionMoment) => {
    setSelectedConfusion(confusion);
  }, []);
  
  // 关闭播放器
  const handleClosePlayer = useCallback(() => {
    setSelectedConfusion(null);
  }, []);
  
  // 下拉刷新
  const handleRefresh = useCallback(() => {
    loadTodayStatus();
  }, [loadTodayStatus]);
  
  // 渲染主内容
  const renderContent = () => {
    if (!learningStatus) return null;
    
    const { overview, confusions, aiSummary } = learningStatus;
    
    // 无数据状态
    if (overview.totalClasses === 0) {
      return (
        <ParentEmptyState
          type="no-data"
          studentName={studentName}
        />
      );
    }
    
    // 无困惑点状态
    if (overview.totalConfusions === 0) {
      return (
        <>
          <TodayOverview {...overview} className="mb-6" />
          <ParentEmptyState
            type="no-confusions"
            studentName={studentName}
          />
        </>
      );
    }
    
    // 全部解决状态
    const allResolved = overview.resolvedCount === overview.totalConfusions;
    
    return (
      <>
        {/* 今日概览 */}
        <TodayOverview {...overview} className="mb-6" />
        
        {/* AI 总结 */}
        <AISummaryCard
          summary={aiSummary}
          isLoading={isLoading}
          className="mb-6"
        />
        
        {/* 全部解决庆祝 */}
        {allResolved && (
          <div className="mb-6 p-4 bg-gradient-to-r from-emerald-50 to-green-50 rounded-2xl border border-emerald-100 animate-scale-in">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎉</span>
              <div>
                <p className="font-medium text-emerald-700">太棒了！</p>
                <p className="text-sm text-emerald-600/70">所有困惑都解决了</p>
              </div>
            </div>
          </div>
        )}
        
        {/* 困惑时间线 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <span>🎯</span>
            困惑时刻
          </h2>
          <ConfusionTimeline
            confusions={confusions}
            onPlayAudio={handlePlayAudio}
            onMarkResolved={handleMarkResolved}
          />
        </div>
      </>
    );
  };
  
  return (
    <div className="min-h-screen bg-[var(--edu-bg-primary)]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* 标题 */}
            <div>
              <h1 className="text-lg font-semibold text-gray-800">
                {studentName}的学习情况
              </h1>
              <p className="text-xs text-gray-400">
                {learningStatus?.date || new Date().toLocaleDateString('zh-CN')}
              </p>
            </div>
            
            {/* 刷新按钮 */}
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className={cn(
                'p-2 rounded-xl',
                'hover:bg-gray-100 transition-colors',
                isLoading && 'animate-spin'
              )}
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      
      {/* 主内容区 */}
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* 加载状态 */}
        {isLoading && !learningStatus && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-500">正在加载学习情况...</p>
          </div>
        )}
        
        {/* 错误状态 */}
        {error && !learningStatus && (
          <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-center">
            <p className="text-red-600 mb-2">{error}</p>
            <button
              onClick={handleRefresh}
              className="text-sm text-red-500 underline"
            >
              点击重试
            </button>
          </div>
        )}
        
        {/* 主内容 */}
        {renderContent()}
      </main>
      
      {/* 底部安全区 */}
      <div className="h-20" />
      
      {/* 老师原话播放器 */}
      <TeacherAudioPlayer
        confusion={selectedConfusion}
        audioUrl="/demo-audio.mp3"
        onClose={handleClosePlayer}
      />
    </div>
  );
}
