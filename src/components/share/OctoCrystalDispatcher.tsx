'use client';

/**
 * OctoCrystalDispatcher — 「递结晶」模块（v3.0 SharedAgent 入口仪式）
 *
 * 录完课、做完应用之后，Octo Buddy 抱着今天的"结晶"出现，让你挑一个递给同学。
 * 这是 v3.0 战略文档第 5.4 节定义的裂变发起入口——不是按钮，是仪式时刻。
 *
 * 任务（roadmap/v3.0-virality-agent.md）：
 *   - P0：在应用矩阵首屏 / 录课结束页面挂一个明显的入口
 *   - 隐私：snapshot 只带场景层产物（cheatsheet / mindmap / quiz / infographic），
 *     绝不带个人层（闪卡 / 学习报告）
 *
 * 视觉：
 *   - 仪式时刻 #4「录课结束的收尾动画」白名单使用 ceremony-* 色（设计系统 §5）
 *   - Octo Buddy lg + happy mood，带 happyHop 动画
 *   - 4 张 tile（速查表 / 思维导图 / 测验 / 信息图）2x2 / 4-col 自适应
 *   - 已生成 = 暖白底 + 微光描边 + 「递给同学」CTA
 *   - 未生成 = 灰阶 + 「先做一版」hint，点击跳到对应应用页
 *   - 没有任何产物时，整个模块用极轻的"结晶还没出现"空态
 *
 * 数据来源：
 *   - localStorage `app_workspace_result:{sessionId}:{appKey}`（应用矩阵共享缓存）
 *   - 上层透传 transcript（用于 transcriptDigest）+ courseTitle / subject
 *
 * 触发：
 *   - 点已生成 tile → 调用 `useShareAgentCreator.openCreator(snapshot)`
 *   - 点未生成 tile → onNavigateToApp(appKey) 或者直接跳 /app/matrix/{appKey}
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';
import { useShareAgentCreator } from '@/components/share/useShareAgentCreator';
import { readCachedAppResult } from '@/lib/utils/app-execution-cache';
import { getSessionById } from '@/lib/db/sessions';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import type {
  SharedAgentSnapshot,
  ShareArtifactKind,
} from '@/lib/services/share-agent-service';

// ──────────────────────────────────────────────────────────────
// 配置：可分享的场景层应用（不含 flashcards / study-report）
// ──────────────────────────────────────────────────────────────

interface ShareableApp {
  appKey: 'cheatsheet' | 'mindmap' | 'quiz' | 'infographic';
  artifactKind: ShareArtifactKind;
  label: string;
  /** 卡片上的提示文案——一行 */
  blurb: string;
  /** 极简内联 SVG icon（不依赖 lucide，颗粒感更克制） */
  icon: React.ReactNode;
  /** 仪式态背景色（hover 时露出） */
  glow: string;
  /** 跳转到对应应用的 href（未生成时用） */
  hrefTemplate: (sessionId: string) => string;
}

const SHAREABLE_APPS: ShareableApp[] = [
  {
    appKey: 'cheatsheet',
    artifactKind: 'cheatsheet',
    label: '考前速查表',
    blurb: '一页纸 · 考前最后看一眼',
    glow: '#FBF2EF',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="3.5" width="14" height="17" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    ),
    hrefTemplate: (sessionId) => `/app/matrix/cheatsheet?sessionId=${encodeURIComponent(sessionId)}`,
  },
  {
    appKey: 'mindmap',
    artifactKind: 'mindmap',
    label: '思维导图',
    blurb: '把整节课的脉络拎清',
    glow: '#E6EDE8',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="2.6" />
        <circle cx="4.5" cy="6" r="1.8" />
        <circle cx="4.5" cy="18" r="1.8" />
        <circle cx="19.5" cy="6" r="1.8" />
        <circle cx="19.5" cy="18" r="1.8" />
        <path d="M9.6 11l-3.5-4M9.6 13l-3.5 4M14.4 11l3.5-4M14.4 13l3.5 4" strokeLinecap="round" />
      </svg>
    ),
    hrefTemplate: (sessionId) => `/app/matrix/mindmap?sessionId=${encodeURIComponent(sessionId)}`,
  },
  {
    appKey: 'quiz',
    artifactKind: 'quiz',
    label: '课堂测验',
    blurb: '丢进群里 · 谁先答对',
    glow: '#FBF2EF',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3.5a4.5 4.5 0 014.5 4.5c0 2.4-3 3.6-3 6h-3c0-2.4-3-3.6-3-6A4.5 4.5 0 0112 3.5z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    hrefTemplate: (sessionId) => `/app/matrix/quiz?sessionId=${encodeURIComponent(sessionId)}`,
  },
  {
    appKey: 'infographic',
    artifactKind: 'infographic',
    label: '课堂信息图',
    blurb: '一张图看懂这节课',
    glow: '#FBF2EF',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="7" height="7" rx="1.4" />
        <rect x="13" y="4" width="7" height="11" rx="1.4" />
        <rect x="4" y="13" width="7" height="7" rx="1.4" />
        <rect x="13" y="17" width="7" height="3" rx="1.2" />
      </svg>
    ),
    hrefTemplate: (sessionId) => `/app/matrix/infographic?sessionId=${encodeURIComponent(sessionId)}`,
  },
];

