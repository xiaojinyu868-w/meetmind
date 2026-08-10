/**
 * settings/primitives — 设置页的原子组件（纯展示，字符串一律由调用方从 COPY 传入）。
 *
 * 2026-08 重设计：从 settings/page.tsx 964 行 God File 拆出。
 * 行解剖统一：label 左 / 控件右，52px 行高，hint 与 label 作为原子单元不被
 * divider 切开；section 支持 id + scroll-mt，供 SettingsNav 锚点定位。
 */

import Link from 'next/link';

export function SettingSection({
  caption,
  description,
  children,
  id,
}: {
  caption: string;
  description?: string;
  children: React.ReactNode;
  /** 锚点 id：桌面左侧导航 IntersectionObserver 跟踪 + 点击平滑滚动 */
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="px-2 pb-3">
        <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {caption}
        </div>
        {description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted/85">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** 同一 section 内多张卡片之间的小标签（如「关于你」下的学习档案 / 教练画像） */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2 pt-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-muted/70">
      {children}
    </div>
  );
}

export function SettingGroup({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-divider bg-card shadow-soft">
      {children}
    </section>
  );
}

export function GroupDivider() {
  return <div className="h-px bg-divider" />;
}

export function InputSettingRow({
  label,
  type,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  type: 'text' | 'email' | 'tel';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-[52px] items-center gap-4 px-5">
      <span className="w-16 flex-shrink-0 text-[15px] text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 appearance-none bg-transparent px-0 text-right text-[15px] text-ink outline-none placeholder:text-ink-muted/70"
      />
    </label>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`flex items-start gap-4 px-5 ${hint ? 'py-3.5' : 'min-h-[52px] items-center'}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-[14.5px] text-ink ${hint ? 'leading-snug' : ''}`}>{label}</div>
        {hint ? (
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted/85">{hint}</p>
        ) : null}
      </div>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
        className={`relative inline-flex h-7 w-[46px] flex-shrink-0 rounded-full transition-colors ${
          hint ? 'mt-[2px]' : ''
        } ${checked ? 'bg-pine' : 'bg-divider'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span
          className={`mt-[2px] inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

export function SelectRow({
  label,
  value,
  displayValue,
  disabled,
  onChange,
  options,
}: {
  label: string;
  value: string;
  displayValue: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="relative flex min-h-[52px] items-center gap-4 px-5">
      <span className="w-20 flex-shrink-0 text-[15px] text-ink">{label}</span>
      <div className="min-w-0 flex-1">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-12 w-full appearance-none bg-transparent pr-6 text-right text-[15px] text-ink outline-none disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="sr-only">{displayValue}</span>
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-ink-muted">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </label>
  );
}

export function ActionLinkRow({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[52px] items-center justify-between px-5 text-[14.5px] text-ink transition-all hover:bg-pine/[0.04]"
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-ink-muted transition-all group-hover:translate-x-0.5 group-hover:text-pine" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export function ActionButtonRow({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'default' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center justify-between px-5 text-left text-[14.5px] transition-colors hover:bg-pine/[0.04] ${
        tone === 'danger' ? 'text-vermilion' : 'text-ink'
      }`}
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

export function StaticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 px-5 text-[14.5px]">
      <span className="flex-shrink-0 text-ink">{label}</span>
      <span className="min-w-0 truncate text-right text-ink-secondary">{value}</span>
    </div>
  );
}
