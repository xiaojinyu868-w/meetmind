'use client';

/**
 * BlackboardPlayer — 板书播放器（BoardCanvas + 控制条 + v3 交互态）。
 *
 * v3 三块（对齐 AmIWrite）：
 * - checkpoint 渐进放手：提问上板 → 等待（我会了/给我提示/看解析）→
 *   三级 hint 递进 → 看解析完整示范（board-checkpoint 状态机）
 * - ref 跨页插播：淡出 → 目标页最终态 + 脉冲高亮 → 淡回（RefInterlude）
 * - 学生板演：粉笔蓝笔迹层（StudentInkLayer），擦掉重写/写完了恢复播放
 *
 * 播放 / 暂停 / 重播 / 倍速（1x·1.5x）/ 页码。文案统一走 COPY.apps.explainer。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardAction, BoardScript } from '@/lib/ai-native/plugins/board-script';
import { checkpointAnswerText, segmentDisplayText } from '@/lib/ai-native/plugins/board-script';
import { COPY } from '@/lib/ui/copy';
import { BoardCanvas } from './BoardCanvas';
import type { ExtraWrite } from './BoardCanvas';
import { BOARD_FONT } from './BoardWrite';
import { useBoardPlayer } from './useBoardPlayer';
import { createAudioClock, createSpeechClock, prefetchBoardTts, SPEECH_BASE_RATE } from './segment-clock';
import type { SegmentClock } from './segment-clock';
import { CHECKPOINT_INITIAL, checkpointReducer } from './board-checkpoint';
import type { CheckpointEvent, CheckpointState } from './board-checkpoint';
import { CheckpointPanel } from './CheckpointPanel';
import { RefInterlude } from './RefInterlude';
import { StudentInkLayer, StaticInkLayer } from './StudentInkLayer';
import type { InkStroke } from './StudentInkLayer';
import { cellCenter, rasterizeInkForGrading } from './ink-grading';
import { RoughStroke } from './RoughStroke';
import { hashSeed } from './board-model';

interface BlackboardPlayerProps {
  script: BoardScript;
  /** 演示/调试：覆盖每字估时（默认 280ms），生产不传 */
  paceMsPerChar?: number;
  /** 中文主字体覆盖（demo 字体评估用；缺省系统屏显栈） */
  fontFamily?: string;
  /** ?debug=bounds：标注实测 rect 画细线框 */
  debugBounds?: boolean;
  /** 流式生成中（后续讲解单元还在生成）：播到当前末尾进入等待态而非完结 */
  generating?: boolean;
}

