/**
 * settings/SettingsNav — 桌面端左侧锚点导航（md 以下隐藏，移动端保持单列长页）。
 *
 * 参考 Linear / Stripe 设置页：section 一多，单列长页的"乱"本质是缺少地图。
 * IntersectionObserver 跟踪当前 section（rootMargin 把激活线压在视口上 1/3），
 * 点击平滑滚动；active 态用 pine 左侧短竖线 + 墨色文字，克制不喧宾。
 */

'use client';

import { useEffect, useState } from 'react';

export type SettingsNavItem = { id: string; label: string };

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 同一批可能有多个 section 进入激活窗口（如页首时账户+学习偏好），
        // 取离视口顶部最近的一个，否则激活态会停在靠后的 section 上
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActiveId(visible[0].target.id);
      },
      // 激活窗口：视口顶部 96px（让出 sticky header）到底部 65% 之间
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  const scrollTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav aria-label="设置导航" className="sticky top-[76px] flex flex-col gap-0.5 self-start">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollTo(item.id)}
            aria-current={active ? 'true' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
              active ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            <span
              className={`h-3.5 w-[2px] flex-shrink-0 rounded-full transition-colors ${
                active ? 'bg-pine' : 'bg-transparent'
              }`}
            />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