// ──────────────────────────────────────────────────────────────
// Snapshot 组装 helpers
// ──────────────────────────────────────────────────────────────

/**
 * 从 transcript 段落里挑出关键片段——v0 用最简单的策略：
 * 取前 30 段 / 跨度均匀采样，避免过大 payload。
 */
function buildTranscriptDigest(segments: TranscriptSegment[]) {
  if (!segments || segments.length === 0) {
    return { totalSec: 0, segments: [] as Array<{ startSec: number; endSec: number; text: string }> };
  }
  const totalSec = Math.ceil((segments[segments.length - 1].endMs ?? 0) / 1000);

  // 如果段落不多，直接全用
  const MAX_SEGS = 30;
  let picked: TranscriptSegment[];
  if (segments.length <= MAX_SEGS) {
    picked = segments;
  } else {
    // 跨度均匀采样
    const step = segments.length / MAX_SEGS;
    picked = [];
    for (let i = 0; i < MAX_SEGS; i += 1) {
      picked.push(segments[Math.floor(i * step)]);
    }
  }

  return {
    totalSec,
    segments: picked
      .filter((s) => (s.text ?? '').trim().length > 0)
      .map((s) => ({
        startSec: Math.floor((s.startMs ?? 0) / 1000),
        endSec: Math.ceil((s.endMs ?? 0) / 1000),
        text: (s.text ?? '').trim().slice(0, 800),
      })),
  };
}

/**
 * 从 AppExecutionResult 抽一句 hookLine 用于分享卡片头图 + system prompt。
 */
function buildArtifactSummary(result: AppExecutionResult | null): string {
  if (!result) return '';
  if (result.render?.title) return result.render.title;
  if (result.render?.description) return result.render.description.slice(0, 120);
  if (result.cards && result.cards.length > 0) {
    const first = result.cards[0];
    return first.title ?? first.body?.slice(0, 80) ?? '';
  }
  return '';
}

/**
 * 兜底分享者昵称：
 * - 用户未设置 nickname 时，注册兜底是 username（手机号 / 邮箱前缀）
 *   → 看起来像 "1181783314"——电话号当昵称很丑、还泄露隐私
 * - 这里用启发式判断："看起来像电话号 / 纯数字 / 看起来像 user.id"
 *   都视为 invalid nickname，让 ShareAgentCard 不渲染 sharer 行
 */
function sanitizeNickname(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // 纯数字 ≥ 6 位（看起来像电话号 / cuid 数字段）
  if (/^\d{6,}$/.test(trimmed)) return undefined;
  // cuid / uuid 风格（含字母 + 数字、长度 ≥ 18）
  if (trimmed.length >= 18 && /^[a-z0-9]+$/i.test(trimmed)) return undefined;
  // 看起来像邮箱前 @ 段（含 @）
  if (trimmed.includes('@')) return trimmed.split('@')[0] || undefined;
  return trimmed;
}

/**
 * 兜底课程标题：如果 IndexedDB 拿到的是默认占位（"课堂录音" / 空），
 * 用 artifact 内 title 或泛化"一节课"——避免大标题写"课堂录音"这种空泛话。
 */
const PLACEHOLDER_COURSE_TITLES = new Set(['课堂录音', '未命名课堂', '新课堂']);
function isPlaceholderCourseTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (!t) return true;
  return PLACEHOLDER_COURSE_TITLES.has(t);
}

// ──────────────────────────────────────────────────────────────
// 组件
// ──────────────────────────────────────────────────────────────

