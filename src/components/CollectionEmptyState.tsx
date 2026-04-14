/**
 * CollectionEmptyState — 收集为空时的引导页 v3
 *
 * 核心改动：录音是第一动作。
 * 一个大的录音按钮居中，其他入口（上传音频/图片/讲义）收到底部小字链接。
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

'use client';

import { Mic } from 'lucide-react';

// ==================== 类型定义 ====================

export interface CollectionEmptyStateProps {
  onStartRecording: () => void;
  onUploadAudio: () => void;
  onUploadImage: () => void;
  onUploadDocument: () => void;
}

// ==================== 组件实现 ====================

export function CollectionEmptyState({
  onStartRecording,
  onUploadAudio,
  onUploadImage,
  onUploadDocument,
}: CollectionEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20">
      {/* 录音按钮——视觉焦点 */}
      <button
        type="button"
        onClick={onStartRecording}
        className="group flex h-24 w-24 items-center justify-center rounded-full bg-[#232322] text-white transition-transform active:scale-95"
        aria-label="开始录音"
      >
        <Mic size={32} strokeWidth={1.5} className="transition-transform group-hover:scale-110" />
      </button>

      {/* 主文案 */}
      <p className="mt-6 text-[17px] font-medium tracking-tight text-[#232322]">
        录一节课试试
      </p>
      <p className="mt-2 text-center text-[13px] leading-[1.6] text-[#A3A39E]">
        点一下开始录，MeetMind 会帮你听懂这节课
      </p>

      {/* 次要入口——小字链接 */}
      <div className="mt-10 flex items-center gap-1 text-[12px] text-[#A3A39E]">
        <span>也可以</span>
        <button type="button" onClick={onUploadAudio} className="underline underline-offset-2 transition-colors hover:text-[#787774]">
          传音频
        </button>
        <span>·</span>
        <button type="button" onClick={onUploadImage} className="underline underline-offset-2 transition-colors hover:text-[#787774]">
          拍讲义
        </button>
        <span>·</span>
        <button type="button" onClick={onUploadDocument} className="underline underline-offset-2 transition-colors hover:text-[#787774]">
          传文件
        </button>
      </div>
    </div>
  );
}
