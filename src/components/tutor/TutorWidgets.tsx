import { Brain } from 'lucide-react';
import { FIXED_TUTOR_MODEL_LABEL } from './tutor-types';

/** 固定模型标识徽章 */
export function FixedModelBadge({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact
        ? 'inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700'
        : 'inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700'}
      title={`当前固定模型：${FIXED_TUTOR_MODEL_LABEL}`}
    >
      <Brain size={compact ? 12 : 14} strokeWidth={1.8} />
      <span>{FIXED_TUTOR_MODEL_LABEL}</span>
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
        ? 'inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100'
        : 'inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-900 transition hover:bg-amber-100'}
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
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="flex items-center text-gray-500">{icon}</span>
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
      className="rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      {text}
    </button>
  );
}
