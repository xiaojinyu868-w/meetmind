'use client';

/**
 * /teach/live —— AI 家教「上课」舞台（第三代引擎 teach-live 的前端）。
 *
 * 两屏：入口（今天想学什么）→ 舞台（板 + 声音 + 随时插话）。
 * URL ?t=<threadId> 直达一节课（历史回放终态后续讲）。
 * 数据流：useLiveLesson（SSE → reducer → Director → TTS）→ LiveStage / LiveEntry。
 */

import * as React from 'react';
import 'katex/dist/katex.min.css';
import '@/components/teach-live/teach-live.css';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import { LiveEntry } from '@/components/teach-live/LiveEntry';
import { LiveStage } from '@/components/teach-live/LiveStage';
import { useLiveLesson, type OpenMode } from '@/components/teach-live/useLiveLesson';

export default function TeachLivePage() {
  const lesson = useLiveLesson();
  const [entryError, setEntryError] = React.useState<string | null>(null);
  // live：本次挂载里有过真实流（开课 / 发问）；历史课程打开时先是终态直出
  const [live, setLive] = React.useState(false);
  const bootRef = React.useRef(false);

  // ?t= 直达
  React.useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const id = new URLSearchParams(window.location.search).get('t');
    if (id) {
      setLive(false);
      void lesson.openLesson(id).catch(() => setEntryError(TEACH_LIVE_COPY.errorCreate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 历史课程续讲后（学生一开口）切回动画模式
  React.useEffect(() => {
    if (lesson.state.generating) setLive(true);
  }, [lesson.state.generating]);

  const onStart = React.useCallback(
    (topic: string) => {
      setEntryError(null);
      setLive(true);
      lesson.startLesson(topic).catch((err: unknown) => {
        setLive(false);
        setEntryError(err instanceof Error && err.message ? err.message : TEACH_LIVE_COPY.errorCreate);
      });
    },
    [lesson],
  );

  const onResume = React.useCallback(
    (threadId: string, mode: OpenMode) => {
      setEntryError(null);
      setLive(mode === 'replay');
      lesson.openLesson(threadId, mode).catch(() => setEntryError(TEACH_LIVE_COPY.errorCreate));
    },
    [lesson],
  );

  // 舞台里点「回看这节课」：切回动画模式
  React.useEffect(() => {
    if (lesson.replaying) setLive(true);
  }, [lesson.replaying]);

  if (!lesson.state.threadId) {
    return <LiveEntry starting={lesson.starting} error={entryError} onStart={onStart} onResume={onResume} />;
  }
  return <LiveStage lesson={lesson} live={live} onLeave={lesson.leaveLesson} />;
}
