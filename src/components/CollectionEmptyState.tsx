/**
 * CollectionEmptyState — 收集为空时的引导页 v2
 *
 * 设计升级：
 * - 更克制的引导文案，呼吸感更强
 * - 入口按钮卡片化，统一 whisper border + hover 加深
 * - 图标容器更柔和的圆角（squircle 感）
 */

'use client';

import {
  Sparkles,
  Image as ImageIcon,
  FileText,
  AudioLines,
} from 'lucide-react';

// ==================== 类型定义 ====================

export interface CollectionEmptyStateProps {
  onUploadAudio: () => void;
  onUploadImage: () => void;
  onUploadDocument: () => void;
}

// ==================== 组件实现 ====================

export function CollectionEmptyState({
  onUploadAudio,
  onUploadImage,
  onUploadDocument,
}: CollectionEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16">
      {/* 图标 */}
      <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[#D3E4F4]/50">
        <Sparkles size={26} strokeWidth={1.5} className="text-[#5B8DBF]" />
      </div>

      {/* 文案 */}
      <p className="mt-5 text-[16px] font-medium tracking-tight text-[#232322]">
        从一条线索开始
      </p>
      <p className="mt-2 text-center text-[13px] leading-[1.6] text-[#A3A39E]">
        一句困惑、一张图、一份讲义<br />或者一段原声都行
      </p>

      {/* 快捷入口 */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onUploadAudio}
          className="flex flex-col items-center gap-2 rounded-2xl bg-white px-5 py-4 ring-[0.5px] ring-[#232322]/[0.06] transition-all hover:ring-[#232322]/[0.12] hover:bg-[#FAFAF9]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#FDF3C0]/70 text-[#8B6914]">
            <AudioLines size={18} strokeWidth={1.5} />
          </span>
          <span className="text-[12px] font-medium text-[#787774]">原声</span>
        </button>
        <button
          type="button"
          onClick={onUploadImage}
          className="flex flex-col items-center gap-2 rounded-2xl bg-white px-5 py-4 ring-[0.5px] ring-[#232322]/[0.06] transition-all hover:ring-[#232322]/[0.12] hover:bg-[#FAFAF9]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#D3E4F4]/60 text-[#1E5F8A]">
            <ImageIcon size={18} strokeWidth={1.5} />
          </span>
          <span className="text-[12px] font-medium text-[#787774]">图片</span>
        </button>
        <button
          type="button"
          onClick={onUploadDocument}
          className="flex flex-col items-center gap-2 rounded-2xl bg-white px-5 py-4 ring-[0.5px] ring-[#232322]/[0.06] transition-all hover:ring-[#232322]/[0.12] hover:bg-[#FAFAF9]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#FADEC9]/60 text-[#9A4A12]">
            <FileText size={18} strokeWidth={1.5} />
          </span>
          <span className="text-[12px] font-medium text-[#787774]">讲义</span>
        </button>
      </div>
    </div>
  );
}
