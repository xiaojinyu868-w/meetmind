'use client';

/**
 * DEMO 页（临时，后续可删）：板书精讲播放器演示。
 *
 * 两种模式：
 * 1. 静态：fetch /demo/board-script.json（scripts/run-board-demo.ts 生成）
 * 2. 拍题开讲（Phase 1 AHA）：上传题目照片 → POST /api/board/photo-explain
 *    （审题 → 独立解题 → BoardScript）→ BlackboardPlayer 播放生成的讲解
 *
 * DEMO：?font=muyao|xiaolai 字体 A/B 实拍（v32 起生产默认是系统屏显栈，
 * 手写体全部退役，该参数仅供历史对比）；
 * ?pace=40 加速播放；?debug=bounds 标注实测 rect 细线框。
 */

import { useEffect, useRef, useState } from 'react';
import type { BoardScript } from '@/lib/ai-native/plugins/board-script';
import { sanitizeBoardScript } from '@/lib/ai-native/plugins/board-script';
import { BlackboardPlayer } from '@/components/apps/windows/blackboard/BlackboardPlayer';
import { COPY } from '@/lib/ui/copy';

interface DemoPayload {
  script: BoardScript;
  quoteStats?: { total: number; verified: number; downgraded: number };
}

type PhotoStage = 'idle' | 'reading' | 'solving' | 'preparing';

/** DEMO 字体历史对比候选（public/demo/fonts/ 下的临时评估字体；v32 起默认系统屏显栈） */
const DEMO_FONTS: Record<string, { family: string; src: string }> = {
  muyao: { family: 'DemoMuyao', src: '/demo/fonts/Muyao-Softbrush.ttf' },
  xiaolai: { family: 'DemoXiaolai', src: '/demo/fonts/XiaolaiSC-Regular.ttf' },
};

