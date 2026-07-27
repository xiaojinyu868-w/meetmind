import type { Metadata } from 'next';
import { CompanionPanel } from '@/components/companion/CompanionPanel';
import { COPY } from '@/lib/ui/copy';

export const metadata: Metadata = {
  title: `${COPY.identity.productName} 小窗`,
  description: COPY.desktopPanel.subtitle,
};

export default function CompanionPage() {
  return <CompanionPanel />;
}
