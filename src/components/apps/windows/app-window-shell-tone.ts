import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface AppWindowShellTone {
  root: string;
  header: string;
  headerInner: string;
  backLink: string;
  title: string;
  main: string;
  actionButton: string;
}

/**
 * 独立应用页的色调：所有应用同一张纸。
 *
 * 2026-09-10 起闪卡不再有深色 immersive 变体——那个"低亮度房间"在成品出来前把整页刷成黑底黑字
 * （用户原话"闪卡的进入页面完全是黑色的"），成品出来后也与复习页中栏 / 浮窗 / 手机三个宿主的纸底不一致。
 * 牌本身的纸感与投影已经足够，长时间练习的眩光问题由暗色模式（data-theme=dark）统一解决，不由单个应用另开一套。
 * 参数保留是为了调用方不改；现在对任何 appKey 都返回同一套。
 */
export function getAppWindowShellTone(_appKey?: WorkshopAppKey): AppWindowShellTone {
  return {
    root: 'min-h-screen bg-canvas',
    header: 'sticky top-0 z-20 border-b border-divider bg-white',
    headerInner: 'mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3',
    // 2026-09-09：返回与「再做一版」都退成文字（与复习页宿主 / 导图顶栏同一控件语言），不再是描边胶囊 + 饱和绿按钮
    backLink: 'inline-flex h-10 items-center gap-1 text-[13px] text-ink-muted transition hover:text-ink',
    title: 'truncate text-[15px] font-semibold tracking-[-0.01em] text-ink',
    main: 'mx-auto max-w-7xl px-4 py-5 sm:px-6',
    actionButton: 'inline-flex h-10 items-center gap-1.5 text-[13px] text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60',
  };
}
