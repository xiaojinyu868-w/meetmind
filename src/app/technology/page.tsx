import type { Metadata } from 'next';
import { TechnologyPage } from '@/components/TechnologyPage';
import { COPY } from '@/lib/ui/copy';

export const metadata: Metadata = {
  title: `${COPY.identity.productName} Technology - 个人上下文基础设施`,
  description: COPY.technology.hero.body,
};

export default function TechnologyRoute() {
  return <TechnologyPage />;
}
