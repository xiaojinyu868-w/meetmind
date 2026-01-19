/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // === 新配色系统 ===
        // 主色-深蓝
        navy: {
          DEFAULT: '#1E3B4D',
          50: '#E8EEF2',
          100: '#D1DDE5',
          200: '#A3BBCC',
          300: '#7599B2',
          400: '#476799',
          500: '#1E3B4D',
          600: '#18303E',
          700: '#12242F',
          800: '#0C181F',
          900: '#060C10',
        },
        // 主色-紫色（薰衣草紫）
        lavender: {
          DEFAULT: '#6C5CE7',
          50: '#F0EEFE',
          100: '#E1DDFC',
          200: '#C3BBF9',
          300: '#A599F7',
          400: '#8778F2',
          500: '#6C5CE7',
          600: '#4A3ADB',
          700: '#3829B8',
          800: '#291E87',
          900: '#1A1356',
        },
        // 强调色-明黄（向日葵黄）
        sunflower: {
          DEFAULT: '#FFD93D',
          50: '#FFFBEB',
          100: '#FEF7D6',
          200: '#FEEFAD',
          300: '#FDE785',
          400: '#FCDF5C',
          500: '#FFD93D',
          600: '#F5C800',
          700: '#C29E00',
          800: '#8F7500',
          900: '#5C4B00',
        },
        // 强调色-橙黄（暖橙色）
        warmOrange: {
          DEFAULT: '#FFAB5E',
          50: '#FFF7ED',
          100: '#FFEFD9',
          200: '#FFDFB3',
          300: '#FFCF8E',
          400: '#FFBF68',
          500: '#FFAB5E',
          600: '#FF8A2E',
          700: '#F96800',
          800: '#C95300',
          900: '#993F00',
        },
        // 辅助色-浅蓝（天空蓝）
        skyblue: {
          DEFAULT: '#74C0FC',
          50: '#EBF6FF',
          100: '#D7EDFF',
          200: '#AFDBFF',
          300: '#87C9FD',
          400: '#74C0FC',
          500: '#4BABF7',
          600: '#1A90F1',
          700: '#0A72C5',
          800: '#075594',
          900: '#053863',
        },
        // 辅助色-薄荷绿
        mint: {
          DEFAULT: '#A8E6CF',
          50: '#F0FDF7',
          100: '#DCFCE8',
          200: '#BBF7D3',
          300: '#A8E6CF',
          400: '#86EFAC',
          500: '#4ADE80',
          600: '#22C55E',
          700: '#16A34A',
          800: '#15803D',
          900: '#166534',
        },
        // 辅助色-珊瑚粉
        coral: {
          DEFAULT: '#FF8A80',
          50: '#FFF5F4',
          100: '#FFE9E7',
          200: '#FFD4D0',
          300: '#FFBFB8',
          400: '#FFA9A1',
          500: '#FF8A80',
          600: '#FF574A',
          700: '#FF2416',
          800: '#D60F02',
          900: '#A00B02',
        },
        // 辅助色-浅紫（淡紫色）
        lilac: {
          DEFAULT: '#DCD6F7',
          50: '#FAF9FE',
          100: '#F5F3FD',
          200: '#EBE7FB',
          300: '#DCD6F7',
          400: '#C4BAF2',
          500: '#AC9EED',
          600: '#8A77E3',
          700: '#6850D9',
          800: '#4E33BF',
          900: '#3E2899',
        },
        // 辅助色-米色（奶油米）
        cream: {
          DEFAULT: '#FFF5E6',
          50: '#FFFCF7',
          100: '#FFF9F0',
          200: '#FFF5E6',
          300: '#FFECD1',
          400: '#FFE3BD',
          500: '#FFDAA8',
          600: '#FFC878',
          700: '#FFB648',
          800: '#FFA418',
          900: '#E78D00',
        },
        // 背景色系
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FFF9F5',     // 奶油白（教育风格主背景）
          warm: '#FFFBF0',     // 奶油黄
          mint: '#F0FFF4',     // 薄荷白
        },
        // 教育风格专用色
        edu: {
          bg: '#FFF9F5',        // 主背景-暖奶油
          card: '#FFFFFF',      // 卡片背景
          soft: '#FFF5E6',      // 柔和背景
          accent: '#F0EEFE',    // 强调背景
          border: '#F5E6D3',    // 边框色
        },
        // 文字色系
        text: {
          primary: '#1E3B4D',    // 深蓝黑
          secondary: '#6B7280',  // 灰色
          muted: '#9CA3AF',      // 浅灰
          inverse: '#FFFFFF',    // 纯白
        },
        // 兼容旧版：保留 primary 和 accent
        primary: {
          50: '#F0EEFE',
          100: '#E1DDFC',
          200: '#C3BBF9',
          300: '#A599F7',
          400: '#8778F2',
          500: '#6C5CE7',
          600: '#4A3ADB',
          700: '#3829B8',
          800: '#291E87',
          900: '#1A1356',
        },
        accent: {
          50: '#FFFBEB',
          100: '#FEF7D6',
          200: '#FEEFAD',
          300: '#FDE785',
          400: '#FCDF5C',
          500: '#FFD93D',
          600: '#F5C800',
          700: '#C29E00',
          800: '#8F7500',
          900: '#5C4B00',
        },
        // 成功色：薄荷绿
        success: {
          50: '#F0FDF7',
          100: '#DCFCE8',
          200: '#BBF7D3',
          300: '#A8E6CF',
          400: '#86EFAC',
          500: '#4ADE80',
          600: '#22C55E',
          700: '#16A34A',
          800: '#15803D',
          900: '#166534',
        },
        // 警告色：向日葵黄
        warning: {
          50: '#FFFBEB',
          100: '#FEF7D6',
          200: '#FEEFAD',
          300: '#FDE785',
          400: '#FCDF5C',
          500: '#FFD93D',
          600: '#F5C800',
          700: '#C29E00',
          800: '#8F7500',
          900: '#5C4B00',
        },
        // 危险色：珊瑚粉
        danger: {
          50: '#FFF5F4',
          100: '#FFE9E7',
          200: '#FFD4D0',
          300: '#FFBFB8',
          400: '#FFA9A1',
          500: '#FF8A80',
          600: '#FF574A',
          700: '#FF2416',
          800: '#D60F02',
          900: '#A00B02',
        },
      },
      fontFamily: {
        sans: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 20px rgb(108 92 231 / 0.3)',
        'glow-lg': '0 0 40px rgb(108 92 231 / 0.4)',
        'glow-yellow': '0 0 20px rgb(255 217 61 / 0.4)',
        'inner-light': 'inset 0 2px 4px rgb(255 255 255 / 0.2)',
        'card': '0 4px 6px -1px rgb(30 59 77 / 0.07), 0 2px 4px -2px rgb(30 59 77 / 0.05)',
        'card-hover': '0 10px 15px -3px rgb(30 59 77 / 0.1), 0 4px 6px -4px rgb(30 59 77 / 0.05)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #6C5CE7 0%, #A855F7 100%)',
        'gradient-yellow': 'linear-gradient(180deg, #FFD93D 0%, #FFAB5E 100%)',
        'gradient-soft': 'linear-gradient(180deg, #FFFFFF 0%, #FFFBF0 100%)',
        'gradient-blue': 'linear-gradient(135deg, #74C0FC 0%, #A5D8FF 100%)',
        'gradient-hero': 'linear-gradient(135deg, #F0FFF4 0%, #FFFBF0 50%, #F0EEFE 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-gentle': 'bounce-gentle 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'bounce-gentle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
