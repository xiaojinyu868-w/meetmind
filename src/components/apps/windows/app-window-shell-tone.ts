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
      backLink: 'inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.04] px-2.5 text-sm text-white/62 hover:border-white/[0.18] hover:text-white sm:px-3',
      title: 'truncate text-lg font-semibold text-white/92',
      subtitle: 'truncate text-xs text-white/42',
      main: 'mx-auto min-h-[calc(100vh-64px)] max-w-7xl px-0 py-0 sm:px-0',
      actionButton: 'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full bg-white px-2.5 text-sm font-medium text-ink hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3',
    };
  }

  return {
    root: 'min-h-screen bg-canvas',
    header: 'sticky top-0 z-20 border-b border-divider bg-white',
    headerInner: 'mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3',
    backLink: 'inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full border border-divider bg-white px-2.5 text-sm text-ink-secondary hover:border-pine hover:text-pine sm:px-3',
    title: 'truncate text-lg font-semibold text-ink',
    subtitle: 'truncate text-xs text-ink-muted',
    main: 'mx-auto max-w-7xl px-4 py-5 sm:px-6',
    actionButton: 'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full bg-pine px-2.5 text-sm font-medium text-white hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3',
  };
}
