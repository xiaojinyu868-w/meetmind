'use client';

/**
 * BoardImage — 讲义插图（v28 teach-agent image 工具；v31 纸面风格）。
 *
 * 老师把打印图贴进讲义：细灰边框 + 小字 caption + 轻微歪斜（手贴感）。
 * 内容流内嵌（跟随板书的自然位置，栏内居中、宽度 72%），与参考产品的
 * 插图内嵌一致；url 为空 = 生成中，渲染虚线框占位。
 */

import type { BoardImageAction } from '@/lib/ai-native/plugins/board-script';
import { PAPER } from './board-lecture';

export function BoardImage({ action }: { action: BoardImageAction }) {
  return (
    <div
      aria-label={action.caption ?? action.prompt ?? '讲义插图'}
      style={{
        width: '72%',
        minWidth: 160,
        margin: '6px auto 10px',
        transform: 'rotate(-0.7deg)',
        border: `1.5px solid ${PAPER.hairline}`,
        borderRadius: 6,
        padding: 5,
        background: '#ffffff',
        boxShadow: '0 2px 8px rgba(80,66,40,0.14)',
      }}
    >
      {action.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 备课态落盘的本地静态图
        <img
          src={action.url}
          alt={action.caption ?? ''}
          style={{ display: 'block', width: '100%', borderRadius: 3 }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '4 / 3',
            border: `1.5px dashed ${PAPER.hairline}`,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: PAPER.inkSoft,
            fontSize: 13,
          }}
        >
          插图生成中…
        </div>
      )}
      {action.caption ? (
        <div
          style={{
            marginTop: 4,
            color: PAPER.inkSoft,
            fontSize: 12,
            lineHeight: 1.3,
            textAlign: 'center',
          }}
        >
          {action.caption}
        </div>
      ) : null}
    </div>
  );
}
