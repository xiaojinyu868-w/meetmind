/**
 * 口袋（桌面小窗 /companion 与浏览器里的同一页）文案。
 * 口吻同 copy.ts：安静、有根、不播报；不出现内部词。
 */
export const POCKET_COPY = {
  title: '口袋',
  todayCount: (count: number): string => (count === 0 ? '今天还没收东西' : `今天 ${count} 条`),
  hotkeyHint: '⌘⇧M 收下 · ⌘⇧K 口袋',
  hotkeyHintWin: 'Ctrl⇧M 收下 · Ctrl⇧K 口袋',
  collapse: '收起',
  /** 空态 */
  emptyTitle: '选中任何文字，按一下，就在这儿了。',
  emptyBody: '也可以把文字、图片、网址直接拖进来，或在下面写一句。',
  emptyBrowserBody: '在桌面端，任何应用里选中按 ⌘⇧M 就收进来；这里也能直接粘贴、拖放。',
  captureRegion: '截一块屏',
  /** 流 */
  groupCount: (count: number): string => `${count} 条`,
  fromSource: (label: string): string => `来自 ${label}`,
  remove: '撤销',
  removed: '撤销了',
  expand: '展开',
  collapseItem: '收起',
  openSource: '回到原处',
  mathBadge: '含公式',
  /** 记 / 问 */
  modeNote: '记',
  modeAsk: '问',
  placeholderNote: '写一句，或直接粘贴 / 拖进来…',
  placeholderAsk: '问同学——它读过你口袋里的东西',
  send: '发送',
  saved: '收下了',
  saveFailed: '这次没收下，再试一次。',
  askFailed: '这次没答上来，再试一次。',
  thinking: '正在想…',
  pastedRich: '粘贴的内容收进口袋了',
  dropHere: '松手，收下',
  imageUploaded: (count: number): string => `收下了 ${count} 张图`,
  /** 登录 */
  loginHint: '先在主窗口登录，口袋就能用了。',
  loginAction: '去登录',
  loading: '正在拿口袋里的东西…',
  loadFailed: '没读到口袋里的东西，稍后再试。',
  /** 时间 */
  justNow: '刚刚',
  minutesAgo: (minutes: number): string => `${minutes} 分钟前`,
  yesterday: '昨天',
  openFull: '打开完整 MeetMind',
} as const;
