'use client';

/**
 * CheatsheetWindow — 考试速查表：一张真正的纸。
 *
 * 2026-09-09 重做（对标 HyperKnow，目标是比它好看）：
 *   - 纸面是 A4 逻辑页，屏幕上整页等比缩放、打印 1:1，看到的就是打印出来的；
 *   - 按考试主题组织（编号章节 → 条目），条目用三色荧光笔标类型（定义 = 黄 / 公式 = 绿 / 易错 = 朱红），
 *     老师强调的画朱红波浪线；正文永远墨色，黑白打印也成立；
 *   - 分页靠实测（use-cheatsheet-layout），字号 / 栏数 / 密度 / 「装进一页」都是精确结果；
 *   - 版式控件是一行文字（CheatsheetToolbar），偏好记在 localStorage（CHEATSHEET_LAYOUT_PREF_KEY）；
 *   - 「回到原话」降到最轻：正文无时间戳，hover 才有 ↩，页脚一行「来自《课》」；
 *   - 窄容器（< 640px）切成单栏长文，手机上一样好读。
 * 轻编辑（改 / 不打印 / 收起主题）只属于当前产物，不写回长期学习上下文。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { CheatsheetItem, CheatsheetPayload, CheatsheetTopic } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { CheatsheetItemBlock, CheatsheetTopicHeading, type CheatsheetItemEdit } from './CheatsheetItemBlock';
import { CheatsheetFirstHead, CheatsheetFlow, CheatsheetPages, CheatsheetRunningHead } from './CheatsheetPaper';
import { CheatsheetToolbar, type CheatsheetZoom } from './CheatsheetToolbar';
import { CHEATSHEET_PAPER_CSS } from './cheatsheet-paper-styles';
import {
  CHEATSHEET_DENSITY_PRESETS,
  CHEATSHEET_FLOW_MAX_WIDTH,
  CHEATSHEET_PAGE,
  DEFAULT_CHEATSHEET_LAYOUT,
  payloadToMarkdown,
  readLayoutPrefs,
  topicsOf,
  writeLayoutPrefs,
  type CheatsheetLayoutPrefs,
} from './cheatsheet-window-model';
import { blockOrderOf, useCheatsheetLayout } from './use-cheatsheet-layout';
import { isTypingTarget } from './app-keys';
import { useKeyboardHintOnce } from './keyboard-hints';

interface CheatsheetWindowProps {
  result: AppExecutionResult | null;
  /** 有宿主能回到课堂原声时，条目 hover 的 ↩ 才可点；多课范围下通常不传 */
  onSeek?: (ms: number) => void;
}

/** 手机长文的字号：不跟 A4 逻辑页共用（那是打印字号，屏上读太小） */
const FLOW_FONT_PX = 13.5;

function extractPayload(result: AppExecutionResult | null): CheatsheetPayload | null {
  const payload = result?.render?.payload as Partial<CheatsheetPayload> | undefined;
  if (!payload || !Array.isArray(payload.sections) || typeof payload.title !== 'string') return null;
  return payload as CheatsheetPayload;
}

function useContainerWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    const update = () => setWidth(node.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
}

