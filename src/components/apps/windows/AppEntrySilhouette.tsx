'use client';

/**
 * AppEntrySilhouette — 应用进入态的主角：产物的形状（2026-09-10）。
 *
 * 为什么：应用点开后、成品出来前的那一屏，此前是一只章鱼 + 一句拼接的说明 + 秒数计数器，
 * 八个应用长得一样，用户看字才知道自己点开了什么。产品的原则是"让用户不看文字就能知道这里是什么意思"——
 * 所以进入态由**产物自己的形状**说话：一叠牌是闪卡、一张有题号的纸是测验、几个节点是导图、
 * 一条波形是播客、一块留白的板是板书、一张海报比例的框是信息图、一张三栏密线的纸是速查表。
 * 成品落下来时形状变成真东西，位置不跳。
 *
 * 画法：线稿——1.5px 墨色 28% 描边 + 纸白填充，纸感靠一层极淡的投影；内部的"内容线"在 live 时轮流呼吸
 * （像正在被写上），一处签名色 accent 慢慢明灭——这就是"正在做"的状态点，替代了秒数计数器。
 * static（空态 / 失败态）时不动；失败态 accent 换朱砂。prefers-reduced-motion 下全部静止（globals.css）。
 */

import type { ReactElement, SVGProps } from 'react';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export type SilhouetteTone = 'pine' | 'vermilion';

interface AppEntrySilhouetteProps {
  appKey?: WorkshopAppKey | string;
  /** 内容线呼吸 + accent 明灭（等待态） */
  live?: boolean;
  /** accent 的签名色：正在做 = pine；没做好 = vermilion */
  tone?: SilhouetteTone;
  className?: string;
}

const INK = 'var(--mm-ink)';
const CARD = 'var(--mm-card)';

/** 纸类形状共用：白纸 + 细描边 */
function paperProps(): SVGProps<SVGRectElement> {
  return { fill: CARD, stroke: INK, strokeOpacity: 0.28, strokeWidth: 1.5 };
}

function Flashcards({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      {/* 后面两张探头的牌：一张左倾一张右倾，前面一张正 */}
      <g transform="rotate(-9 100 80)"><rect x="46" y="36" width="108" height="86" rx="10" {...paperProps()} strokeOpacity={0.18} /></g>
      <g transform="rotate(5 100 80)"><rect x="46" y="36" width="108" height="86" rx="10" {...paperProps()} strokeOpacity={0.22} /></g>
      <rect x="46" y="40" width="108" height="86" rx="10" {...paperProps()} />
      <circle cx="60" cy="54" r="2.2" className="mm-entry-accent" fill="var(--mm-entry-accent)" />
      <g stroke={INK} strokeOpacity={0.2} strokeWidth="2" strokeLinecap="round">
        <line x1="68" y1="80" x2="132" y2="80" className={line} />
        <line x1="78" y1="92" x2="122" y2="92" className={line} />
      </g>
    </>
  );
}

function Quiz({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      <rect x="40" y="18" width="120" height="116" rx="8" {...paperProps()} />
      <line x1="56" y1="38" x2="118" y2="38" stroke={INK} strokeOpacity={0.35} strokeWidth="2.4" strokeLinecap="round" />
      <g stroke={INK} strokeOpacity={0.22} strokeWidth="1.5">
        {[62, 84, 106].map((y, index) => (
          <g key={y}>
            <circle cx="58" cy={y} r="4.2" fill={index === 1 ? 'var(--mm-entry-accent)' : 'none'} stroke={index === 1 ? 'var(--mm-entry-accent)' : INK} className={index === 1 ? 'mm-entry-accent' : undefined} />
            <line x1="70" y1={y} x2={index === 0 ? 140 : index === 1 ? 128 : 136} y2={y} strokeWidth="2" strokeLinecap="round" className={line} style={{ animationDelay: `${index * 0.35}s` }} />
          </g>
        ))}
      </g>
    </>
  );
}

function Mindmap({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  const pills: Array<[number, number]> = [[22, 46], [22, 104], [144, 46], [144, 104]];
  return (
    <>
      <g fill="none" stroke={INK} strokeOpacity={0.24} strokeWidth="1.5">
        <path d="M100 75 C 74 75, 74 46, 56 46" className={line} />
        <path d="M100 75 C 74 75, 74 104, 56 104" className={line} />
        <path d="M100 75 C 126 75, 126 46, 144 46" className={line} />
        <path d="M100 75 C 126 75, 126 104, 144 104" className={line} />
      </g>
      {pills.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y - 7} width="34" height="14" rx="7" {...paperProps()} />
      ))}
      <circle cx="100" cy="75" r="8" fill="var(--mm-entry-accent)" className="mm-entry-accent" />
    </>
  );
}

const WAVE = [8, 14, 22, 30, 18, 38, 26, 46, 22, 56, 26, 42, 18, 32, 24, 14, 22, 12, 8];

function Podcast({ live }: { live: boolean }) {
  return (
    <g strokeWidth="4" strokeLinecap="round">
      {WAVE.map((height, index) => {
        const x = 10 + index * 10;
        const accent = index === 9;
        return (
          <line
            key={x}
            x1={x}
            y1={75 - height / 2}
            x2={x}
            y2={75 + height / 2}
            stroke={accent ? 'var(--mm-entry-accent)' : INK}
            strokeOpacity={accent ? 1 : 0.24}
            className={accent ? 'mm-entry-accent' : live ? 'mm-entry-line' : undefined}
          />
        );
      })}
    </g>
  );
}

