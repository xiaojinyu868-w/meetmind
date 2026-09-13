'use client';

/**
 * 复习页里知乎来源特有的一块：「继续看」。
 * 输入不是学生选的，是这节课复习里交过的卷（服务端从 assessment 事件推没稳的概念）；没交过卷就说"先做一套题"。
 * 世界层只在这个动作里出现：搜索结果不进讲课、不进复习同桌。额度用完如实说。
 */

import * as React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import type { ContinueReadingGroup } from '@/lib/services/zhihu/zhihu-discovery-service';
import { ZhihuClientError } from './zhihu-api-client';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; groups: ContinueReadingGroup[]; exhausted: boolean; noAssessment: boolean; concepts: string[] }
  | { status: 'error'; message: string };

export function ZhihuContinueReading({ threadId }: { threadId: string }) {
  const { accessToken } = useAuth();
  const [state, setState] = React.useState<State>({ status: 'idle' });

  const run = React.useCallback(async () => {
    if (!accessToken) return;
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/zhihu/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ threadId }),
      });
      const data = (await response.json()) as { success?: boolean; groups?: ContinueReadingGroup[]; exhausted?: boolean; noAssessment?: boolean; concepts?: string[]; message?: string; error?: string };
      if (!response.ok || !data.success) throw new ZhihuClientError(data.error ?? 'unknown', data.message ?? C.errors.unknown, response.status);
      setState({ status: 'done', groups: data.groups ?? [], exhausted: data.exhausted === true, noAssessment: data.noAssessment === true, concepts: data.concepts ?? [] });
    } catch (error) {
      setState({ status: 'error', message: error instanceof ZhihuClientError ? error.message : C.errors.unknown });
    }
  }, [accessToken, threadId]);

  return (
    <div className="mt-3 border-t border-divider-light pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink">{C.tabContinue}</span>
        <button type="button" className="text-[12px] text-pine underline-offset-4 hover:underline disabled:opacity-50" onClick={() => void run()} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? C.continueLoading : state.status === 'done' ? C.retry : C.continueFind}
        </button>
      </div>
      {state.status === 'idle' && <p className="mt-1 text-[12px] leading-5 text-ink-muted">{C.continueFromReview}</p>}
      {state.status === 'error' && <p className="mt-1 text-[12px] text-cinnabar-deep">{state.message}</p>}
      {state.status === 'done' && state.noAssessment && <p className="mt-1 text-[12px] leading-5 text-ink-muted">{C.continueNeedQuiz}</p>}
      {state.status === 'done' && !state.noAssessment && state.concepts.length > 0 && <p className="mt-1 text-[12px] leading-5 text-ink">{C.continueWeak(state.concepts)}</p>}
      {state.status === 'done' && !state.noAssessment && state.groups.length === 0 && (
        <p className="mt-1 text-[12px] text-ink-muted">{state.exhausted ? C.continueQuotaOut : C.continueEmpty}</p>
      )}
      {state.status === 'done' &&
        state.groups.map((group) => (
          <div key={group.concept} className="mt-2">
            <p className="text-[12px] text-ink-secondary">{group.concept}</p>
            <ul className="mt-1 space-y-1.5">
              {group.candidates.map((candidate) => (
                <li key={candidate.url} className="text-[12.5px] leading-5">
                  <a className="font-medium text-ink hover:text-pine" href={candidate.url} target="_blank" rel="noopener noreferrer">
                    {candidate.title}
                  </a>
                  <span className="ml-1 text-[11.5px] text-ink-muted">
                    {candidate.author ? `${candidate.author} · ` : ''}
                    {candidate.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
