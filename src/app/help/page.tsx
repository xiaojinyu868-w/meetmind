'use client';

import { useState } from 'react';
import Link from 'next/link';

interface FAQItem {
  question: string;
  answer: string;
}

interface HelpSection {
  title: string;
  icon: string;
  items: FAQItem[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: '快速入门',
    icon: '🚀',
    items: [
      {
        question: 'MeetMind 是什么？',
        answer: 'MeetMind 是一款 AI 驱动的智能学习助手，可以帮助你将音频内容（如课堂录音、讲座、会议）转换为文字，并提供智能摘要、话题提取、AI 对话辅导等功能，让学习更高效。'
      },
      {
        question: '如何开始使用？',
        answer: '1. 注册或登录账户\n2. 在首页点击"开始录音"或"上传音频"\n3. 等待系统处理完成\n4. 查看转写文本、智能摘要\n5. 使用 AI 对话功能提问'
      },
      {
        question: '支持哪些音频格式？',
        answer: '支持常见的音频格式，包括 MP3、WAV、M4A、FLAC、OGG 等。单个文件大小建议不超过 100MB，时长建议不超过 2 小时以获得最佳体验。'
      },
    ]
  },
  {
    title: '功能使用',
    icon: '💡',
    items: [
      {
        question: '语音转文字准确率如何？',
        answer: '我们使用先进的 AI 语音识别技术，在清晰的普通话录音下准确率可达 95% 以上。录音质量、背景噪音、口音等因素会影响准确率。建议使用清晰的录音设备，减少环境噪音。'
      },
      {
        question: '智能摘要是如何生成的？',
        answer: 'AI 会分析转写的文本内容，自动提取关键信息，生成结构化的摘要，包括主要观点、重点内容和关键结论。你可以根据摘要快速了解内容要点。'
      },
      {
        question: 'AI 对话功能怎么用？',
        answer: '处理完音频后，你可以在对话区域向 AI 提问任何与内容相关的问题。例如："这节课的重点是什么？"、"能详细解释一下第三个知识点吗？"AI 会基于内容为你解答。'
      },
      {
        question: '可以编辑转写文本吗？',
        answer: '可以。如果发现转写结果有误，你可以直接点击文本进行编辑修正。修改后的内容会自动保存。'
      },
    ]
  },
  {
    title: '账户相关',
    icon: '👤',
    items: [
      {
        question: '如何修改个人信息？',
        answer: '点击右上角头像，进入"个人资料"页面，可以修改昵称、头像、绑定邮箱/手机号等信息。'
      },
      {
        question: '忘记密码怎么办？',
        answer: '在登录页面点击"忘记密码"，通过注册时的邮箱或手机号验证身份后，即可重置密码。'
      },
      {
        question: '如何保护我的隐私？',
        answer: '我们高度重视用户隐私。你上传的音频和生成的内容仅供你个人使用，不会被用于其他目的。详情请查看我们的隐私政策。'
      },
    ]
  },
  {
    title: '其他问题',
    icon: '❓',
    items: [
      {
        question: '处理速度慢怎么办？',
        answer: '处理速度取决于音频时长和服务器负载。一般 1 小时的音频需要 3-5 分钟处理。如果等待时间过长，可以尝试刷新页面或稍后再试。'
      },
      {
        question: '如何反馈问题或建议？',
        answer: '我们非常欢迎你的反馈！可以通过"意见反馈"页面提交，或发送邮件至 originedu@meetmind.online。'
      },
      {
        question: '有使用限制吗？',
        answer: '为保障服务质量，目前对 API 调用有一定的频率限制。如果你的使用需求较大，请联系我们。'
      },
    ]
  },
];

export default function HelpPage() {
  const [expandedSection, setExpandedSection] = useState<number>(0);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['0-0']));

  const toggleItem = (sectionIndex: number, itemIndex: number) => {
    const key = `${sectionIndex}-${itemIndex}`;
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-rose-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-lg border-b border-rose-100">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2 text-gray-600 hover:text-rose-500 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>返回</span>
          </Link>
          <h1 className="text-lg font-semibold text-gray-800">帮助中心</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* 欢迎区域 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-rose-400 to-rose-500 rounded-2xl shadow-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">有什么可以帮助你的？</h2>
          <p className="text-gray-500">浏览下方常见问题，或直接联系我们</p>
        </div>

        {/* 快速入口 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {HELP_SECTIONS.map((section, index) => (
            <button
              key={index}
              onClick={() => {
                setExpandedSection(index);
                document.getElementById(`section-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`p-4 rounded-xl border-2 transition-all text-center ${
                expandedSection === index
                  ? 'border-rose-400 bg-rose-50'
                  : 'border-gray-200 bg-white hover:border-rose-200 hover:bg-rose-50/50'
              }`}
            >
              <span className="text-3xl mb-2 block">{section.icon}</span>
              <span className={`text-sm font-medium ${
                expandedSection === index ? 'text-rose-600' : 'text-gray-700'
              }`}>{section.title}</span>
            </button>
          ))}
        </div>

        {/* FAQ 列表 */}
        <div className="space-y-8">
          {HELP_SECTIONS.map((section, sIndex) => (
            <div key={sIndex} id={`section-${sIndex}`} className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span>{section.icon}</span>
                <span>{section.title}</span>
              </h3>
              <div className="space-y-3">
                {section.items.map((item, iIndex) => {
                  const isExpanded = expandedItems.has(`${sIndex}-${iIndex}`);
                  return (
                    <div
                      key={iIndex}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
                    >
                      <button
                        onClick={() => toggleItem(sIndex, iIndex)}
                        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="font-medium text-gray-800 pr-4">{item.question}</span>
                        <svg
                          className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-4">
                          <div className="pt-2 border-t border-gray-100">
                            <p className="text-gray-600 whitespace-pre-line leading-relaxed">
                              {item.answer}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 联系我们 */}
        <div className="mt-12 p-6 bg-gradient-to-r from-rose-500 to-rose-400 rounded-2xl text-white">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-lg mb-1">没有找到答案？</h3>
              <p className="text-white/80 text-sm">我们的团队随时为你提供帮助</p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/feedback"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-rose-500 font-medium rounded-xl hover:bg-rose-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                提交反馈
              </Link>
              <a
                href="mailto:originedu@meetmind.online"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white font-medium rounded-xl hover:bg-white/30 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                发送邮件
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
