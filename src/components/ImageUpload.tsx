'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UploadedImage {
  id: string;
  file: File;
  dataUrl: string;  // base64 data URL
  name: string;
}

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
  maxSizeMB?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * 图片上传组件
 * 支持：
 * 1. 点击按钮选择文件
 * 2. 粘贴图片（需要在父组件中监听 paste 事件并调用 handlePaste）
 */
export function ImageUpload({
  images,
  onImagesChange,
  maxImages = 5,
  maxSizeMB = 10,
  disabled = false,
  className = '',
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 生成唯一 ID
  const generateId = () => `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // 将文件转换为 base64 data URL
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 处理文件选择
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    const remainingSlots = maxImages - images.length;
    
    if (remainingSlots <= 0) {
      alert(`最多只能上传 ${maxImages} 张图片`);
      return;
    }

    const validFiles: File[] = [];
    
    for (let i = 0; i < Math.min(files.length, remainingSlots); i++) {
      const file = files[i];
      
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        continue;
      }
      
      // 验证文件大小
      if (file.size > maxSizeBytes) {
        alert(`图片 ${file.name} 超过 ${maxSizeMB}MB 限制`);
        continue;
      }
      
      validFiles.push(file);
    }

    // 转换为 UploadedImage
    const newImages: UploadedImage[] = await Promise.all(
      validFiles.map(async (file) => ({
        id: generateId(),
        file,
        dataUrl: await fileToDataUrl(file),
        name: file.name,
      }))
    );

    onImagesChange([...images, ...newImages]);
  }, [images, onImagesChange, maxImages, maxSizeMB, disabled]);

  // 处理点击上传按钮
  const handleButtonClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  // 处理删除图片
  const handleRemove = (id: string) => {
    onImagesChange(images.filter(img => img.id !== id));
  };

  // 处理文件输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  };

  const canAddMore = images.length < maxImages;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* 已上传的图片预览 */}
      {images.map((img) => (
        <div
          key={img.id}
          className="relative group w-12 h-12 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0"
        >
          <img
            src={img.dataUrl}
            alt={img.name}
            className="w-full h-full object-cover"
          />
          {/* 删除按钮 */}
          <button
            onClick={() => handleRemove(img.id)}
            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
            title="删除图片"
          >
            ×
          </button>
        </div>
      ))}

      {/* 上传按钮 */}
      {canAddMore && (
        <button
          onClick={handleButtonClick}
          disabled={disabled}
          className={`
            w-10 h-10 rounded-lg border-2 border-dashed flex items-center justify-center
            transition-all flex-shrink-0
            ${disabled 
              ? 'border-gray-200 text-gray-300 cursor-not-allowed' 
              : 'border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50'
            }
          `}
          title="上传图片"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}

/**
 * 处理粘贴事件的 Hook
 * 用于在父组件中监听粘贴事件
 */
export function useImagePaste(
  onPaste: (images: UploadedImage[]) => void,
  enabled: boolean = true,
  maxSizeMB: number = 10
) {
  const generateId = () => `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!enabled) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file && file.size <= maxSizeBytes) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      
      const uploadedImages: UploadedImage[] = await Promise.all(
        imageFiles.map(async (file) => ({
          id: generateId(),
          file,
          dataUrl: await fileToDataUrl(file),
          name: file.name || 'pasted-image.png',
        }))
      );

      onPaste(uploadedImages);
    }
  }, [enabled, maxSizeMB, onPaste]);

  useEffect(() => {
    if (enabled) {
      document.addEventListener('paste', handlePaste);
      return () => document.removeEventListener('paste', handlePaste);
    }
  }, [enabled, handlePaste]);

  return { handlePaste };
}

/**
 * 图片预览弹窗组件
 */
export function ImagePreviewModal({
  image,
  onClose,
}: {
  image: UploadedImage | null;
  onClose: () => void;
}) {
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div className="relative max-w-4xl max-h-[90vh] p-2">
        <img
          src={image.dataUrl}
          alt={image.name}
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <p className="text-center text-white/80 text-sm mt-2">{image.name}</p>
      </div>
    </div>
  );
}
