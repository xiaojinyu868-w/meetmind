/**
 * CollectionEmptyState — 收集为空时的引导页 v6
 *
 * 极简：只有一句话。
 * 所有动作（录课、上传、贴链接）都在底部输入栏完成，
 * 空状态不再重复这些入口。
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

'use client';

// ==================== 类型定义 ====================

export interface CollectionEmptyStateProps {
  onStartRecording: () => void;
  onUploadAudio: () => void;
  onUploadImage: () => void;
  onUploadDocument: () => void;
}

// ==================== 组件实现 ====================

export function CollectionEmptyState({
  onStartRecording: _onStartRecording,
  onUploadAudio: _onUploadAudio,
  onUploadImage: _onUploadImage,
  onUploadDocument: _onUploadDocument,
}: CollectionEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6" style={{ paddingTop: '22vh' }}>
      <p className="text-[16px] font-medium tracking-[-0.01em] text-ink">
        把今天的课录进来
      </p>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        录音、贴链接、传文件，都可以
      </p>
    </div>
  );
}
