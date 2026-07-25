import type { Metadata } from 'next';
import { LandingPage } from '@/components/LandingPage';
import { COPY } from '@/lib/ui/copy';

export const metadata: Metadata = {
  metadataBase: new URL('https://capture.meetmind.online'),
  title: `${COPY.identity.productName} - ${COPY.landing.hero.eyebrow}`,
  description: COPY.landing.hero.body,
  openGraph: {
    title: `${COPY.identity.productName} - ${COPY.landing.hero.eyebrow}`,
    description: COPY.landing.hero.body,
    type: 'website',
    locale: 'zh_CN',
    images: [{
      url: '/images/landing/meetmind-social-card.png',
      width: 1200,
      height: 630,
      alt: COPY.landing.hero.title.replaceAll('\n', ' '),
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${COPY.identity.productName} - ${COPY.landing.hero.eyebrow}`,
    description: COPY.landing.hero.body,
    images: ['/images/landing/meetmind-social-card.png'],
  },
};

export default function RootPage() {
  return <LandingPage />;
}
