'use client';

import Image from 'next/image';

interface EmptyStateProps {
  illustration?: 'learning' | 'recording' | 'ai-tutor' | 'empty';
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  illustration = 'empty',
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  const illustrationMap = {
    learning: '/illustrations/learning.svg',
    recording: '/illustrations/recording.svg',
    'ai-tutor': '/illustrations/ai-tutor.svg',
    empty: '/illustrations/empty-state.svg',
  };

  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <div className="relative w-48 h-48 mb-6 opacity-80">
        <Image
          src={illustrationMap[illustration]}
          alt={title}
          fill
          sizes="192px"
          className="object-contain"
        />
      </div>
      <h3 className="text-lg font-semibold text-navy mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 max-w-xs mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-2.5 bg-[#232322] text-white rounded-xl font-medium hover:bg-[#232322] transition-all "
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
