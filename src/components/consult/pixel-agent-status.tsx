'use client';

export type PixelAgentState =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'drafting'
  | 'voice'
  | 'blocked'
  | 'done';

interface PixelAgentStatusProps {
  state: PixelAgentState;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const COLORS = {
  ink: '#232322',
  muted: '#A3A39E',
  card: '#FFFFFF',
  lilac: '#E9D5FF',
  rose: '#FCE7F3',
  sky: '#DBEAFE',
} as const;

const DEFAULT_LABEL: Record<PixelAgentState, string> = {
  idle: '小墨在线',
  thinking: '小墨在想',
  reading: '翻背景',
  searching: '找来源',
  drafting: '写稿中',
  voice: '接通语音',
  blocked: '等你点一下',
  done: '收好了',
};

const DEFAULT_CAPTION: Record<PixelAgentState, string> = {
  idle: '背景也可以',
  thinking: '正在整理下一步',
  reading: '正在看已有信息',
  searching: '正在核对依据',
  drafting: '正在变成可读稿',
  voice: '正在准备通话',
  blocked: '需要一点方向',
  done: '可以继续推进',
};

const SIZE_CLASS = {
  sm: { icon: 'h-6 w-8', wrapper: 'gap-2', label: 'text-[11px]', caption: 'hidden' },
  md: { icon: 'h-8 w-10', wrapper: 'gap-2.5', label: 'text-[12px]', caption: 'text-[10.5px]' },
  lg: { icon: 'h-10 w-12', wrapper: 'gap-3', label: 'text-[13px]', caption: 'text-[11px]' },
} as const;

const OCTO_ROWS = [
  '..................',
  '......######......',
  '....##llllll##....',
  '...#llllllllll#...',
  '..#llllllllllll#..',
  '..#llllllllllll#..',
  '...#llllllllll#...',
  '....#llllllll#....',
  '...##llllllll##...',
  '..#ll##llll##ll#..',
  '.##l#..llll..#l##.',
  '.#..#..#..#..#..#.',
  '..................',
];

function fillForCell(cell: string): string {
  if (cell === '#') return COLORS.ink;
  if (cell === 'l') return COLORS.lilac;
  return 'transparent';
}

function Eyes({ state }: { state: PixelAgentState }) {
  if (state === 'done') {
    return (
      <>
        <rect x="15" y="13" width="2" height="2" fill={COLORS.ink} />
        <rect x="17" y="15" width="2" height="2" fill={COLORS.ink} />
        <rect x="27" y="13" width="2" height="2" fill={COLORS.ink} />
        <rect x="25" y="15" width="2" height="2" fill={COLORS.ink} />
      </>
    );
  }

  if (state === 'blocked') {
    return (
      <>
        <rect x="14" y="14" width="6" height="2" fill={COLORS.ink} />
        <rect x="24" y="14" width="6" height="2" fill={COLORS.ink} />
      </>
    );
  }

  return (
    <>
      <rect x="13" y="12" width="8" height="8" fill={COLORS.card} />
      <rect x="25" y="12" width="8" height="8" fill={COLORS.card} />
      <rect x={state === 'searching' ? 17 : 16} y="15" width="3" height="4" fill={COLORS.ink} />
      <rect x={state === 'searching' ? 29 : 28} y="15" width="3" height="4" fill={COLORS.ink} />
      <rect x="16" y="14" width="1" height="1" fill={COLORS.card} />
      <rect x="28" y="14" width="1" height="1" fill={COLORS.card} />
    </>
  );
}

function Mouth({ state }: { state: PixelAgentState }) {
  if (state === 'blocked') {
    return <rect x="20" y="22" width="6" height="2" fill={COLORS.ink} />;
  }

  if (state === 'voice') {
    return (
      <>
        <rect x="20" y="21" width="6" height="6" fill={COLORS.ink} />
        <rect x="22" y="25" width="2" height="2" fill={COLORS.rose} />
      </>
    );
  }

  return (
    <>
      <rect x="19" y="21" width="3" height="2" fill={COLORS.ink} />
      <rect x="22" y="23" width="4" height="2" fill={COLORS.ink} />
      <rect x="26" y="21" width="3" height="2" fill={COLORS.ink} />
    </>
  );
}

function StatePixels({ state }: { state: PixelAgentState }) {
  if (state === 'thinking') {
    return (
      <g className="octo-dots">
        <rect x="37" y="10" width="2" height="2" fill={COLORS.muted} />
        <rect x="41" y="10" width="2" height="2" fill={COLORS.muted} />
        <rect x="45" y="10" width="2" height="2" fill={COLORS.muted} />
      </g>
    );
  }

  if (state === 'reading') {
    return (
      <g>
        <rect x="36" y="10" width="10" height="8" fill={COLORS.card} stroke={COLORS.ink} strokeWidth="2" />
        <rect x="39" y="13" width="5" height="1" fill={COLORS.muted} />
        <rect x="39" y="16" width="4" height="1" fill={COLORS.muted} />
      </g>
    );
  }

  if (state === 'searching') {
    return (
      <g>
        <rect x="37" y="10" width="7" height="7" fill="none" stroke={COLORS.ink} strokeWidth="2" />
        <rect x="43" y="17" width="5" height="2" fill={COLORS.ink} />
      </g>
    );
  }

  if (state === 'drafting') {
    return (
      <g>
        <rect x="39" y="9" width="2" height="2" fill={COLORS.ink} />
        <rect x="41" y="11" width="2" height="2" fill={COLORS.ink} />
        <rect x="43" y="13" width="2" height="2" fill={COLORS.ink} />
        <rect x="38" y="18" width="9" height="2" fill={COLORS.ink} />
      </g>
    );
  }

  if (state === 'voice') {
    return (
      <g>
        <rect x="37" y="10" width="8" height="2" fill={COLORS.ink} />
        <rect x="35" y="12" width="2" height="7" fill={COLORS.ink} />
        <rect x="45" y="12" width="2" height="7" fill={COLORS.ink} />
        <rect x="39" y="20" width="5" height="2" fill={COLORS.ink} />
      </g>
    );
  }

  if (state === 'done') {
    return (
      <g>
        <rect x="36" y="14" width="3" height="3" fill={COLORS.ink} />
        <rect x="39" y="17" width="3" height="3" fill={COLORS.ink} />
        <rect x="42" y="11" width="3" height="3" fill={COLORS.ink} />
        <rect x="45" y="8" width="3" height="3" fill={COLORS.ink} />
      </g>
    );
  }

  return null;
}

function PixelOctopus({ state, iconClass }: { state: PixelAgentState; iconClass: string }) {
  const active = state !== 'idle' && state !== 'done' && state !== 'blocked';

  return (
    <svg
      viewBox="0 0 50 32"
      role="img"
      aria-label="小墨章鱼顾问状态"
      shapeRendering="crispEdges"
      className={`octo-agent ${active ? 'octo-active' : ''} ${iconClass}`}
    >
      {OCTO_ROWS.flatMap((row, y) =>
        row.split('').map((cell, x) => {
          const fill = fillForCell(cell);
          if (fill === 'transparent') return null;
          return <rect key={`${x}-${y}`} x={x * 2 + 1} y={y * 2 + 3} width="2" height="2" fill={fill} />;
        }),
      )}

      <rect x="12" y="13" width="4" height="2" fill={COLORS.card} opacity="0.76" />
      <rect x="10" y="20" width="3" height="2" fill={COLORS.rose} opacity="0.82" />
      <rect x="32" y="20" width="3" height="2" fill={COLORS.rose} opacity="0.82" />
      <Eyes state={state} />
      <Mouth state={state} />
      <StatePixels state={state} />

      <style jsx>{`
        .octo-agent {
          display: block;
          flex: 0 0 auto;
          image-rendering: pixelated;
          transform-box: fill-box;
          transform-origin: center;
        }

        .octo-active {
          animation: octo-bob 1.3s steps(2, end) infinite;
        }

        .octo-dots rect {
          animation: octo-blink 1.2s steps(2, end) infinite;
        }

        .octo-dots rect:nth-child(2) {
          animation-delay: 0.16s;
        }

        .octo-dots rect:nth-child(3) {
          animation-delay: 0.32s;
        }

        @keyframes octo-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1px); }
        }

        @keyframes octo-blink {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
      `}</style>
    </svg>
  );
}

export function PixelAgentStatus({
  state,
  label,
  size = 'md',
  className = '',
}: PixelAgentStatusProps) {
  const cfg = SIZE_CLASS[size];

  return (
    <div className={`inline-flex items-center ${cfg.wrapper} ${className}`}>
      <PixelOctopus state={state} iconClass={cfg.icon} />
      <div className="min-w-0 text-left">
        <div className={`font-medium leading-tight text-ink ${cfg.label}`}>
          {label ?? DEFAULT_LABEL[state]}
        </div>
        <div className={`mt-0.5 leading-tight text-ink-muted ${cfg.caption}`}>
          {DEFAULT_CAPTION[state]}
        </div>
      </div>
    </div>
  );
}
