export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#FFF9F5]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-3 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    </div>
  );
}
