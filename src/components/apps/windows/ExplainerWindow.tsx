'use client';

/**
 * ExplainerWindow — 板书精讲窗口
 *
 * 渲染 explainer 插件产出的 BoardScript（render mode 'board'）：
 *   - BlackboardPlayer：可汗学院式黑板，边写边讲、圈点勾画跟着讲解走
 *   - 头部只放标题与老师原话核对统计，不解释生成过程
 */

import { useMemo } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { sanitizeBoardScript } from '@/lib/ai-native/plugins/board-script';
import type { BoardScript } from '@/lib/ai-native/plugins/board-script';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { BlackboardPlayer } from '@/components/apps/windows/blackboard/BlackboardPlayer';
import { COPY } from '@/lib/ui/copy';

interface ExplainerWindowProps {
  result: AppExecutionResult | null;
}

interface ExplainerQuoteStats {
  total: number;
  verified: number;
  downgraded: number;
}

interface ExplainerPayload {
  script: BoardScript;
  title: string;
  quoteStats: ExplainerQuoteStats | null;
}

function normalizeExplainerPayload(result: AppExecutionResult | null): ExplainerPayload | null {
  const payload = result?.render?.payload;
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (!value.script || typeof value.script !== 'object') return null;

  // 结果可能来自历史快照 / 分享链路，过一遍清洗保证可渲染（坏动作跳过不崩）
  const { script } = sanitizeBoardScript(value.script);

  const statsRaw = value.quoteStats;
  const stats =
    statsRaw && typeof statsRaw === 'object'
      ? (statsRaw as Record<string, unknown>)
      : null;

  return {
    script,
    title:
      script.title ||
      (typeof result?.render?.title === 'string' && result.render.title.trim()) ||
      COPY.apps.explainer.appName,
    quoteStats: stats
      ? {
          total: typeof stats.total === 'number' ? stats.total : 0,
          verified: typeof stats.verified === 'number' ? stats.verified : 0,
          downgraded: typeof stats.downgraded === 'number' ? stats.downgraded : 0,
        }
      : null,
  };
}

export function ExplainerWindow({ result }: ExplainerWindowProps) {
  const payload = useMemo(() => normalizeExplainerPayload(result), [result]);

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={COPY.apps.explainer.appName} />;
  }
  if (!payload) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.explainer.appName} />;
  }

  const stats = payload.quoteStats;

  return (
    <div className="flex h-full flex-col" style={{ background: '#10181b' }}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]" style={{ color: '#f5f2e8' }}>
          {payload.title}
        </h2>
        {stats && stats.verified > 0 ? (
          <span className="text-[12px]" style={{ color: '#A8C8A0' }}>
            {COPY.apps.explainer.quotesVerified(stats.verified)}
          </span>
        ) : null}
        {stats && stats.downgraded > 0 ? (
          <span className="text-[12px]" style={{ color: 'rgba(245,242,232,0.5)' }}>
            {COPY.apps.explainer.quotesDowngraded(stats.downgraded)}
          </span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 px-3 pb-3">
        <BlackboardPlayer script={payload.script} />
      </div>
    </div>
  );
}

export default ExplainerWindow;
