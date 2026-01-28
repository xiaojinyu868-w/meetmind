'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 可以在这里上报错误到监控服务
    console.error('页面错误:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-amber-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {/* 错误图标 */}
        <div className="w-20 h-20 mx-auto mb-6 bg-rose-100 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        {/* 标题 */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          哎呀，出错了
        </h1>
        
        {/* 描述 */}
        <p className="text-gray-600 mb-6">
          页面遇到了一些问题，请稍后再试。
          {error.digest && (
            <span className="block text-xs text-gray-400 mt-2">
              错误代码: {error.digest}
            </span>
          )}
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 bg-gradient-to-r from-rose-500 to-rose-400 text-white font-medium rounded-xl hover:from-rose-600 hover:to-rose-500 transition-all shadow-lg hover:shadow-xl"
          >
            重试
          </button>
          <a
            href="/"
            className="px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-all"
          >
            返回首页
          </a>
        </div>

        {/* 反馈链接 */}
        <p className="mt-6 text-sm text-gray-500">
          问题持续存在？
          <a href="/feedback" className="text-rose-500 hover:underline ml-1">
            向我们反馈
          </a>
        </p>
      </div>
    </div>
  );
}
