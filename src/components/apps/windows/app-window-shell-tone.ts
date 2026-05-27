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
      root: 'min-h-screen bg-[#11110F] text-white',
      header: 'sticky top-0 z-20 border-b border-white/[0.08] bg-[#151411]/95 backdrop-blur',
      headerInner: 'mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6',
      backLink: 'inline-flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-sm text-white/62 hover:border-white/[0.18] hover:text-white',
      title: 'truncate text-lg font-semibold text-white/92',
      subtitle: 'truncate text-xs text-white/42',
      main: 'mx-auto min-h-[calc(100vh-64px)] max-w-7xl px-0 py-0 sm:px-0',
      actionButton: 'rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[#151411] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60',
    };
  }

  return {
    root: 'min-h-screen bg-canvas',
    header: 'sticky top-0 z-20 border-b border-divider bg-white',
    headerInner: 'mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6',
    backLink: 'inline-flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-1.5 text-sm text-ink-secondary hover:text-ink',
    title: 'truncate text-lg font-semibold text-ink',
    subtitle: 'truncate text-xs text-ink-muted',
    main: 'mx-auto max-w-7xl px-4 py-5 sm:px-6',
    actionButton: 'rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60',
  };
}
