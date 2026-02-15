'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';
import { WORKSHOP_APP_CATALOG } from '@/lib/ai-native/app-catalog';
import { buildResultCacheKey } from '@/components/apps/hooks/useAppExecution';
import styles from './WorkshopYellowPage.module.css';

interface CatalogResponse {
  apps?: Array<WorkshopAppCatalogItem & { enabled?: boolean }>;
}

interface WorkshopYellowPageProps {
  sessionId: string;
  dataSource: DataSourceType;
}

export function WorkshopYellowPage({ sessionId, dataSource }: WorkshopYellowPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<Array<WorkshopAppCatalogItem & { enabled?: boolean }>>([]);
  const [generatedMap, setGeneratedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const response = await fetch('/api/apps/catalog', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as CatalogResponse;
      if (cancelled) return;
      if (Array.isArray(data.apps) && data.apps.length > 0) {
        setApps(data.apps);
      } else {
        setApps(WORKSHOP_APP_CATALOG);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return;
    const next: Record<string, boolean> = {};
    for (const app of apps) {
      next[app.key] = Boolean(window.localStorage.getItem(buildResultCacheKey(sessionId, app.key)));
    }
    setGeneratedMap(next);
  }, [apps, sessionId]);

  const visibleApps = useMemo(() => {
    if (apps.length > 0) return apps;
    return WORKSHOP_APP_CATALOG;
  }, [apps]);

  useEffect(() => {
    for (const app of visibleApps) {
      router.prefetch(`/app/matrix/${app.key}`);
    }
  }, [router, visibleApps]);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>多样的智能体应用</h2>
        <p className={styles.subTitle}>AI工坊只负责发现与进入，点击卡片后进入独立应用窗口执行与渲染。</p>
      </header>
      <div className={styles.grid}>
        {visibleApps.map((app) => {
          const generated = generatedMap[app.key];
          const isGuest = searchParams.get('guest') === '1';
          const href = `/app/matrix/${app.key}?sessionId=${encodeURIComponent(sessionId)}&dataSource=${encodeURIComponent(dataSource)}${isGuest ? '&guest=1' : ''}`;
          return (
            <article key={app.key} className={styles.card} data-testid={`workshop-card-${app.key}`}>
              <div className={styles.coverWrap}>
                <Image src={app.coverImage} alt={app.name} width={1200} height={630} className={styles.cover} />
              </div>
              <div className={styles.rowTop}>
                <div className={styles.titleGroup}>
                  <p className={styles.category}>{app.category}</p>
                  <p className={styles.headline}>{app.headline}</p>
                </div>
                <span className={`${styles.generated} ${generated ? '' : styles.notGenerated}`}>{generated ? '已生成' : '未生成'}</span>
              </div>
              <div className={styles.tags}>
                {app.tags.slice(0, 3).map((tag) => (
                  <span key={`${app.key}-${tag}`} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p className={styles.description}>{app.description}</p>
              <Link
                href={href}
                className={styles.link}
              >
                查看应用 <span>›</span>
              </Link>
              <p className={styles.metaLine}>输出形态：{app.outputType}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
