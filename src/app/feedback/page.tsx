'use client';

import { useState } from 'react';
import Link from 'next/link';

type FeedbackType = 'bug' | 'feature' | 'question' | 'other';

const FEEDBACK_TYPES: { value: FeedbackType; label: string; icon: string; description: string }[] = [
  { value: 'bug', label: '问题反馈', icon: '🐛', description: '报告功能异常或错误' },
  { value: 'feature', label: '功能建议', icon: '💡', description: '提出新功能或改进建议' },
  { value: 'question', label: '使用咨询', icon: '❓', description: '咨询产品使用方法' },
  { value: 'other', label: '其他', icon: '📝', description: '其他类型的反馈' },
];

export default function FeedbackPage() {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !content.trim()) {
      setSubmitResult({ success: false, message: '请填写标题和详细描述' });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: feedbackType,
          title: title.trim(),
          content: content.trim(),
          contact: contact.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSubmitResult({ success: true, message: '感谢您的反馈！我们会认真处理。' });
        // 清空表单
        setTitle('');
        setContent('');
        setContact('');
      } else {
        setSubmitResult({ success: false, message: result.error || '提交失败，请稍后重试' });
      }
    } catch {
      setSubmitResult({ success: false, message: '网络错误，请稍后重试' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-rose-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-lg border-b border-rose-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2 text-gray-600 hover:text-rose-500 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>返回</span>
          </Link>
          <h1 className="text-lg font-semibold text-gray-800">意见反馈</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* 提交成功提示 */}
        {submitResult?.success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-green-800">{submitResult.message}</p>
              <p className="text-sm text-green-600 mt-0.5">我们会尽快处理您的反馈</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 反馈类型选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">反馈类型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FEEDBACK_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setFeedbackType(type.value)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    feedbackType === type.value
                      ? 'border-rose-400 bg-rose-50'
                      : 'border-gray-200 bg-white hover:border-rose-200'
                  }`}
                >
                  <span className="text-2xl mb-2 block">{type.icon}</span>
                  <span className={`text-sm font-medium block ${
                    feedbackType === type.value ? 'text-rose-600' : 'text-gray-800'
                  }`}>
                    {type.label}
                  </span>
                  <span className="text-xs text-gray-500 mt-1 block">{type.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              标题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请简要描述您的问题或建议"
              maxLength={100}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 outline-none transition-all"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{title.length}/100</p>
          </div>

          {/* 详细描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              详细描述 <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请详细描述您遇到的问题、期望的功能或其他建议。&#10;&#10;如果是问题反馈，请尽量提供：&#10;- 问题出现的步骤&#10;- 预期的结果&#10;- 实际的结果"
              rows={6}
              maxLength={2000}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 outline-none transition-all resize-none"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{content.length}/2000</p>
          </div>

          {/* 联系方式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              联系方式 <span className="text-gray-400 font-normal">(可选)</span>
            </label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="邮箱或手机号，方便我们与您联系"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 outline-none transition-all"
            />
          </div>

          {/* 错误提示 */}
          {submitResult && !submitResult.success && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {submitResult.message}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-rose-400 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                提交中...
              </span>
            ) : '提交反馈'}
          </button>
        </form>

        {/* 其他联系方式 */}
        <div className="mt-12 p-6 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">其他联系方式</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span>邮箱：originedu@meetmind.online</span>
            </div>
            <p className="text-xs text-gray-400 ml-11">
              我们通常会在 1-3 个工作日内回复
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
