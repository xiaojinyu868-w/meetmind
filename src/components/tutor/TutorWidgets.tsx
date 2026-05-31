import { Brain } from 'lucide-react';
import { FIXED_TUTOR_MODEL_LABEL } from './tutor-types';

/** 固定模型标识徽章 */
export function FixedModelBadge({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact
        ? 'inline-flex items-center gap-1.5 rounded-full border border-[#E8E2D5] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1C1B19]'
        : 'inline-flex items-center gap-2 rounded-full border border-[#E8E2D5] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1C1B19]'}
      title={`当前固定模型：${FIXED_TUTOR_MODEL_LABEL}`}
    >
      <Brain size={compact ? 12 : 14} strokeWidth={1.8} />
      <span>{FIXED_TUTOR_MODEL_LABEL}</span>
    </div>
  );
}

export function TutorModeToggle({
  enabled,
  available,
  onClick,
  compact = false,
}: {
  enabled: boolean;
  available: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  if (!available) return null;

  return (
    <div
      className={compact
        ? 'inline-flex items-center gap-1.5 rounded-full border border-[#E8E2D5] bg-white p-1'
        : 'inline-flex items-center gap-2 rounded-full border border-[#E8E2D5] bg-white p-1'}
      title="切换辅导方式"
    >
      <button
        type="button"
        onClick={() => {
          if (enabled) onClick();
        }}
        className={compact
          ? `rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              enabled ? 'text-[#5C5A55]' : 'bg-[#1C1B19] text-white'
            }`
          : `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              enabled ? 'text-[#5C5A55]' : 'bg-[#1C1B19] text-white'
            }`}
      >
        标准
      </button>
      <button
        type="button"
        onClick={() => {
          if (!enabled) onClick();
        }}
        className={compact
          ? `rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              enabled ? 'bg-[#1C1B19] text-white' : 'text-[#5C5A55]'
            }`
          : `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              enabled ? 'bg-[#1C1B19] text-white' : 'text-[#5C5A55]'
            }`}
      >
        通话
      </button>
    </div>
  );
}

/** 停止生成按钮 */
export function StopGenerationButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={compact
        ? 'inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-2xl border border-vermilion/30 bg-vermilion-mist/40 px-3 text-sm font-medium text-vermilion-deep shadow-sm transition hover:bg-vermilion-mist'
        : 'inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl border border-vermilion/30 bg-vermilion-mist/40 px-4 text-sm font-medium text-vermilion-deep transition hover:bg-vermilion-mist'}
    >
      <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 8h8v8H8z" />
      </svg>
      <span>停止</span>
    </button>
  );
}

/** 区块容器 — 带图标标题 + 可选 badge */
export function Section({ 
  icon, 
  title, 
  badge, 
  children 
}: { 
  icon: React.ReactNode; 
  title: string; 
  badge?: string; 
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
        <span className="flex items-center text-ink-muted">{icon}</span>
        <span>{title}</span>
        {badge && (
          <span className="text-xs font-normal text-coral bg-coral-50 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** 快捷回复按钮 */
export function QuickReply({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="rounded-full bg-paper-warm px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-paper-deep hover:text-ink-secondary"
    >
      {text}
    </button>
  );
}
