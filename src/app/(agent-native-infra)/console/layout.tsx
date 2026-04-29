import type { Metadata } from 'next';
import { AppShell } from '@/components/academic/app-shell';

export const metadata: Metadata = {
  title: 'Console · MeetMind Education Service OS',
};

const NAV = [
  { href: '/console', label: '主页' },
  { href: '/console/agent-assets', label: '资产', matchPrefix: '/console/agent-assets' },
  { href: '/console/leads', label: '线索', matchPrefix: '/console/leads' },
  { href: '/console/skills', label: '场景', matchPrefix: '/console/skills' },
  { href: '/console/settings', label: '设置', matchPrefix: '/console/settings' },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="console" nav={NAV} maxWidth="wide">
      {children}
    </AppShell>
  );
}
