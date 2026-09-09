import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface AppWindowShellTone {
  root: string;
  header: string;
  headerInner: string;
  backLink: string;
  title: string;
  subtitle: string;
  main: string;
  actionButton: string;
}

export function getAppWindowShellTone(appKey: WorkshopAppKey): AppWindowShellTone {
  if (appKey === 'flashcards') {
    return {
      root: 'min-h-screen bg-[var(--mm-immersive)] text-white',
      // header 比底色略亮一档：immersive 混入 4% 白（原 v6 的 #151411）
      header: 'sticky top-0 z-20 border-b border-white/[0.08] bg-[color-mix(in_srgb,var(--mm-immersive),white_4%)] backdrop-blur',
      headerInner: 'mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3',
      backLink: 'inline-flex h-10 items-center gap-1 text-[13px] text-white/62 transition hover:text-white',
      title: 'truncate text-lg font-semibold text-white/92',
      subtitle: 'truncate text-xs text-white/42',
      main: 'mx-auto min-h-[calc(100vh-64px)] max-w-7xl px-0 py-0 sm:px-0',
      actionButton: 'inline-flex h-10 items-center gap-1.5 text-[13px] text-white/62 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60',
    };
  }

  return {
    root: 'min-h-screen bg-canvas',
    header: 'sticky top-0 z-20 border-b border-divider bg-white',
    headerInner: 'mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3',
    // 2026-09-09：返回与「再做一版」都退成文字（与复习页宿主 / 导图顶栏同一控件语言），不再是描边胶囊 + 饱和绿按钮
    backLink: 'inline-flex h-10 items-center gap-1 text-[13px] text-ink-muted transition hover:text-ink',
    title: 'truncate text-[15px] font-semibold tracking-[-0.01em] text-ink',
    subtitle: 'truncate text-xs text-ink-muted',
    main: 'mx-auto max-w-7xl px-4 py-5 sm:px-6',
    actionButton: 'inline-flex h-10 items-center gap-1.5 text-[13px] text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60',
  };
}