function ControlButton({
  onClick,
  label,
  active,
  disabled,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1,
        color: active ? '#1f2a2e' : 'rgba(245,242,232,0.85)',
        background: active ? '#f5f2e8' : 'rgba(245,242,232,0.1)',
        border: '1px solid rgba(245,242,232,0.22)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}

interface CheckpointArtifacts {
  writes: ExtraWrite[];
  annotations: BoardAction[];
}

/** 由状态机当前进度算出 checkpoint 已上板的内容（question + 已揭示 hints + demo）。
 *  answer 阶段示范随答案口述渐进上板（answerCues 念到哪个，第几个 demoAction 落笔，
 *  与正段"嘴手一体"同规则）；demo/done 阶段全量。 */
function buildArtifacts(
  segmentIndex: number,
  checkpoint: NonNullable<ReturnType<typeof useBoardPlayer>['checkpoint']>,
  machine: CheckpointState,
  demoProgress = 0,
): CheckpointArtifacts {
  const writes: ExtraWrite[] = [
    { key: `cp${segmentIndex}-question`, text: checkpoint.question.text, role: checkpoint.question.role },
  ];
  for (let index = 0; index < machine.hintsShown; index += 1) {
    writes.push({ key: `cp${segmentIndex}-hint-${index}`, text: checkpoint.hints[index], role: 'note' });
  }
  const demoReached = machine.stage === 'demo' || (machine.stage === 'done' && machine.withDemo);
  const answerReached = machine.stage === 'answer';
  const annotations: BoardAction[] = [];
  if (demoReached || answerReached) {
    const limit = demoReached ? checkpoint.demoActions.length : demoProgress;
    checkpoint.demoActions.slice(0, limit).forEach((action, index) => {
      if (action.type === 'write') {
        writes.push({ key: `cp${segmentIndex}-demo-${index}`, text: action.text, role: action.role });
      } else if (action.type !== 'pause') {
        annotations.push(action);
      }
    });
  }
  return { writes, annotations };
}

export function BlackboardPlayer({ script, paceMsPerChar, fontFamily, debugBounds, generating = false }: BlackboardPlayerProps) {
  // 翻页闸门：BoardCanvas 上报本页 write 是否全部完成
  const writesDoneRef = useRef(true);
  // v23 反向背压：BoardCanvas 上报的串行书写队列积压数
  const inkBacklogRef = useRef(0);
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  const player = useBoardPlayer(script, {
    msPerChar: paceMsPerChar,
    advanceGate: () => writesDoneRef.current,
    isGenerating: () => generatingRef.current,
    inkBacklog: () => inkBacklogRef.current,
  });
  const page = script.pages[player.pageIndex] ?? script.pages[0];

  // 流式生成：新单元到达 / 全部生成完 → 通知播放器续播或收束
  const pageCount = script.pages.length;
  useEffect(() => {
    player.notifyScriptGrown(!generatingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, generating]);

  // ── checkpoint 交互态 ──
  const [machine, setMachine] = useState<CheckpointState>(CHECKPOINT_INITIAL);
  const dispatch = (event: CheckpointEvent) => setMachine((prev) => checkpointReducer(prev, event));
  const adhocClockRef = useRef<SegmentClock | null>(null);
  // 已结束 checkpoint 的上板遗物（本页内保留，换页清空）
  const [cpArtifacts, setCpArtifacts] = useState<Record<number, CheckpointArtifacts>>({});
  // 老师示范：学生写错时，VLM 给的正确写法行（短板书上板，interpretive feedback）
  const [gradeDemo, setGradeDemo] = useState<string[]>([]);
  // answer 阶段：示范动作随答案口述渐进上板的进度（answerCues 驱动）
  const [demoProgress, setDemoProgress] = useState(0);

  // 进入新 checkpoint（或离开）时重置状态机
  const checkpointKey = player.checkpoint ? `${player.pageIndex}:${player.segmentIndex}` : null;
  useEffect(() => {
    adhocClockRef.current?.cancel();
    adhocClockRef.current = null;
    setMachine(CHECKPOINT_INITIAL);
    setDemoProgress(0);
    // 进入 checkpoint 即预取提示/答案音频，用户点击后开口零等待
    if (player.checkpoint) {
      prefetchBoardTts(checkpointAnswerText(player.checkpoint));
      player.checkpoint.hints.forEach((hint) => prefetchBoardTts(hint));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpointKey]);

  // 提问口述完毕（player 进入 'checkpoint' 等待态）→ ask_done
  useEffect(() => {
    if (player.status === 'checkpoint' && machine.stage === 'ask') dispatch('ask_done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.status, machine.stage]);

  // v15 科学节奏·wait time（Rowe 1974：教师等待时间 ≥3s 显著提升学生回答
  // 质量）：提问念完后按钮延迟 2s 出现——先让学生真的想一想，也避免
  // 不过脑直接点「看解析」
  const [waitPanelReady, setWaitPanelReady] = useState(false);
  useEffect(() => {
    if (player.status === 'checkpoint' && machine.stage === 'wait') {
      const timer = setTimeout(() => setWaitPanelReady(true), 2000);
      return () => clearTimeout(timer);
    }
    setWaitPanelReady(false);
    return undefined;
  }, [player.status, machine.stage]);

  // 冷启动：脚本就绪即窗口化预取 narration 音频（服务端 LRU 64 + 请求去重，
  // 把合成延迟藏进加载期）。只预取前 6 段：45 分钟真课有上百段，全量预取
  // 会挤爆 LRU 把早段逐出（播放时反而要重取），其余靠播放中的下一段预取接力。
  // 800ms stagger 限流：多段同时打引擎会触发 503（实测），错开后平稳
  useEffect(() => {
    const texts: string[] = [];
    script.pages.forEach((scriptPage) => {
      scriptPage.segments.forEach((segment) => {
        const text = segmentDisplayText(segment).trim();
        if (text) texts.push(text);
      });
    });
    const timers = texts
      .slice(0, 6)
      .map((text, index) => setTimeout(() => prefetchBoardTts(text), index * 800));
    return () => timers.forEach(clearTimeout);
  }, [script]);

  const speak = (text: string, onEnd: () => void, onProgress?: (progress: { charIndex: number }) => void) => {
    adhocClockRef.current?.cancel();
    const estimatedMs = Math.max(1500, text.length * 280);
    // checkpoint 的提问/提示/解析与正段同一条声音：AudioClock 优先，
    // 不可用原位降级 speechSynthesis；速率与主链一致（× SPEECH_BASE_RATE）
    const rate = player.speed * SPEECH_BASE_RATE;
    const clock = createAudioClock(text, estimatedMs, rate);
    adhocClockRef.current = clock;
    clock.onEnd = onEnd;
    if (onProgress) clock.onProgress = onProgress;
    clock.onUnavailable = () => {
      if (adhocClockRef.current !== clock) return;
      // 与 useBoardPlayer 同款竞态：降级前必须 cancel 原 AudioClock，
      // 否则在飞的 fetch 到 wav 后叠在机器人音上（双音轨）
      clock.cancel();
      const fallback = createSpeechClock(text, estimatedMs, rate);
      adhocClockRef.current = fallback;
      fallback.onEnd = onEnd;
      if (onProgress) fallback.onProgress = onProgress;
      fallback.start();
    };
    clock.start();
  };

  // hint / answer 阶段：朗读对应文本，念完推进状态机
  useEffect(() => {
    if (!player.checkpoint) return undefined;
    if (machine.stage === 'hint') {
      speak(player.checkpoint.hints[machine.hintsShown - 1], () => dispatch('hint_done'));
    } else if (machine.stage === 'answer') {
      // 答案口述 + 示范随 answerCues 渐进上板：解析念到哪个，第几个
      // demoAction 落笔（与正段"嘴手一体"同规则）；念完进 demo 段收尾
      const answerCues = player.checkpoint.answerCues ?? [];
      speak(checkpointAnswerText(player.checkpoint), () => dispatch('answer_done'), ({ charIndex }) => {
        const reached = new Set(
          answerCues.filter((cue) => charIndex >= cue.charIndex).map((cue) => cue.actionIndex),
        ).size;
        setDemoProgress((prev) => (reached > prev ? reached : prev));
      });
    } else if (machine.stage === 'demo') {
      // demoActions 已上板串行执行；按文本量估算示范时长后收工
      const demoMs =
        player.checkpoint.demoActions.reduce(
          (sum, action) => (action.type === 'write' ? sum + action.text.length * 500 + 1500 : sum + 600),
          0,
        ) + 800;
      const timer = setTimeout(() => dispatch('demo_done'), demoMs);
      return () => clearTimeout(timer);
    } else if (machine.stage === 'done') {
      setCpArtifacts((prev) => ({
        ...prev,
        [player.segmentIndex]: buildArtifacts(player.segmentIndex, player.checkpoint!, machine),
      }));
      player.advanceFromCheckpoint();
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.stage, machine.hintsShown, player.checkpoint]);

  // 换页清空 checkpoint 遗物
  useEffect(() => {
    setCpArtifacts({});
  }, [player.pageIndex]);

  const activeArtifacts = useMemo(
    () =>
      player.checkpoint
        ? buildArtifacts(player.segmentIndex, player.checkpoint, machine, demoProgress)
        : null,
    [player.checkpoint, player.segmentIndex, machine, demoProgress],
  );

  // 'done' 阶段已把当前 checkpoint 存进 cpArtifacts；若它同时还是
  // activeArtifacts（页末 checkpoint：advance 后无下一段，checkpoint 态不
  // 消失），两份拼在一起 = 题目/示范成双上板（2026-08-19 末页实拍根修）。
  // 守卫：当前 segment 已入遗物就不再拼 active 份。
  const activeRedundant = player.checkpoint
    ? cpArtifacts[player.segmentIndex] !== undefined
    : false;

  const extraWrites = useMemo(
    () => [
      ...Object.values(cpArtifacts).flatMap((artifact) => artifact.writes),
      ...(activeRedundant ? [] : (activeArtifacts?.writes ?? [])),
      // 批改示范行（写错时）：标题 note + 正确写法 step，串行上板
      ...(gradeDemo.length > 0
        ? [
            { key: 'grade-demo-title', text: COPY.apps.explainer.inkDemoTitle, role: 'note' as const },
            ...gradeDemo.map((line, index) => ({
              key: `grade-demo-${index}`,
              text: line,
              role: 'step' as const,
            })),
          ]
        : []),
    ],
    [cpArtifacts, activeArtifacts, activeRedundant, gradeDemo],
  );
  const extraAnnotations = useMemo(
    () => [
      ...Object.values(cpArtifacts).flatMap((artifact) => artifact.annotations),
      ...(activeRedundant ? [] : (activeArtifacts?.annotations ?? [])),
    ],
    [cpArtifacts, activeArtifacts, activeRedundant],
  );

  // ── 板演批改（Practice 闭环，对齐 AmIWrite：学生写完 → AI 看笔迹 → 勾叉 + 点评）──
  const [, setGrading] = useState(false);
  const [gradeMarks, setGradeMarks] = useState<Array<{ type: 'check' | 'cross'; x: number; y: number }>>([]);

  // ── ref 跨页插播 ──
  const [interlude, setInterlude] = useState<{ pageIndex: number; target: string } | null>(null);
  const shownRefsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const key of player.triggered) {
      if (shownRefsRef.current.has(key)) continue;
      const match = /^s(\d+)a(\d+)$/.exec(key);
      if (!match) continue;
      const segment = page.segments[Number(match[1])];
      if (!segment || segment.type === 'checkpoint') continue;
      const action = segment.actions[Number(match[2])];
      if (action?.type !== 'ref') continue;
      shownRefsRef.current.add(key);
      player.pause();
      setInterlude({ pageIndex: action.page - 1, target: action.target });
      const timer = setTimeout(() => {
        setInterlude(null);
        player.play();
      }, 2700);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.triggered, page]);

  // ── 学生板演 ──
  const [inkActive, setInkActive] = useState(false);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  useEffect(() => {
    setStrokes([]);
    setInkActive(false);
    setGradeMarks([]);
    setGradeDemo([]);
  }, [player.pageIndex]);

  // ── 板演批改（Practice 闭环，对齐 AmIWrite：学生写完 → AI 看笔迹 → 勾叉 + 点评）──
  // 最近一次 checkpoint 的题目/解析（批改的判分依据；课中没有 checkpoint 就不批改）
  const lastCheckpointRef = useRef<{ question: string; answer: string } | null>(null);
  useEffect(() => {
    if (player.checkpoint) {
      lastCheckpointRef.current = {
        question: player.checkpoint.question.text,
        answer: player.checkpoint.answer,
      };
    }
  }, [player.checkpoint]);

  const finishInk = () => {
    setInkActive(false);
    const resume = () => {
      if (player.status === 'paused') player.play();
    };
    const context = lastCheckpointRef.current;
    if (strokes.length === 0 || !context) {
      resume();
      return;
    }
    setGrading(true);
    void (async () => {
      try {
        const image = rasterizeInkForGrading(strokes);
        const response = await fetch('/api/board/grade-ink', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, question: context.question, answer: context.answer }),
        });
        if (response.ok) {
          const data = (await response.json()) as {
            comment?: string;
            marks?: Array<{ type: 'check' | 'cross'; cell: string }>;
            corrections?: string[];
          };
          const marks = (data.marks ?? [])
            .map((mark) => {
              const center = cellCenter(mark.cell);
              return center ? { type: mark.type, x: center.x, y: center.y } : null;
            })
            .filter((mark): mark is { type: 'check' | 'cross'; x: number; y: number } => mark !== null);
          setGradeMarks(marks);
          // 老师示范：正确写法上板（暂停态下解开 BoardCanvas 冻结，串行书写），
          // 示范写完再续播——老师把正确步骤留在学生笔迹旁边才继续讲课
          const demo = (data.corrections ?? []).filter((line) => line.trim());
          setGradeDemo(demo);
          const demoMs =
            demo.length > 0 ? demo.reduce((sum, line) => sum + line.length * 500 + 1500, 800) : 0;
          const finish = () => {
            if (demoMs > 0) setTimeout(resume, demoMs);
            else resume();
          };
          if (data.comment?.trim()) {
            // 点评念完再续播（有示范则等示范写完），避免和讲解叠在一起
            speak(data.comment.trim(), finish);
            return;
          }
          finish();
          return;
        }
        resume();
      } catch {
        resume(); // 批改不可用不挡播放
      } finally {
        setGrading(false);
      }
    })();
  };

  // 冷启动备课态：播放已开始但首个动作还未触发（首段音频在合成）；
  // 流式生成等待态：播到当前末尾、后续单元还在生成，同样显示备课中
  const preparing =
    (player.status === 'playing' &&
      player.pageIndex === 0 &&
      player.segmentIndex === 0 &&
      player.triggered.length === 0 &&
      !player.checkpoint) ||
    player.status === 'waiting';

  // 自动播放策略：首段音频等手势（segment-clock 广播），粉笔字引导点一下
  const [awaitingGesture, setAwaitingGesture] = useState(false);
  useEffect(() => {
    const onAwaiting = (event: Event) =>
      setAwaitingGesture((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('board:awaiting-gesture', onAwaiting);
    return () => window.removeEventListener('board:awaiting-gesture', onAwaiting);
  }, []);

  const toggleInk = () => {
    if (inkActive) {
      finishInk();
      return;
    }
    // checkpoint 等待态禁止进板演：此时 player.pause() 是 no-op，播放会在
    // 笔迹层下继续跑，翻页把刚画的笔迹清掉、批改勾叉落到错误的页（实测）
    if (player.status === 'checkpoint') return;
    player.pause();
    setGradeMarks([]); // 新一轮板演，清掉上一轮的批改痕迹
    setGradeDemo([]);
    setInkActive(true);
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: '#161e21', borderRadius: 12, padding: 14, gap: 12 }}
    >
      <div className="min-h-0 flex-1" style={{ position: 'relative' }}>
        <BoardCanvas
          page={page}
          pageIndex={player.pageIndex}
          triggered={player.triggered}
          onAllWritesDone={(done) => {
            writesDoneRef.current = done;
          }}
          onInkBacklog={(pending) => {
            inkBacklogRef.current = pending;
          }}
          budgets={player.actionBudgets}
          fontFamily={fontFamily}
          extraWrites={extraWrites}
          extraAnnotations={extraAnnotations}
          debugBounds={debugBounds}
          preparing={preparing}
          paused={player.status === 'paused' && gradeDemo.length === 0}
        />
        {player.status === 'checkpoint' && machine.stage === 'wait' && waitPanelReady ? (
          <CheckpointPanel
            state={machine}
            onKnow={() => dispatch('know')}
            onHint={() => dispatch('hint')}
            onShowAnswer={() => dispatch('show_answer')}
          />
        ) : null}
        {awaitingGesture ? (
          <div
            className="mm-chalk-text"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4a453c',
              fontFamily: fontFamily ?? BOARD_FONT,
              fontSize: 24,
              letterSpacing: '0.14em',
              animation: 'mm-page-in 0.4s ease-out',
              cursor: 'pointer',
              pointerEvents: 'none',
            }}
          >
            {COPY.apps.explainer.awaitingGesture}
          </div>
        ) : null}
        {interlude ? (
          <RefInterlude
            page={script.pages[interlude.pageIndex] ?? page}
            target={interlude.target}
            fontFamily={fontFamily}
          />
        ) : null}
        {inkActive ? (
          <StudentInkLayer
            strokes={strokes}
            onStrokeAdd={(stroke) => setStrokes((prev) => [...prev, stroke])}
          />
        ) : null}
        {/* 批改后学生笔迹留在板上（静态层），勾叉落在旁边才有意义 */}
        {!inkActive && strokes.length > 0 ? <StaticInkLayer strokes={strokes} /> : null}
        {/* 批改勾叉：rough 手绘落在网格 cell 中心偏右上（不压住学生笔迹） */}
        {gradeMarks.length > 0 ? (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 5, pointerEvents: 'none' }}
            viewBox="0 0 960 540"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {gradeMarks.map((mark, index) => (
              <RoughStroke
                key={`grade-${index}`}
                kind={mark.type}
                rect={{ x: mark.x + 20, y: mark.y - 58, width: 40, height: 40 }}
                seed={hashSeed(`grade-${mark.type}-${Math.round(mark.x)}-${Math.round(mark.y)}`)}
              />
            ))}
          </svg>
        ) : null}
      </div>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          {player.status === 'playing' ? (
            <ControlButton onClick={player.pause} label={COPY.apps.explainer.pause} />
          ) : (
            <ControlButton
              onClick={player.status === 'finished' ? player.replay : player.play}
              label={player.status === 'finished' ? COPY.apps.explainer.replay : COPY.apps.explainer.play}
            />
          )}
          {player.status !== 'finished' ? (
            <ControlButton onClick={player.replay} label={COPY.apps.explainer.replay} />
          ) : null}
          <ControlButton onClick={player.toggleSpeed} label={player.speed === 1 ? '1x' : '1.5x'} />
          <ControlButton
            onClick={toggleInk}
            label={inkActive ? COPY.apps.explainer.inkDone : COPY.apps.explainer.inkStart}
            active={inkActive}
            disabled={player.status === 'checkpoint'}
          />
          {inkActive && strokes.length > 0 ? (
            <ControlButton
              onClick={() => {
                setStrokes([]);
                setGradeMarks([]);
              }}
              label={COPY.apps.explainer.inkClear}
            />
          ) : null}
        </div>
        <span style={{ fontSize: 12, color: 'rgba(245,242,232,0.55)' }}>
          {COPY.apps.explainer.pageLabel(player.pageIndex + 1, player.pageCount)}
        </span>
      </div>
    </div>
  );
}
