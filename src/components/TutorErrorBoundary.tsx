'use client';

import React from 'react';

interface TutorErrorBoundaryProps {
  children: React.ReactNode;
  panelName?: string;
  resetKeys?: Array<string | number | boolean | null | undefined>;
}

interface TutorErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class TutorErrorBoundary extends React.Component<TutorErrorBoundaryProps, TutorErrorBoundaryState> {
  constructor(props: TutorErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): TutorErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[TutorErrorBoundary] ${this.props.panelName || 'AI 助教'} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: TutorErrorBoundaryProps) {
    const prevKeys = prevProps.resetKeys || [];
    const nextKeys = this.props.resetKeys || [];
    if (prevKeys.length !== nextKeys.length) {
      if (this.state.hasError) {
        this.setState({ hasError: false, error: undefined });
      }
      return;
    }

    const hasResetKeyChanged = nextKeys.some((key, index) => key !== prevKeys[index]);
    if (hasResetKeyChanged && this.state.hasError) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-[24px] border border-[#E9E9E7] bg-white/92 px-5 py-8 text-center shadow-[0_18px_38px_rgba(148,163,184,0.10)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FADEC9] text-white">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm8.25-.75a8.25 8.25 0 10-16.5 0 8.25 8.25 0 0016.5 0z" />
            </svg>
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold text-slate-900">AI 助教刚刚开了个小差</p>
            <p className="text-sm leading-6 text-slate-500">这次只影响当前问答面板，不会把整页复习打断。点一下重试就行。</p>
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="inline-flex items-center justify-center rounded-full bg-[#232322] px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
          >
            重新加载 AI 助教
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
