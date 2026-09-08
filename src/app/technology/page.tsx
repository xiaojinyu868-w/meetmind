import type { Metadata } from 'next';
import { TechnologyPage } from '@/components/TechnologyPage';
import { COPY } from '@/lib/ui/copy';
import { LANDING_COPY } from '@/lib/ui/copy-landing';

export const metadata: Metadata = {
  title: `${COPY.identity.productName} Technology - 为机器立师者之心`,
  description: LANDING_COPY.technology.hero.sub,
};

export default function TechnologyRoute() {
  return <TechnologyPage />;
}
