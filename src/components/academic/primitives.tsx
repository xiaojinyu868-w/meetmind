'use client';

/**
 * Academic 三端共用的基础视觉组件。
 *
 * 设计语言：MeetMind 秩序白皮书。零渐变、零阴影、纯平涂。
 * 只允许使用 tailwind.config.js 里已有的 token：
 *   canvas / card / hover / ink / ink.secondary / ink.muted / divider
 *   mint / sand / dustyblue / rose（四大功能色，低饱和）
 *
 * 所有组件都强制 forwardRef-free 的函数式写法。
 */

import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from 'react';

// ---------- Section: 页内一个次级区块 ----------

export function Section({
  title,
  description,
  right,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      {(title || right) && (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-medium text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
          {right && <div className="text-xs text-ink-secondary">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- PageHeader: 页面顶部统一结构 ----------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-divider pb-5">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="text-xs text-ink-muted">{eyebrow}</div>}
        <h1 className="mt-1 text-2xl font-medium leading-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------- Card ----------

export function Card({
  className = '',
  interactive = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      {...rest}
      className={`rounded-lg border border-divider bg-card ${
        interactive ? 'transition-colors hover:border-ink' : ''
      } ${className}`}
    />
  );
}

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-ink text-card hover:bg-ink/90',
  secondary: 'border border-ink text-ink hover:bg-hover',
  ghost: 'border border-divider text-ink-secondary hover:text-ink hover:border-ink',
  danger: 'border border-divider text-rose-600 hover:border-rose-400 hover:bg-rose-light',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
    />
  );
}

// ---------- Tag / Badge ----------

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-hover text-ink-secondary',
  info: 'bg-dustyblue-light text-accent-700',
  success: 'bg-mint-50 text-mint-700',
  warning: 'bg-sand-light text-warning-700',
  danger: 'bg-rose-light text-rose-700',
};

export function Tag({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------- StatCard: 数字卡片 ----------

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-muted">{label}</div>
        {tone !== 'neutral' && <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]}`} />}
      </div>
      <div className="mt-2 text-2xl font-medium leading-none text-ink">{value}</div>
      {hint && <div className="mt-2 text-xs text-ink-secondary">{hint}</div>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block rounded-lg border border-divider bg-card p-4 transition-colors hover:border-ink"
      >
        {content}
      </a>
    );
  }
  return <div className="rounded-lg border border-divider bg-card p-4">{content}</div>;
}

const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-ink-muted',
  info: 'bg-accent-400',
  success: 'bg-mint-500',
  warning: 'bg-warning-400',
  danger: 'bg-rose-400',
};

// ---------- EmptyState ----------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-divider bg-card p-10 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <p className="mx-auto mt-2 max-w-md text-xs text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- InlineAlert ----------

export function InlineAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warning' | 'info';
  children: ReactNode;
}) {
  const map = {
    danger: 'border-rose-300 bg-rose-light text-rose-700',
    warning: 'border-sand-dark bg-sand-light text-warning-700',
    info: 'border-dustyblue-dark bg-dustyblue-light text-accent-700',
  };
  return (
    <div className={`rounded border px-3 py-2 text-xs ${map[tone]}`}>{children}</div>
  );
}

// ---------- KeyValue 键值对展示 ----------

export function KeyValueList({ rows }: { rows: Array<{ k: ReactNode; v: ReactNode }> }) {
  return (
    <dl className="divide-y divide-divider text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-4 py-2">
          <dt className="w-28 shrink-0 text-ink-muted">{r.k}</dt>
          <dd className="flex-1 text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}