export interface OctoCrystalDispatcherProps {
  sessionId: string;
  /** 课程标题（拼进 snapshot.title）。不传则自动从 IndexedDB session.topic 读取 */
  courseTitle?: string;
  /** 学科 / 上下文（可选） */
  subject?: string;
  /** 用于构造 transcriptDigest 的转录段落 */
  transcript?: TranscriptSegment[];
  /** 摘要文本（如果上层有现成的，会作为 conversationContext 注入分享态 prompt） */
  summary?: string;
  /** 隐藏整个模块（外部条件控制） */
  hidden?: boolean;
}

interface AppGenStatus {
  appKey: ShareableApp['appKey'];
  generated: boolean;
  result: AppExecutionResult | null;
}

export function OctoCrystalDispatcher({
  sessionId,
  courseTitle: courseTitleProp,
  subject,
  transcript = [],
  summary,
  hidden = false,
}: OctoCrystalDispatcherProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { openCreator, isCreating, modal } = useShareAgentCreator();
  const [appStatuses, setAppStatuses] = React.useState<AppGenStatus[]>([]);
  const [pickingKey, setPickingKey] = React.useState<ShareableApp['appKey'] | null>(null);
  const [resolvedCourseTitle, setResolvedCourseTitle] = React.useState<string>(courseTitleProp || '');

  // 没传 courseTitle 时，从 IndexedDB session 拿 topic 作为标题
  React.useEffect(() => {
    if (courseTitleProp && courseTitleProp.trim()) {
      setResolvedCourseTitle(courseTitleProp.trim());
      return;
    }
    if (!sessionId) return;
    let cancelled = false;
    getSessionById(sessionId)
      .then((session) => {
        if (cancelled) return;
        const topic = session?.topic?.trim();
        if (topic) setResolvedCourseTitle(topic);
      })
      .catch(() => {
        // 读取失败不影响 dispatcher 渲染——用兜底
      });
    return () => {
      cancelled = true;
    };
  }, [courseTitleProp, sessionId]);

  // 监听 localStorage 缓存变化（应用生成完会写到 app_workspace_result:*）
  React.useEffect(() => {
    if (!sessionId) return;
    const refresh = () => {
      const next: AppGenStatus[] = SHAREABLE_APPS.map(({ appKey }) => {
        const result = readCachedAppResult(sessionId, appKey);
        return { appKey, generated: Boolean(result), result };
      });
      setAppStatuses(next);
    };
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.startsWith('app_workspace_result:')) refresh();
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [sessionId]);

  const generatedCount = appStatuses.filter((s) => s.generated).length;

  const handleShare = React.useCallback(
    async (app: ShareableApp, status: AppGenStatus) => {
      if (!status.generated || !status.result) {
        // 未生成：跳到对应应用页
        router.push(app.hrefTemplate(sessionId));
        return;
      }
      setPickingKey(app.appKey);
      try {
        const digest = buildTranscriptDigest(transcript);
        const artifactSummary = buildArtifactSummary(status.result);

        // nickname 兜底（电话号 / user.id 都过滤掉）
        const cleanNickname = sanitizeNickname(user?.nickname);

        // 课程标题：占位 / 空 都不要直接放上去
        const titleClean = !isPlaceholderCourseTitle(resolvedCourseTitle)
          ? resolvedCourseTitle.trim()
          : artifactSummary || '一节课';

        const hookLine = artifactSummary || titleClean;

        // 完整 artifact payload 进 snapshot.artifact —— v3.0 修正：
        //   - 之前只塞 summary 字符串，导致落地页 ArtifactPreview 无法渲染产物
        //   - artifact 是「场景层产物」按设计本来就要分享出去（不是隐私）
        //   - 体积：cheatsheet 6 区 ≈ 3-5KB / mindmap ≈ 2KB / quiz ≈ 5-8KB，SQLite 完全 OK
        const fullPayload = status.result.render?.payload;
        const snapshot: SharedAgentSnapshot = {
          title: titleClean || '一节课',
          subject,
          artifactKind: app.artifactKind,
          sharerNickname: cleanNickname,
          transcriptDigest: digest,
          conversationContext: summary?.trim() || undefined,
          artifact:
            fullPayload && typeof fullPayload === 'object'
              ? { summary: artifactSummary || undefined, payload: fullPayload }
              : artifactSummary
                ? { summary: artifactSummary }
                : undefined,
        };

        await openCreator(snapshot, {
          hookLine,
          // ShareAgentCard 仍接受 artifactPayload prop（已经在 snapshot.artifact.payload 里，但
          // useShareAgentCreator 把它单独提出来交给 Card，避免 Card 二次解 snapshot）
          artifactPayload: fullPayload,
        });
      } finally {
        setPickingKey(null);
      }
    },
    [resolvedCourseTitle, openCreator, router, sessionId, subject, summary, transcript, user?.nickname],
  );

  if (hidden || !sessionId) return null;

  return (
    <section
      className="relative overflow-hidden rounded-[28px] border border-divider/70 bg-white px-5 py-6 sm:px-7 sm:py-7 print:hidden"
      data-testid="octo-crystal-dispatcher"
    >
      {/* 仪式时刻：极淡的渐变光晕（白名单第 4 条「录课结束的收尾动画」）。
          只在背景，不进按钮 / 卡片，主区域仍然是平涂。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            'radial-gradient(circle at 12% 0%, #FBF2EF 0%, transparent 38%), radial-gradient(circle at 88% 12%, #E6EDE8 0%, transparent 42%), radial-gradient(circle at 50% 100%, #F2F6F3 0%, transparent 50%)',
        }}
      />

      <div className="relative flex flex-col gap-5">
        {/* 头部：Octo Buddy + 标题 */}
        <header className="flex items-start gap-4">
          <OctoBuddySprite mood="happy" size="lg" className="-mt-1 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              {COPY.share.creator.crystal.eyebrow}
            </p>
            <h3 className="mt-1.5 text-[20px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[22px]">
              {COPY.share.creator.crystal.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-[1.7] text-ink-secondary">
              {COPY.share.creator.crystal.subtitle}
            </p>
          </div>
        </header>

        {/* 4 张 tile：响应式 2 列 / 4 列 */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {SHAREABLE_APPS.map((app) => {
            const status = appStatuses.find((s) => s.appKey === app.appKey) ?? {
              appKey: app.appKey,
              generated: false,
              result: null,
            };
            const isReady = status.generated;
            const isPicking = pickingKey === app.appKey || (isCreating && pickingKey === app.appKey);

            const tileBase =
              'group relative flex h-full flex-col gap-2 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 ease-out';
            const tileReady =
              'border-divider bg-white text-ink hover:-translate-y-0.5 hover:border-ink/40';
            const tileMuted =
              'border-divider/60 bg-[#F2EDE3]/70 text-ink-muted hover:bg-white hover:text-ink-secondary';

            const tileClass = `${tileBase} ${isReady ? tileReady : tileMuted}`;

            const Inner = (
              <>
                {/* hover 微光（仅 ready 态） */}
                {isReady ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(circle at 30% 0%, ${app.glow}aa 0%, transparent 65%)`,
                    }}
                  />
                ) : null}

                <div className="relative flex items-center gap-2">
                  <span className={isReady ? 'text-ink' : 'text-ink-muted/70'}>{app.icon}</span>
                  <span className="text-[13.5px] font-semibold tracking-[-0.01em]">{app.label}</span>
                </div>
                <p className="relative text-[11.5px] leading-relaxed text-ink-muted">{app.blurb}</p>
                <div className="relative mt-auto flex items-center justify-between pt-1.5">
                  <span
                    className={`text-[11px] font-medium ${
                      isReady ? 'text-ink-secondary' : 'text-ink-muted/80'
                    }`}
                  >
                    {isPicking
                      ? COPY.share.creator.crystal.ctaPreparing
                      : isReady
                        ? COPY.share.creator.crystal.cardReady
                        : COPY.share.creator.crystal.cardEmpty}
                  </span>
                  {isReady ? (
                    <span
                      aria-hidden
                      className="text-ink-secondary transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                    >
                      →
                    </span>
                  ) : null}
                </div>
              </>
            );

            // 已生成：button 调 handleShare（保持 a11y + 视觉一致）
            // 未生成：渲染成 Link 直接跳应用页
            if (isReady) {
              return (
                <button
                  key={app.appKey}
                  type="button"
                  className={tileClass}
                  onClick={() => handleShare(app, status)}
                  disabled={isPicking}
                  data-testid={`crystal-tile-${app.appKey}`}
                >
                  {Inner}
                </button>
              );
            }
            return (
              <Link
                key={app.appKey}
                href={app.hrefTemplate(sessionId)}
                className={tileClass}
                data-testid={`crystal-tile-${app.appKey}`}
              >
                {Inner}
              </Link>
            );
          })}
        </div>

        {/* 底部小字：空态 hint + 隐私铁律 */}
        <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-ink-muted">
          {generatedCount === 0 ? <p>{COPY.share.creator.crystal.emptyHint}</p> : null}
          <p>{COPY.share.creator.crystal.privacyNote}</p>
        </div>
      </div>

      {/* 分享卡 modal */}
      {modal}
    </section>
  );
}

export default OctoCrystalDispatcher;
