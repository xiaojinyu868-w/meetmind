/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ===========================================================
           MeetMind v7.1 — 晨雾学习台 + 朱批红笔
           "色 = 架构"：墨松绿是 AI 沉淀（场景上下文），
           朱批红是学生此刻（个人上下文 / 引用 / 标注）。
           策略：保留所有 v6 key（不破坏 200+ 文件），同时引入 v7 一等公民
           =========================================================== */

        /* ===== v7 一等公民 ===== */
        paper: '#F6F8F6',          // 主底色 · 晨雾白
        'paper-warm': '#EDF2EE',   // hover / 次表面
        'paper-deep': '#E4EAE6',   // pressed
        pine: {
          DEFAULT: '#2F6B55',
          deep: '#214B3C',
          light: '#6D9C89',
          mist: '#DFEEE6',
          fog: '#F0F7F3',
          50: '#F0F7F3',
          100: '#DFEEE6',
          200: '#BDD8CA',
          300: '#91B7A5',
          400: '#6D9C89',
          500: '#2F6B55',
          600: '#214B3C',
          700: '#18382D',
          800: '#10271F',
          900: '#08140F',
        },
        vermilion: {
          DEFAULT: '#C45E4C',
          deep: '#984536',
          light: '#D98271',
          mist: '#F8E7E2',
          fog: '#FCF3F0',
          50: '#FCF3F0',
          100: '#F8E7E2',
          200: '#F0CEC5',
          300: '#E4AA9B',
          400: '#D98271',
          500: '#C45E4C',
          600: '#984536',
          700: '#733229',
          800: '#4F221C',
          900: '#30130F',
        },

        /* ===== v6 兼容（已映射到 v7 色板） ===== */
        canvas: '#F6F8F6',         // ← v7.1 晨雾白
        card: '#FFFFFF',
        hover: '#EDF2EE',

        ink: {
          DEFAULT: '#20312A',      // ← 深松墨，不用纯黑
          secondary: '#53645C',
          muted: '#819087',
          inverse: '#FFFFFF',
        },
        divider: {
          DEFAULT: '#DCE5DF',
          light: '#EAF0EC',
        },

        /* 内容标签色（弱化） */
        sand: {
          DEFAULT: '#FDF3C0',
          light: '#FEFAEB',
          dark: '#F5E48A',
        },
        mint: {
          DEFAULT: '#D1F4E0',
          50: '#F0FBF4',
          100: '#E0F5EA',
          200: '#B8E4CC',
          300: '#8DD4AE',
          400: '#5DAE8B',
          500: '#4DAE6F',
          600: '#489874',
          700: '#3D8A60',
          800: '#2E6948',
          900: '#1F4830',
          light: '#EDFDF4',
          dark: '#A2E7BF',
        },
        dustyblue: {
          DEFAULT: '#D3E4F4',
          light: '#EDF5FD',
          dark: '#A8C8E8',
        },
        rose: {
          DEFAULT: '#FADEC9',
          light: '#FDF2E9',
          dark: '#F2C49D',
        },
        highlight: '#F4E8BE',

        /* v6 仪式色板（保留向下兼容，但 v7 用 ceremony-pine/vermilion 替代） */
        ceremony: {
          rose: '#FCE7F3',
          lilac: '#E9D5FF',
          sky: '#DBEAFE',
          /* v7 新增 */
          pine: '#E6EDE8',
          vermilion: '#F6E6E2',
        },

        /* 兼容旧主色（全部映射到 v7 ink/pine） */
        navy: {
          DEFAULT: '#1C1B19',
          50: '#F0EBDF',
          100: '#E8E2D5',
          200: '#C2BBAE',
          300: '#8E8B82',
          400: '#5C5A55',
          500: '#1C1B19',
          600: '#141311',
          700: '#0D0C0B',
          800: '#070605',
          900: '#020201',
        },
        lavender: {
          DEFAULT: '#1C1B19',
          50: '#F0EBDF',
          100: '#E8E2D5',
          200: '#C2BBAE',
          300: '#8E8B82',
          400: '#5C5A55',
          500: '#1C1B19',
          600: '#141311',
          700: '#0D0C0B',
          800: '#070605',
          900: '#020201',
        },
        skyblue: {
          /* 改为映射到 pine 体系，保持冷色调一致性 */
          DEFAULT: '#6B9080',
          50: '#F2F6F3',
          100: '#E6EDE8',
          200: '#C2D4CA',
          300: '#93B5A4',
          400: '#6B9080',
          500: '#2D4F3E',
          600: '#1A3327',
          700: '#0E2117',
          800: '#0A1810',
          900: '#050C08',
        },
        sunflower: {
          DEFAULT: '#D9A441',
          50: '#FFF8E1',
          100: '#FDF2DC',
          200: '#F5DCA8',
          300: '#EEC574',
          400: '#D9A441',
          500: '#B8922E',
          600: '#9A7A26',
          700: '#7E6520',
          800: '#634F18',
          900: '#4A3B12',
        },
        warmOrange: {
          DEFAULT: '#D9A441',
          50: '#FFF8E1',
          100: '#FDF2DC',
          200: '#F5DCA8',
          300: '#EEC574',
          400: '#D9A441',
          500: '#B8922E',
          600: '#9A7A26',
          700: '#7E6520',
          800: '#634F18',
          900: '#4A3B12',
        },
        coral: {
          /* 映射到 vermilion 体系 */
          DEFAULT: '#D17969',
          50: '#FBF2EF',
          100: '#F6E6E2',
          200: '#EFCBC1',
          300: '#E2A799',
          400: '#D17969',
          500: '#B5483C',
          600: '#8E3328',
          700: '#6B2A21',
          800: '#4A1D17',
          900: '#2D110D',
        },
        lilac: {
          DEFAULT: '#E8E2D5',
          50: '#FAF7F2',
          100: '#F2EDE3',
          200: '#E8E2D5',
          300: '#C2BBAE',
          400: '#8E8B82',
          500: '#5C5A55',
          600: '#3F3D38',
          700: '#2A2925',
          800: '#1C1B19',
          900: '#0D0C0B',
        },
        cream: {
          DEFAULT: '#FAF7F2',
          50: '#FDFBF8',
          100: '#FAF7F2',
          200: '#F2EDE3',
          300: '#E8E2D5',
          400: '#C2BBAE',
          500: '#8E8B82',
          600: '#5C5A55',
          700: '#3F3D38',
          800: '#2A2925',
          900: '#1C1B19',
        },
        surface: {
          DEFAULT: '#FAF7F2',
          soft: '#F2EDE3',
          warm: '#FAF7F2',
          mint: '#F2F6F3',     // ← v7 pine-fog
        },
        edu: {
          bg: '#FAF7F2',
          card: '#FFFFFF',
          soft: '#F2EDE3',
          accent: '#F2EDE3',
          border: '#E8E2D5',
        },
        text: {
          primary: '#1C1B19',
          secondary: '#5C5A55',
          muted: '#8E8B82',
          inverse: '#FFFFFF',
        },
        primary: {
          50: '#F0EBDF',
          100: '#E8E2D5',
          200: '#C2BBAE',
          300: '#8E8B82',
          400: '#5C5A55',
          500: '#1C1B19',
          600: '#141311',
          700: '#0D0C0B',
          800: '#070605',
          900: '#020201',
        },
        accent: {
          /* v7：accent = pine（学习智能信号色） */
          50: '#F2F6F3',
          100: '#E6EDE8',
          200: '#C2D4CA',
          300: '#93B5A4',
          400: '#6B9080',
          500: '#2D4F3E',
          600: '#1A3327',
          700: '#0E2117',
          800: '#0A1810',
          900: '#050C08',
        },
        success: {
          50: '#F2F6F3',
          100: '#E6EDE8',
          200: '#C2D4CA',
          300: '#93B5A4',
          400: '#6B9080',
          500: '#2D6A4F',
          600: '#22573F',
          700: '#194530',
          800: '#103423',
          900: '#082417',
        },
        warning: {
          50: '#FBF1DC',
          100: '#FBF1DC',
          200: '#F5DCA8',
          300: '#EEC574',
          400: '#D9A441',
          500: '#B8842B',
          600: '#9A7A26',
          700: '#7E6520',
          800: '#634F18',
          900: '#4A3B12',
        },
        danger: {
          /* v7: danger = vermilion (语义同源 — 朱批本就是"提醒") */
          50: '#FBF2EF',
          100: '#F6E6E2',
          200: '#EFCBC1',
          300: '#E2A799',
          400: '#D17969',
          500: '#B5483C',
          600: '#8E3328',
          700: '#6B2A21',
          800: '#4A1D17',
          900: '#2D110D',
        },
      },

      fontFamily: {
        /* v7 字体栈：Inter + PingFang fallback + 紧排 */
        sans: [
          'Inter', 'var(--font-inter)',
          '-apple-system', 'BlinkMacSystemFont',
          'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei', 'sans-serif'
        ],
        serif: [
          'Instrument Serif', 'var(--font-instrument-serif)',
          'Songti SC', 'Noto Serif SC', 'serif'
        ],
        mono: [
          'JetBrains Mono', 'var(--font-jetbrains-mono)',
          'ui-monospace', 'SF Mono',
          'Menlo', 'Monaco', 'monospace'
        ],
        /* v7 别名 */
        display: ['Inter', 'var(--font-inter)', 'sans-serif'],
      },

      fontSize: {
        /* v7 字号阶梯（Major Third 1.25） */
        '2xs': ['10.5px', { lineHeight: '1.5' }],
        xs:    ['11.5px', { lineHeight: '1.5' }],
        sm:    ['12.5px', { lineHeight: '1.6' }],
        base:  ['14px',   { lineHeight: '1.65' }],
        md:    ['15px',   { lineHeight: '1.7' }],
        lg:    ['17px',   { lineHeight: '1.7' }],
        xl:    ['20px',   { lineHeight: '1.5' }],
        '2xl': ['24px',   { lineHeight: '1.3' }],
        '3xl': ['30px',   { lineHeight: '1.25' }],
        '4xl': ['38px',   { lineHeight: '1.18' }],
        '5xl': ['48px',   { lineHeight: '1.1' }],
        '6xl': ['64px',   { lineHeight: '1.05' }],
        '7xl': ['76px',   { lineHeight: '1.0' }],
      },

      letterSpacing: {
        tightest: '-0.034em',
        display:  '-0.024em',
        h:        '-0.018em',
        body:     '-0.011em',
        normal:   '0',
        caps:     '0.06em',
        widest:   '0.12em',
      },

      boxShadow: {
        /* v7：投影必须存在但极克制 */
        soft:  '0 1px 2px rgba(28,27,25,0.04), 0 4px 16px rgba(28,27,25,0.04)',
        card:  '0 1px 2px rgba(28,27,25,0.05), 0 8px 28px rgba(28,27,25,0.06)',
        float: '0 2px 6px rgba(28,27,25,0.06), 0 16px 48px rgba(28,27,25,0.08)',
        modal: '0 8px 16px rgba(28,27,25,0.08), 0 32px 80px rgba(28,27,25,0.12)',
        /* AI 在场专属（"它活着"信号） */
        'ai-glow': '0 0 0 1px rgba(45,79,62,0.10), 0 8px 28px rgba(45,79,62,0.08)',

        /* v6 兼容（保留 key，绑定 v7 投影） */
        'glow':       '0 1px 2px rgba(28,27,25,0.04), 0 4px 16px rgba(28,27,25,0.04)',
        'glow-lg':    '0 2px 6px rgba(28,27,25,0.06), 0 16px 48px rgba(28,27,25,0.08)',
        'glow-mint':  '0 0 0 1px rgba(45,79,62,0.10), 0 8px 28px rgba(45,79,62,0.08)',
        'glow-ai':    '0 0 0 1px rgba(45,79,62,0.10), 0 8px 28px rgba(45,79,62,0.08)',
        'inner-light': 'inset 0 1px 0 rgba(255,255,255,0.6)',
        'card-hover': '0 2px 6px rgba(28,27,25,0.06), 0 16px 48px rgba(28,27,25,0.08)',
      },

      backgroundImage: {
        /* v6 兼容 key — v7 仍以平涂为主，但保留这些以便 share landing 等"破例放飞"页 */
        'gradient-primary': 'linear-gradient(135deg, var(--mm-pine), var(--mm-pine-deep))',
        'gradient-mint':    'linear-gradient(135deg, var(--mm-pine-fog), var(--mm-pine-mist))',
        'gradient-soft':    'linear-gradient(135deg, var(--mm-paper), var(--mm-paper-warm))',
        'gradient-blue':    'linear-gradient(135deg, var(--mm-pine-fog), var(--mm-pine-mist))',
        'gradient-hero':
          'radial-gradient(ellipse 60% 50% at 30% 30%, rgba(45,79,62,0.12), transparent 60%), radial-gradient(ellipse 60% 50% at 70% 70%, rgba(181,72,60,0.08), transparent 60%)',
        'shimmer-ai':
          'linear-gradient(110deg, rgba(45,79,62,0) 0%, rgba(45,79,62,0.06) 45%, rgba(181,72,60,0.08) 55%, rgba(45,79,62,0) 100%)',
      },

      animation: {
        'pulse-slow':    'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-gentle': 'bounce-gentle 2s ease-in-out infinite',
        'fade-in':       'fade-in 0.3s ease-out',
        'slide-up':      'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in':      'scale-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ripple':        'ripple 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        /* v7 新增 */
        'ai-breath':     'ai-breath 6s ease-in-out infinite',
        'octo-breath':   'octo-breath 3.6s ease-in-out infinite',
        'octo-listen':   'octo-listen 0.6s ease-in-out infinite alternate',
        'octo-think':    'octo-think 2.4s ease-in-out infinite',
        'shimmer-fast':  'shimmer-fast 1.6s linear infinite',
        'caret-blink':   'caret-blink 1s steps(2) infinite',
        'rec-pulse':     'rec-pulse 1.6s ease-in-out infinite',
        'char-in':       'char-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'hero-float':    'hero-float 6s ease-in-out infinite',
      },

      keyframes: {
        'bounce-gentle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-5px)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        'ripple': {
          from: { transform: 'scale(0)', opacity: '1' },
          to:   { transform: 'scale(1)', opacity: '0' },
        },
        mindGrow: {
          '0%':   { opacity: '0', transform: 'scale(0.86)' },
          '60%':  { opacity: '1', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        mindPulse: {
          '0%':   { opacity: '0.9', transform: 'scale(0.96)' },
          '70%':  { opacity: '0.35', transform: 'scale(1.05)' },
          '100%': { opacity: '0', transform: 'scale(1.08)' },
        },
        mindBreath: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%':      { opacity: '1', transform: 'scale(1.08)' },
        },
        /* v7 keyframes */
        'ai-breath': {
          '0%, 100%': { 'background-position': '200% 0' },
          '50%':      { 'background-position': '-100% 0' },
        },
        'octo-breath': {
          '0%, 100%': { transform: 'scale(0.92)', opacity: '0.5' },
          '50%':      { transform: 'scale(1.08)', opacity: '0.9' },
        },
        'octo-listen': {
          from: { transform: 'rotate(-2deg) scale(1)' },
          to:   { transform: 'rotate(2deg) scale(1.04)' },
        },
        'octo-think': {
          '0%, 100%': { transform: 'rotate(0)' },
          '25%':      { transform: 'rotate(-3deg)' },
          '75%':      { transform: 'rotate(3deg)' },
        },
        'shimmer-fast': {
          '0%':   { 'background-position': '200% 0' },
          '100%': { 'background-position': '-100% 0' },
        },
        'caret-blink': {
          '50%': { opacity: '0' },
        },
        'rec-pulse': {
          '0%, 100%': { 'box-shadow': '0 0 0 0 rgba(181,72,60,0.55)' },
          '50%':      { 'box-shadow': '0 0 0 8px rgba(181,72,60,0)' },
        },
        'char-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'hero-float': {
          '0%, 100%': { transform: 'translateY(0) rotate(-1deg)' },
          '50%':      { transform: 'translateY(-12px) rotate(1deg)' },
        },
      },

      borderRadius: {
        '2xs': '2px',
        'xs':  '4px',
        sm:    '6px',
        DEFAULT: '8px',
        md:    '10px',
        lg:    '12px',
        xl:    '14px',
        '2xl': '18px',
        '3xl': '24px',
      },

      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring':   'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'in-out':   'cubic-bezier(0.65, 0, 0.35, 1)',
      },

      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '320': '320ms',
        '600': '600ms',
      },
    },
  },
  plugins: [],
};
