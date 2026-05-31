import { OctoAvatar } from '@/components/ui/octo-avatar';

/**
 * v7 Loading 态：
 * 不再是通用 spinner——用 Octo thinking 表情 + 米白纸感底 + 极淡气息流。
 * 让等待本身成为品牌时刻。
 */
export default function Loading() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-4">
      {/* 极淡墨绿 / 朱批光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 40%, rgba(45,79,62,0.06), transparent 60%)',
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <OctoAvatar mood="thinking" size="xl" aura priority />

        {/* 文案 */}
        <div className="flex flex-col items-center gap-2">
          <p className="font-mono text-xs uppercase tracking-caps text-pine font-semibold">
            正在准备
          </p>
          <p className="text-sm text-ink-secondary">Octo 在翻你的笔记…</p>
        </div>
      </div>
    </main>
  );
}
