import type { Metadata } from 'next';
import { TechnologyPage } from '@/components/TechnologyPage';
import { COPY } from '@/lib/ui/copy';

export const metadata: Metadata = {
  title: `${COPY.identity.productName} Technology - 为机器立师者之心`,
  description: COPY.technology.hero.sub,
};

export default function TechnologyRoute() {
  return <TechnologyPage />;
}
