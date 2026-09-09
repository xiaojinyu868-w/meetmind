'use client';

/**
 * 速查表纸面上的两种块：主题标题（编号 + 题）与条目（术语 + 解释 + 公式）。
 *
 * 条目的颜色只来自荧光笔（kind 决定色：定义 / 术语 = 黄，公式 / 结论 = 绿，易错 = 朱红），
 * 老师明确强调的条目在术语下加一道朱红波浪线——像红笔划过。正文永远是墨色。
 * 「回到原话」降成最轻的存在：hover 才出现一个 ↩，正文里没有任何时间戳。
 */

import { useState } from 'react';
import type { CheatsheetItem, CheatsheetTopic } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import { CheatsheetRichText } from '@/components/apps/windows/CheatsheetRichText';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { formatClock, itemKindOf } from './cheatsheet-window-model';

export type CheatsheetItemEdit = Pick<CheatsheetItem, 'term' | 'body' | 'latex'>;

/** 条目正文是否能和术语同段排（单行、无列表 / 表格 / 代码 / 引用） */
export function isCompactBody(body: string): boolean {
  return !/[\n\r]/.test(body) && !/^\s*(\||[-*+] |\d+\. |```|> |#{1,6} )/m.test(body);
}

interface TopicHeadingProps {
  topic: CheatsheetTopic;
  index: number;
  /** 量高度用的静态渲染：不挂交互 */
  static?: boolean;
  onHide?: () => void;
}

export function CheatsheetTopicHeading({ topic, index, static: isStatic, onHide }: TopicHeadingProps) {
  return (
    <div className="cs-block cs-heading" data-block-id={`heading:${topic.id}`} tabIndex={isStatic ? undefined : -1}>
      <span className="cs-heading-no" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
      <span className="cs-heading-title">{topic.title}</span>
      {!isStatic && onHide ? (
        <span className="cs-item-actions cs-noprint">
          <button type="button" data-tone="vermilion" onClick={onHide} aria-label={APPS_COPY.cheatsheet.hideTopic(topic.title)}>
            {APPS_COPY.cheatsheet.hideShort}
          </button>
        </span>
      ) : null}
    </div>
  );
}

interface ItemBlockProps {
  item: CheatsheetItem;
  static?: boolean;
  onHide?: () => void;
  onEdit?: (next: CheatsheetItemEdit) => void;
  onSeek?: (ms: number) => void;
}

function citationLabel(item: CheatsheetItem): string | null {
  const citation = item.citation;
  if (!citation) return null;
  const clock = formatClock(citation.sourceStartMs ?? citation.startMs);
  const title = citation.sourceTitle?.trim();
  if (title && clock && citation.sourceKind !== 'syllabus' && citation.sourceKind !== 'past-paper') return `${title} · ${clock}`;
  return title || clock || null;
}

export function CheatsheetItemBlock({ item, static: isStatic, onHide, onEdit, onSeek }: ItemBlockProps) {
  const kind = itemKindOf(item);
  const compact = isCompactBody(item.body);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CheatsheetItemEdit>({ term: item.term, body: item.body, latex: item.latex });
  const source = citationLabel(item);
  const seekMs = item.citation ? (item.citation.sourceStartMs ?? item.citation.startMs) : undefined;

  const beginEdit = () => {
    setDraft({ term: item.term, body: item.body, latex: item.latex });
    setEditing(true);
  };

  // 术语里也会有数学（"值域 $R_f$"）：含 $ 才走 Markdown，其它保持纯文本
  const termNode = (
    <span className="cs-term">
      <mark className="cs-hl" data-kind={kind}>
        {item.term.includes('$') ? <CheatsheetRichText content={item.term} /> : item.term}
      </mark>
    </span>
  );

  if (editing && !isStatic) {
    return (
      <div className="cs-block cs-item cs-noprint" data-block-id={`item:${item.id}`}>
        <div className="cs-edit">
          <input
            value={draft.term}
            onChange={(event) => setDraft((current) => ({ ...current, term: event.target.value }))}
            aria-label={APPS_COPY.cheatsheet.editTerm}
          />
          <textarea
            value={draft.body}
            rows={3}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
            aria-label={APPS_COPY.cheatsheet.editBody}
          />
          <input
            className="cs-edit-latex"
            value={draft.latex ?? ''}
            placeholder={APPS_COPY.cheatsheet.editFormula}
            onChange={(event) => setDraft((current) => ({ ...current, latex: event.target.value }))}
            aria-label={APPS_COPY.cheatsheet.editFormula}
          />
          <div className="cs-edit-actions">
            <button type="button" onClick={() => setEditing(false)}>{APPS_COPY.cheatsheet.cancelEdit}</button>
            <button
              type="button"
              data-primary
              disabled={!draft.term.trim() || !draft.body.trim()}
              onClick={() => {
                onEdit?.({ term: draft.term.trim(), body: draft.body.trim(), latex: draft.latex?.trim() || undefined });
                setEditing(false);
              }}
            >
              {APPS_COPY.cheatsheet.saveEdit}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cs-block cs-item${item.emphasis === 'strong' ? ' cs-strong' : ''}`}
      data-block-id={`item:${item.id}`}
      data-kind={kind}
      // 触屏没有 hover：点一下条目让它获得焦点，动作靠 :focus-within 出现；-1 不进 Tab 序
      tabIndex={isStatic ? undefined : -1}
    >
      {compact ? (
        <div className="cs-line">
          {termNode}
          <span className="cs-term-sep" aria-hidden>：</span>
          <span className="cs-inline-body"><CheatsheetRichText content={item.body} /></span>
        </div>
      ) : (
        <>
          <div className="cs-line">{termNode}</div>
          <div className="cs-bodyblock"><CheatsheetRichText content={item.body} /></div>
        </>
      )}
      {item.latex ? (
        <div className="cs-formula">
          <CheatsheetRichText content={`$$${item.latex}$$`} />
        </div>
      ) : null}
      {!isStatic ? (
        <span className="cs-item-actions cs-noprint">
          {source ? (
            onSeek && typeof seekMs === 'number' ? (
              <button type="button" onClick={() => onSeek(seekMs)} title={APPS_COPY.cheatsheet.sourceTitle(source)} aria-label={APPS_COPY.cheatsheet.sourceTitle(source)}>↩</button>
            ) : (
              <span title={APPS_COPY.cheatsheet.sourceTitle(source)} aria-label={APPS_COPY.cheatsheet.sourceTitle(source)}>↩</span>
            )
          ) : null}
          {onEdit ? <button type="button" onClick={beginEdit}>{APPS_COPY.cheatsheet.editShort}</button> : null}
          {onHide ? <button type="button" data-tone="vermilion" onClick={onHide}>{APPS_COPY.cheatsheet.hideShort}</button> : null}
        </span>
      ) : null}
    </div>
  );
}
