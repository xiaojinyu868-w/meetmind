import type { MouseEvent } from 'react';

/**
 * SpotlightCard 鼠标聚光灯（React Bits 风格）：
 * 在 mousemove 时把光标坐标写进 CSS 变量 --mx / --my，
 * 配合卡片上的 radial-gradient(circle at var(--mx) var(--my)) 使用。
 */
export function handleSpotlightMove(event: MouseEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  target.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  target.style.setProperty('--my', `${event.clientY - rect.top}px`);
}
