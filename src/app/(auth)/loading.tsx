export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#FAF7F2]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-3 border-divider border-t-pine rounded-full animate-spin" />
        <p className="text-sm text-ink-muted">加载中...</p>
      </div>
    </div>
  );
}
