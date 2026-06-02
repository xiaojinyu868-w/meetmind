/**
 * ChatImageLightbox —— 图片 click-to-zoom（M12）
 *
 * 行为：
 *   - 缩略图 inline 显示（lazy load + decoding async）
 *   - 点击 → 全屏 lightbox（深色 backdrop + blur）
 *   - 再点击或 ESC → 关闭
 *   - lightbox 内：scale-in 动画 + max-w/h 100%（自适应）
 *
 * 不做：
 *   - 不做 pinch zoom（移动端复杂度高，留后续）
 *   - 不做画廊（多图导航）；当前 AI 输出图片很少
 */

'use client';

import * as React from 'react';
import { X } from 'lucide-react';

interface ChatImageLightboxProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ChatImageLightbox({ src, alt, className }: ChatImageLightboxProps) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        onClick={() => setOpen(true)}
        className={`chat-image-thumb my-3 max-h-[420px] max-w-full rounded-lg border border-divider object-contain ${className ?? ''}`}
      />
      {open ? (
        <div
          className="chat-image-lightbox-backdrop"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt ?? '查看大图'}
        >
          <button
            type="button"
            className="chat-image-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="关闭"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt ?? ''}
            className="chat-image-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

ChatImageLightbox.displayName = 'ChatImageLightbox';
