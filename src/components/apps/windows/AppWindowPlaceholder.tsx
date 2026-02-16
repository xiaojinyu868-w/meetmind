'use client';

/**
 * AppWindowPlaceholder — 通用应用窗口占位组件
 *
 * 为所有应用窗口提供统一的 loading / empty / error 三种状态渲染。
 * 骨架屏使用 Tailwind animate-pulse，无额外依赖。
 */

interface AppWindowPlaceholderProps {
  /** 占位状态 */
  status: 'loading' | 'empty' | 'error';
  /** 应用中文名称（用于文案） */
  appName?: string;
  /** 错误消息 */
  errorMessage?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 返回回调 */
  onBack?: () => void;
  /** 自定义描述文案 */
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  骨架屏                                                              */
/* ------------------------------------------------------------------ */

function SkeletonLoading({ appName }: { appName: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/80 p-8">
      {/* 动态旋转指示器 */}
      <div className="relative">
        <div className="h-14 w-14 animate-spin rounded-full border-[3px] border-lavender-100 border-t-lavender-500" style={{ animationDuration: '1.2s' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-3 w-3 rounded-full bg-lavender-400 animate-pulse" />
        </div>
      </div>

      {/* 文案 */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          正在生成{appName}
        </p>
        <p className="mt-1.5 text-xs text-slate-400">
          AI 正在分析课堂内容，预计需要 15-90 秒...
        </p>
      </div>

      {/* 骨架内容模拟 */}
      <div className="w-full max-w-md space-y-3 pt-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="ml-11 space-y-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" style={{ animationDelay: '0.15s' }} />
          <div className="h-3 w-3/5 animate-pulse rounded bg-slate-100" style={{ animationDelay: '0.3s' }} />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" style={{ animationDelay: '0.45s' }} />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" style={{ animationDelay: '0.2s' }} />
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" style={{ animationDelay: '0.2s' }} />
        </div>
        <div className="ml-11 space-y-2">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" style={{ animationDelay: '0.5s' }} />
          <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" style={{ animationDelay: '0.65s' }} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  空态引导                                                            */
/* ------------------------------------------------------------------ */

function EmptyGuide({ appName, description, onRetry, onBack }: {
  appName: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8">
      {/* 空态图标 */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>

      {/* 文案 */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-600">
          暂未生成{appName}
        </p>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-400">
          {description || `点击"重新生成"或返回AI工坊黄页，为当前课堂生成${appName}内容。`}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2.5">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-lavender-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-lavender-600 hover:shadow-md active:scale-[0.97]"
          >
            重新生成
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
          >
            返回黄页
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  错误态                                                              */
/* ------------------------------------------------------------------ */

function ErrorState({ appName, errorMessage, onRetry, onBack }: {
  appName: string;
  errorMessage?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 rounded-2xl border border-coral-200 bg-gradient-to-b from-coral-50/60 to-white p-8">
      {/* 错误图标 */}
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-100">
        <svg className="h-7 w-7 text-coral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>

      {/* 文案 */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          {appName}生成失败
        </p>
        {errorMessage ? (
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500" title={errorMessage}>
            {errorMessage.length > 120 ? `${errorMessage.slice(0, 120)}...` : errorMessage}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-400">请检查网络连接后重试，或尝试切换 AI 模型。</p>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2.5">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-lavender-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-lavender-600 hover:shadow-md active:scale-[0.97]"
          >
            重试
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
          >
            返回黄页
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  主组件                                                              */
/* ------------------------------------------------------------------ */

export function AppWindowPlaceholder(props: AppWindowPlaceholderProps) {
  const { status, appName = '应用内容', errorMessage, onRetry, onBack, description } = props;

  if (status === 'loading') {
    return <SkeletonLoading appName={appName} />;
  }

  if (status === 'error') {
    return <ErrorState appName={appName} errorMessage={errorMessage} onRetry={onRetry} onBack={onBack} />;
  }

  return <EmptyGuide appName={appName} description={description} onRetry={onRetry} onBack={onBack} />;
}
