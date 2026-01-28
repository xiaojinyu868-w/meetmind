import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center">
        {/* 404 大字 */}
        <div className="relative mb-8">
          <h1 className="text-[150px] font-bold text-amber-200 leading-none select-none">
            404
          </h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 bg-white rounded-full shadow-xl flex items-center justify-center">
              <svg className="w-12 h-12 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* 标题 */}
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          页面走丢了
        </h2>
        
        {/* 描述 */}
        <p className="text-gray-600 mb-8 max-w-md mx-auto">
          抱歉，您访问的页面不存在或已被移除。
          <br />
          请检查网址是否正确，或返回首页继续浏览。
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-white font-medium rounded-xl hover:from-amber-500 hover:to-amber-600 transition-all shadow-lg hover:shadow-xl"
          >
            返回首页
          </Link>
          <Link
            href="/app"
            className="px-6 py-3 bg-white text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-all border border-gray-200"
          >
            进入应用
          </Link>
        </div>

        {/* 常用链接 */}
        <div className="mt-10 pt-6 border-t border-amber-200/50">
          <p className="text-sm text-gray-500 mb-3">您可能想找：</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/login" className="text-sm text-amber-600 hover:underline">
              登录
            </Link>
            <Link href="/help" className="text-sm text-amber-600 hover:underline">
              帮助中心
            </Link>
            <Link href="/feedback" className="text-sm text-amber-600 hover:underline">
              意见反馈
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