export function CheatsheetWindow({ result, onSeek }: CheatsheetWindowProps) {
  const payload = extractPayload(result);

  // ── 版式偏好（记住）
  const [prefs, setPrefs] = useState<CheatsheetLayoutPrefs>(DEFAULT_CHEATSHEET_LAYOUT);
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    setPrefs(readLayoutPrefs(typeof window === 'undefined' ? undefined : window.localStorage));
    prefsLoadedRef.current = true;
  }, []);
  const updatePrefs = useCallback((patch: Partial<CheatsheetLayoutPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeLayoutPrefs(typeof window === 'undefined' ? undefined : window.localStorage, next);
      return next;
    });
  }, []);

  // ── 轻编辑（只属于当前产物）
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [hiddenTopicIds, setHiddenTopicIds] = useState<Set<string>>(new Set());
  const [itemEdits, setItemEdits] = useState<Record<string, CheatsheetItemEdit>>({});
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');
  const [zoom, setZoom] = useState<CheatsheetZoom>('fit');
  const showKeyboardHint = useKeyboardHintOnce('cheatsheet');

  const editedPayload = useMemo<CheatsheetPayload | null>(() => {
    if (!payload) return null;
    const applyEdits = (item: CheatsheetItem): CheatsheetItem => ({ ...item, ...itemEdits[item.id] });
    return {
      ...payload,
      sections: payload.sections.map((section) => ({ ...section, items: section.items.map(applyEdits) })),
      topics: payload.topics?.map((topic) => ({ ...topic, items: topic.items.map(applyEdits) })),
    };
  }, [itemEdits, payload]);

  const visibleTopics = useMemo<CheatsheetTopic[]>(() => {
    if (!editedPayload) return [];
    return topicsOf(editedPayload)
      .filter((topic) => !hiddenTopicIds.has(topic.id))
      .map((topic) => ({ ...topic, items: topic.items.filter((item) => !hiddenItemIds.has(item.id)) }))
      .filter((topic) => topic.items.length > 0);
  }, [editedPayload, hiddenItemIds, hiddenTopicIds]);
  const topicIndexById = useMemo(() => new Map(visibleTopics.map((topic, index) => [topic.id, index])), [visibleTopics]);
  const itemById = useMemo(() => new Map(visibleTopics.flatMap((topic) => topic.items.map((item) => [item.id, item] as const))), [visibleTopics]);
  const topicById = useMemo(() => new Map(visibleTopics.map((topic) => [topic.id, topic] as const)), [visibleTopics]);

  const totalItems = useMemo(() => (editedPayload ? topicsOf(editedPayload).reduce((sum, topic) => sum + topic.items.length, 0) : 0), [editedPayload]);
  const visibleItems = visibleTopics.reduce((sum, topic) => sum + topic.items.length, 0);
  const hiddenCount = totalItems - visibleItems;
  const lessonCount = (payload?.sources ?? []).filter((source) => source.kind === 'lesson').length;

  // ── 容器宽度决定：A4 分页（缩放到宽）还是单栏长文
  const [deskRef, deskWidth] = useContainerWidth();
  const flow = deskWidth > 0 && deskWidth < CHEATSHEET_FLOW_MAX_WIDTH;
  const fitScale = deskWidth > 0 ? Math.min(1.2, (deskWidth - 40) / CHEATSHEET_PAGE.width) : 1;
  const displayScale = zoom === 'fit' ? fitScale : zoom;

  const layout = useCheatsheetLayout(visibleTopics, prefs, Boolean(payload) && !flow);
  const density = CHEATSHEET_DENSITY_PRESETS[prefs.density];

  // 栏数 / 密度 / 字号 / 装进一页 一变，纸面重排是瞬间的：给它一次 220ms 的重新进场（key 变 → mm-app-enter），
  // 缩放（displayScale）不走这里——纸的 transform / 尺寸自己有 280ms 过渡
  const reflowKey = `${prefs.columns}:${prefs.density}:${prefs.fontPx}:${prefs.fitOnePage}`;

  // 键盘：− / + 缩放，0 回到适合宽度（正在输入时不抢；窄屏单栏流没有缩放）
  useEffect(() => {
    if (flow) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null) || event.metaKey || event.ctrlKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((current) => Math.min(2, Math.round(((current === 'fit' ? fitScale : current) + 0.1) * 10) / 10)); }
      else if (event.key === '-') { event.preventDefault(); setZoom((current) => Math.max(0.4, Math.round(((current === 'fit' ? fitScale : current) - 0.1) * 10) / 10)); }
      else if (event.key === '0') { event.preventDefault(); setZoom('fit'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitScale, flow]);

  const handleHideItem = useCallback((itemId: string) => setHiddenItemIds((prev) => new Set(prev).add(itemId)), []);
  const handleHideTopic = useCallback((topicId: string) => setHiddenTopicIds((prev) => new Set(prev).add(topicId)), []);
  const handleEditItem = useCallback((itemId: string, next: CheatsheetItemEdit) => setItemEdits((current) => ({ ...current, [itemId]: next })), []);
  const handleRestoreHidden = useCallback(() => { setHiddenItemIds(new Set()); setHiddenTopicIds(new Set()); }, []);
  const handlePrint = useCallback(() => { if (typeof window !== 'undefined') window.print(); }, []);
  const handleCopy = useCallback(async () => {
    if (!editedPayload) return;
    const ok = await copyToClipboard(payloadToMarkdown(editedPayload, { hiddenItemIds, hiddenTopicIds, focusLabel: APPS_COPY.cheatsheet.focus }));
    if (!ok) return;
    setCopyState('done');
    window.setTimeout(() => setCopyState('idle'), 1800);
  }, [editedPayload, hiddenItemIds, hiddenTopicIds]);

  /** 页面与量高容器共用：同一个 id 渲染同一个块（量高用静态版，不挂交互） */
  const renderBlock = useCallback((blockId: string, isStatic = false): ReactNode => {
    if (blockId.startsWith('heading:')) {
      const topic = topicById.get(blockId.slice('heading:'.length));
      if (!topic) return null;
      return (
        <CheatsheetTopicHeading
          key={blockId}
          topic={topic}
          index={topicIndexById.get(topic.id) ?? 0}
          static={isStatic}
          onHide={() => handleHideTopic(topic.id)}
        />
      );
    }
    const item = itemById.get(blockId.slice('item:'.length));
    if (!item) return null;
    return (
      <CheatsheetItemBlock
        key={blockId}
        item={item}
        static={isStatic}
        onHide={() => handleHideItem(item.id)}
        onEdit={(next) => handleEditItem(item.id, next)}
        onSeek={onSeek}
      />
    );
  }, [handleEditItem, handleHideItem, handleHideTopic, itemById, onSeek, topicById, topicIndexById]);

  if (!payload || !editedPayload) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.cheatsheet.appName} description={APPS_COPY.cheatsheet.emptyBody} />;
  }

  const rootVars = {
    ['--cs-font' as string]: `${flow ? FLOW_FONT_PX : layout.effectiveFontPx}px`,
    ['--cs-lh' as string]: flow ? 1.6 : density.lineHeight,
    ['--cs-item-gap' as string]: `${flow ? 0.45 : density.itemGap}em`,
    ['--cs-topic-gap' as string]: `${flow ? 1.4 : density.topicGap}em`,
  } as CSSProperties;
  const blockIds = blockOrderOf(visibleTopics).map((block) => block.id);

  return (
    <div className="cs-root flex h-full min-h-0 flex-col bg-paper" data-highlight={prefs.highlight ? 'on' : 'off'} style={rootVars}>
      <CheatsheetToolbar
        title={editedPayload.title}
        generatedAt={editedPayload.generatedAt}
        pageCount={layout.pages.length}
        itemCount={visibleItems}
        hiddenCount={hiddenCount}
        prefs={prefs}
        effectiveFontPx={layout.effectiveFontPx}
        flow={flow}
        zoom={zoom}
        displayScale={displayScale}
        copyState={copyState}
        onPrefsChange={updatePrefs}
        onZoomChange={setZoom}
        onRestoreHidden={handleRestoreHidden}
        onPrint={handlePrint}
        onCopy={() => void handleCopy()}
        keyboardHint={showKeyboardHint && !flow ? APPS_COPY.cheatsheet.keyboardHint : undefined}
      />

      {/* 桌面：纸放在桌上 */}
      <div ref={deskRef} className="cs-desk relative flex-1 overflow-auto px-3 pb-10 pt-1 sm:px-5">
        {visibleTopics.length === 0 ? (
          <p className="cs-noprint mx-auto max-w-md py-16 text-center text-[12.5px] text-ink-muted">{APPS_COPY.cheatsheet.allRemoved}</p>
        ) : flow ? (
          <CheatsheetFlow payload={editedPayload} lessonCount={lessonCount} blockIds={blockIds} highlight={prefs.highlight} renderBlock={renderBlock} />
        ) : (
          <>
            <div key={reflowKey} className="mm-app-enter" style={{ opacity: layout.ready ? 1 : 0, transition: 'opacity 160ms ease' }}>
              <CheatsheetPages
                payload={editedPayload}
                lessonCount={lessonCount}
                pages={layout.pages}
                pageHeight={layout.pageHeight}
                columns={prefs.columns}
                displayScale={displayScale}
                highlight={prefs.highlight}
                renderBlock={(id) => renderBlock(id)}
              />
            </div>
            {/* 量高容器：与页内同栏宽同字号；隐藏在视口外 */}
            <div ref={layout.measurerRef} className="cs-measure cs-noprint" aria-hidden style={{ width: CHEATSHEET_PAGE.width - CHEATSHEET_PAGE.padX * 2 }}>
              <CheatsheetFirstHead payload={editedPayload} highlight={prefs.highlight} />
              <CheatsheetRunningHead payload={editedPayload} />
              <div style={{ width: layout.columnWidth }}>
                {blockIds.map((id) => <div key={id}>{renderBlock(id, true)}</div>)}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{CHEATSHEET_PAPER_CSS}</style>
    </div>
  );
}

export default CheatsheetWindow;