function Explainer({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      <rect x="16" y="28" width="168" height="94" rx="6" {...paperProps()} strokeOpacity={0.36} strokeWidth={2} />
      <line x1="34" y1="52" x2="98" y2="52" stroke="var(--mm-entry-accent)" strokeWidth="2.6" strokeLinecap="round" className="mm-entry-accent" />
      <g stroke={INK} strokeOpacity={0.2} strokeWidth="2" strokeLinecap="round">
        <line x1="34" y1="70" x2="142" y2="70" className={line} />
        <line x1="34" y1="86" x2="118" y2="86" className={line} />
      </g>
    </>
  );
}

function Infographic({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      <rect x="55" y="14" width="90" height="122" rx="6" {...paperProps()} />
      <rect x="67" y="28" width="66" height="9" rx="2.5" fill="var(--mm-entry-accent)" className="mm-entry-accent" />
      <g fill={INK} fillOpacity={0.08}>
        <rect x="67" y="48" width="30" height="26" rx="3" className={line} />
        <rect x="103" y="48" width="30" height="26" rx="3" className={line} />
      </g>
      <g stroke={INK} strokeOpacity={0.2} strokeWidth="2" strokeLinecap="round">
        <line x1="67" y1="92" x2="133" y2="92" className={line} />
        <line x1="67" y1="104" x2="121" y2="104" className={line} />
        <line x1="67" y1="116" x2="127" y2="116" className={line} />
      </g>
    </>
  );
}

function Cheatsheet({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  const columns = [64, 94, 124];
  const rows = [40, 50, 60, 70, 80, 90, 100, 110, 120];
  return (
    <>
      <rect x="54" y="12" width="92" height="126" rx="4" {...paperProps()} />
      <line x1="64" y1="26" x2="108" y2="26" stroke={INK} strokeOpacity={0.38} strokeWidth="2.4" strokeLinecap="round" />
      {/* 荧光笔划过一行：速查表的签名 */}
      <rect x="62" y="56" width="26" height="7" rx="1.5" fill="var(--mm-entry-accent)" fillOpacity={0.35} className="mm-entry-accent" />
      <g stroke={INK} strokeOpacity={0.18} strokeWidth="1.6" strokeLinecap="round">
        {columns.map((x, column) => rows.map((y, index) => (
          <line key={`${x}-${y}`} x1={x} y1={y} x2={x + (index % 3 === 2 ? 14 : 22)} y2={y} className={line} style={{ animationDelay: `${column * 0.5 + index * 0.08}s` }} />
        )))}
      </g>
    </>
  );
}

function TeachBack({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      {/* 你说的话：一个气泡；听你讲的人：三个圆 */}
      <path d="M32 40 h84 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 h-56 l-16 12 v-12 h-12 a12 12 0 0 1 -12 -12 v-26 a12 12 0 0 1 12 -12 z" {...paperProps()} />
      <g stroke={INK} strokeOpacity={0.2} strokeWidth="2" strokeLinecap="round">
        <line x1="46" y1="58" x2="112" y2="58" className={line} />
        <line x1="46" y1="72" x2="94" y2="72" className={line} />
      </g>
      {[122, 146, 170].map((cx, index) => (
        <circle key={cx} cx={cx} cy="112" r="10" fill={index === 1 ? 'var(--mm-entry-accent)' : CARD} stroke={index === 1 ? 'var(--mm-entry-accent)' : INK} strokeOpacity={index === 1 ? 1 : 0.28} strokeWidth="1.5" className={index === 1 ? 'mm-entry-accent' : undefined} />
      ))}
    </>
  );
}

function Generic({ live }: { live: boolean }) {
  const line = live ? 'mm-entry-line' : undefined;
  return (
    <>
      <rect x="50" y="18" width="100" height="116" rx="8" {...paperProps()} />
      <g stroke={INK} strokeOpacity={0.22} strokeWidth="2" strokeLinecap="round">
        <line x1="66" y1="48" x2="134" y2="48" className={line} />
        <line x1="66" y1="66" x2="120" y2="66" className={line} />
        <line x1="66" y1="84" x2="128" y2="84" className={line} />
      </g>
      <circle cx="66" cy="108" r="3" fill="var(--mm-entry-accent)" className="mm-entry-accent" />
    </>
  );
}

const SHAPES: Record<string, (props: { live: boolean }) => ReactElement> = {
  flashcards: Flashcards,
  quiz: Quiz,
  mindmap: Mindmap,
  'audio-overview': Podcast,
  explainer: Explainer,
  infographic: Infographic,
  cheatsheet: Cheatsheet,
  'teach-back': TeachBack,
};

export function AppEntrySilhouette({ appKey, live = false, tone = 'pine', className }: AppEntrySilhouetteProps) {
  const Shape = (appKey && SHAPES[appKey]) || Generic;
  const accent = tone === 'vermilion' ? 'var(--mm-vermilion)' : 'var(--mm-pine)';
  return (
    <svg
      viewBox="0 0 200 150"
      className={['mm-entry-silhouette block', className].filter(Boolean).join(' ')}
      style={{ ['--mm-entry-accent' as string]: accent }}
      aria-hidden
      data-entry-shape={appKey && SHAPES[appKey] ? appKey : 'generic'}
      data-live={live || undefined}
    >
      <Shape live={live} />
    </svg>
  );
}

export default AppEntrySilhouette;
