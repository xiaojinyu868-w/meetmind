'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';

type FeedbackType = 'bug' | 'feature' | 'content' | 'other';

const feedbackTypes: { value: FeedbackType; label: string; icon: string; description: string }[] = [
  { value: 'bug', label: '问题反馈', icon: '🐛', description: '报告功能异常或错误' },
  { value: 'feature', label: '功能建议', icon: '💡', description: '提出新功能或改进想法' },
  { value: 'content', label: '内容问题', icon: '📝', description: 'AI 生成内容不准确' },
  { value: 'other', label: '其他', icon: '💬', description: '其他意见或咨询' },
];

export default function FeedbackPage() {
  const { user, isAuthenticated } = useAuth();
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !content.trim()) {
      setError('请填写标题和详细描述');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          content: content.trim(),
          contact: contact.trim() || (user?.email || user?.phone || ''),
          userAgent: navigator.userAgent,
          url: document.referrer || window.location.href,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSubmitted(true);
      } else {
        setError(result.error || '提交失败，请稍后重试');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 提交成功页面
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-emerald-100 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            感谢您的反馈！
          </h1>
          <p className="text-gray-600 mb-6">
            我们已收到您的反馈，会认真处理。
            {contact && '如有需要，我们会通过您留下的联系方式与您沟通。'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/app"
              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium rounded-xl hover:from-emerald-600 hover:to-teal-600 transition-all"
            >
              继续使用
            </Link>
            <button
              onClick={() => {
                setSubmitted(false);
                setTitle('');
                setContent('');
              }}
              className="px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-all"
            >
              继续反馈
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-rose-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-amber-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm">返回</span>
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="font-semibold text-gray-900">MeetMind</span>
          </Link>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* 头部 */}
          <div className="bg-gradient-to-r from-amber-400 to-rose-400 px-6 py-8 text-white">
            <h1 className="text-2xl font-bold mb-2">意见反馈</h1>
            <p className="text-white/80">您的反馈是我们改进的动力，感谢您帮助 MeetMind 变得更好</p>
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* 反馈类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">反馈类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {feedbackTypes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setType(item.value)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      type === item.value
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-200 hover:bg-amber-50/50'
                    }`}
                  >
                    <span className="text-2xl block mb-1">{item.icon}</span>
                    <span className={`text-sm font-medium ${type === item.value ? 'text-amber-700' : 'text-gray-700'}`}>
                      {item.label}
                    </span>
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
                placeholder="简要描述您的反馈"
                maxLength={100}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100 transition-all"
              />
            </div>

            {/* 详细描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                详细描述 <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="请详细描述问题或建议，包括：&#10;• 问题发生的具体场景&#10;• 期望的效果或改进建议&#10;• 其他相关信息"
                rows={6}
                maxLength={2000}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100 transition-all resize-none"
              />
              <p className="mt-1 text-xs text-gray-400 text-right">{content.length}/2000</p>
            </div>

            {/* 联系方式 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                联系方式
                <span className="text-gray-400 font-normal ml-2">（选填，方便我们跟进）</span>
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={isAuthenticated ? (user?.email || user?.phone || '邮箱或手机号') : '邮箱或手机号'}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100 transition-all"
              />
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-sm">
                {error}
              </div>
            )}

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-gradient-to-r from-amber-400 to-rose-400 text-white font-semibold rounded-xl hover:from-amber-500 hover:to-rose-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {isSubmitting ? '提交中...' : '提交反馈'}
            </button>

            {/* 其他联系方式 */}
            <p className="text-center text-sm text-gray-500">
              您也可以发送邮件至{' '}
              <a href="mailto:originedu@meetmind.online" className="text-amber-600 hover:underline">
                originedu@meetmind.online
              </a>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
