import type { Metadata } from 'next';
import { PocketPanel } from '@/components/pocket/PocketPanel';
import { COPY } from '@/lib/ui/copy';

export const metadata: Metadata = {
  title: `${COPY.identity.productName} 口袋`,
  description: '选中任何文字，按一下，就在这儿了。',
};

export default function CompanionPage() {
  return <PocketPanel />;
}
