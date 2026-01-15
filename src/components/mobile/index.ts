// 旧组件（保留兼容）
export { BottomPanel, BottomPanelHeader } from './BottomPanel';
export type { BottomPanelProps, BottomPanelHeaderProps, PanelState } from './BottomPanel';

export { 
  MenuDrawer, 
  HamburgerButton, 
  DrawerMenuItem, 
  DrawerDivider 
} from './MenuDrawer';
export type { 
  MenuDrawerProps, 
  HamburgerButtonProps, 
  DrawerMenuItemProps 
} from './MenuDrawer';

export { MobileLayout, MobilePanelTabs } from './MobileLayout';
export type { MobileLayoutProps, MobilePanelTabsProps } from './MobileLayout';

// 播客式组件（旧版深色）
export { PodcastPlayer } from './PodcastPlayer';
export type { PodcastPlayerProps, ConfusionMarker } from './PodcastPlayer';

export { MobileTimeline, segmentsToTimelineEntries } from './MobileTimeline';
export type { MobileTimelineProps, TimelineEntry } from './MobileTimeline';

export { ConfusionCard } from './ConfusionCard';
export type { ConfusionCardProps } from './ConfusionCard';

export { MobileMenu, HamburgerMenuButton } from './MobileMenu';
export type { MobileMenuProps } from './MobileMenu';

// 得到风格组件（新版金色暖调）
export { MiniPlayer } from './MiniPlayer';
export type { MiniPlayerProps, ConfusionMarker as MiniPlayerMarker } from './MiniPlayer';

export { MobileTabSwitch } from './MobileTabSwitch';
export type { MobileTabSwitchProps, TabId } from './MobileTabSwitch';

export { DedaoTimeline, toDedaoEntries } from './DedaoTimeline';
export type { DedaoTimelineProps, DedaoTimelineEntry } from './DedaoTimeline';

export { DedaoConfusionCard } from './DedaoConfusionCard';
export type { DedaoConfusionCardProps } from './DedaoConfusionCard';

export { DedaoMenu, DedaoMenuButton } from './DedaoMenu';
export type { DedaoMenuProps } from './DedaoMenu';