/** 上传前压缩：最长边 1600、JPEG 0.85（VLM 够用，省流量省 token） */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function DemoBoardPage() {
  const [payload, setPayload] = useState<DemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // DEMO：?pace=40 可加速播放（每字估时 ms，默认 280），方便截图/录屏验收
  const [pace, setPace] = useState<number | undefined>(undefined);
  // DEMO：?font= 字体决赛实拍覆盖
  const [fontOverride, setFontOverride] = useState<string | undefined>(undefined);
  const [fontFaceCss, setFontFaceCss] = useState<string>('');
  // DEMO：?debug=bounds 标注实测 rect 细线框
  const [debugBounds, setDebugBounds] = useState(false);
  // 拍题开讲：idle 静态模式；reading→solving→preparing 为等待阶段文案轮播
  const [photoStage, setPhotoStage] = useState<PhotoStage>('idle');
  const [photoError, setPhotoError] = useState<string | null>(null);
  // 流式生成中（后续讲解单元还在下发）：播放器播到当前末尾进等待态而非完结
  const [streaming, setStreaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('pace');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 280) setPace(parsed);

    if (params.get('debug') === 'bounds') setDebugBounds(true);
    const fontKey = params.get('font') ?? '';
    const demoFont = DEMO_FONTS[fontKey];
    if (demoFont) {
      setFontOverride(`'${demoFont.family}', -apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif`);
      setFontFaceCss(
        `@font-face { font-family: '${demoFont.family}'; src: url('${demoFont.src}') format('truetype'); font-display: swap; }`,
      );
    }
  }, []);

  function loadStaticScript(onlyIfEmpty: boolean) {
    // DEMO：?script=board-script-overload.json 加载 /demo/ 下的替代板书脚本（布局回归验证用）
    const param = new URLSearchParams(window.location.search).get('script');
    const name = param && /^[\w.-]+\.json$/.test(param) ? param : 'board-script.json';
    fetch(`/demo/${name}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: DemoPayload) => {
        // 静态文件也过一遍清洗，坏动作跳过不崩
        const { script } = sanitizeBoardScript(data.script);
        if (onlyIfEmpty) {
          setPayload((prev) => prev ?? { ...data, script });
        } else {
          setPayload({ ...data, script });
        }
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }

  useEffect(() => {
    loadStaticScript(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    stageTimersRef.current.forEach(clearTimeout);
  }, []);

  function clearStageTimers() {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
  }

  async function handlePhotoFile(file: File) {
    setPhotoError(null);
    clearStageTimers();
    // 清空旧板书：生成期间黑板让给「老师看题/解题/备课」等待态，绝不让旧课继续播
    setPayload(null);
    // 阶段文案按链路节奏轮播（审题 → 解题 → 备课），单请求覆盖全程
    setPhotoStage('reading');
    stageTimersRef.current = [
      setTimeout(() => setPhotoStage('solving'), 6000),
      setTimeout(() => setPhotoStage('preparing'), 30000),
    ];
    try {
      const image = await compressImage(file);
      // 流式开讲（Skeleton-of-Thought）：大纲 → 单元逐个下发，第一个单元到达即开播
      const response = await fetch('/api/board/photo-explain-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotUnit = false;
      let streamTitle = '';
      // 逐行解析 SSE（data: {...}\n\n）
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let event: {
            type: string;
            title?: string;
            pageIndex?: number;
            page?: BoardScript['pages'][number];
            error?: string;
          };
          try {
            event = JSON.parse(line.slice(5)) as typeof event;
          } catch {
            continue;
          }
          if (event.type === 'meta' && event.title) {
            streamTitle = event.title;
          } else if (event.type === 'unit' && event.page) {
            gotUnit = true;
            const page = event.page;
            setPayload((prev) => {
              const base = prev?.script ?? { title: streamTitle, pages: [], quotes: [] };
              return { script: { ...base, pages: [...base.pages, page] } };
            });
            setPhotoStage('idle');
            setStreaming(true);
          } else if (event.type === 'error') {
            setPhotoError(
              event.error === 'not_a_problem'
                ? COPY.apps.explainer.photoErrorNotProblem
                : COPY.apps.explainer.photoErrorGeneric,
            );
            setPhotoStage('idle');
            loadStaticScript(false); // 失败兜底：回到静态板书，不留空黑板
            return;
          }
          // unit-error：跳过该单元，其余照播（页内 ref 越界由 sanitize 兜底）
        }
      }
      if (!gotUnit) throw new Error('no units');
    } catch {
      setPhotoError(COPY.apps.explainer.photoErrorGeneric);
      setPhotoStage('idle');
      loadStaticScript(false); // 同上，失败兜底回静态板书
    } finally {
      clearStageTimers();
      setStreaming(false);
    }
  }

  const busy = photoStage !== 'idle';
  const stageText =
    photoStage === 'reading'
      ? COPY.apps.explainer.photoStageReading
      : photoStage === 'solving'
        ? COPY.apps.explainer.photoStageSolving
        : photoStage === 'preparing'
          ? COPY.apps.explainer.photoStagePreparing
          : null;
  const stats = payload?.quoteStats;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#10181b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px',
      }}
    >
      {fontFaceCss ? <style>{fontFaceCss}</style> : null}
      <div style={{ width: '100%', maxWidth: 960 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <h1 style={{ color: '#f5f2e8', fontSize: 17, fontWeight: 500 }}>
            {payload?.script.title ?? COPY.apps.explainer.appName}
          </h1>
          {stats && stats.verified > 0 ? (
            <span style={{ color: '#A8C8A0', fontSize: 12 }}>
              {COPY.apps.explainer.quotesVerified(stats.verified)}
            </span>
          ) : null}
          {stats && stats.downgraded > 0 ? (
            <span style={{ color: 'rgba(245,242,232,0.5)', fontSize: 12 }}>
              {COPY.apps.explainer.quotesDowngraded(stats.downgraded)}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handlePhotoFile(file);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: busy ? 'rgba(245,242,232,0.15)' : '#E8B84B',
              color: '#10181b',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? stageText : COPY.apps.explainer.photoEntry}
          </button>
        </header>

        {photoError ? (
          <p style={{ color: '#D98271', fontSize: 14 }}>{photoError}</p>
        ) : null}
        {error ? (
          <p style={{ color: '#D98271', fontSize: 14 }}>
            加载板书脚本失败：{error}（先跑 npx tsx scripts/run-board-demo.ts）
          </p>
        ) : null}
        {busy ? (
          <div
            style={{
              border: '3px solid #6b5d43',
              borderRadius: 6,
              background: '#16211f',
              minHeight: 420,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                color: 'rgba(245,242,232,0.85)',
                fontSize: 30,
                letterSpacing: 2,
              }}
            >
              {stageText}
            </span>
          </div>
        ) : null}
        {!busy && !payload && !error ? (
          <p style={{ color: 'rgba(245,242,232,0.6)', fontSize: 14 }}>正在加载板书脚本…</p>
        ) : null}
        {!busy && payload ? (
          <BlackboardPlayer
            key={payload.script.title}
            script={payload.script}
            paceMsPerChar={pace}
            fontFamily={fontOverride}
            debugBounds={debugBounds}
            generating={streaming}
          />
        ) : null}
      </div>
    </div>
  );
}
