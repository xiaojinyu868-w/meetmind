'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface FAQItem {
  question: string;
  answer: string;
}

interface HelpSection {
  title: string;
  icon: string;
  items: FAQItem[];
}

export default function HelpPage() {
  const t = useTranslations();
  const [expandedSection, setExpandedSection] = useState<number>(0);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['0-0']));

  const HELP_SECTIONS: HelpSection[] = [
    {
      title: t('help.sections.gettingStarted.title'),
      icon: t('help.sections.gettingStarted.icon'),
      items: [
        {
          question: t('help.sections.gettingStarted.q1.question'),
          answer: t('help.sections.gettingStarted.q1.answer')
        },
        {
          question: t('help.sections.gettingStarted.q2.question'),
          answer: t('help.sections.gettingStarted.q2.answer')
        },
        {
          question: t('help.sections.gettingStarted.q3.question'),
          answer: t('help.sections.gettingStarted.q3.answer')
        },
      ]
    },
    {
      title: t('help.sections.features.title'),
      icon: t('help.sections.features.icon'),
      items: [
        {
          question: t('help.sections.features.q1.question'),
          answer: t('help.sections.features.q1.answer')
        },
        {
          question: t('help.sections.features.q2.question'),
          answer: t('help.sections.features.q2.answer')
        },
        {
          question: t('help.sections.features.q3.question'),
          answer: t('help.sections.features.q3.answer')
        },
        {
          question: t('help.sections.features.q4.question'),
          answer: t('help.sections.features.q4.answer')
        },
      ]
    },
    {
      title: t('help.sections.account.title'),
      icon: t('help.sections.account.icon'),
      items: [
        {
          question: t('help.sections.account.q1.question'),
          answer: t('help.sections.account.q1.answer')
        },
        {
          question: t('help.sections.account.q2.question'),
          answer: t('help.sections.account.q2.answer')
        },
        {
          question: t('help.sections.account.q3.question'),
          answer: t('help.sections.account.q3.answer')
        },
      ]
    },
    {
      title: t('help.sections.other.title'),
      icon: t('help.sections.other.icon'),
      items: [
        {
          question: t('help.sections.other.q1.question'),
          answer: t('help.sections.other.q1.answer')
        },
        {
          question: t('help.sections.other.q2.question'),
          answer: t('help.sections.other.q2.answer')
        },
        {
          question: t('help.sections.other.q3.question'),
          answer: t('help.sections.other.q3.answer')
        },
      ]
    },
  ];

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
            <span>{t('help.back')}</span>
          </Link>
          <h1 className="text-lg font-semibold text-gray-800">{t('help.title')}</h1>
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('help.welcome')}</h2>
          <p className="text-gray-500">{t('help.subtitle')}</p>
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
              <h3 className="font-semibold text-lg mb-1">{t('help.contact.title')}</h3>
              <p className="text-white/80 text-sm">{t('help.contact.subtitle')}</p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/feedback"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-rose-500 font-medium rounded-xl hover:bg-rose-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                {t('help.contact.feedback')}
              </Link>
              <a
                href="mailto:originedu@meetmind.online"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white font-medium rounded-xl hover:bg-white/30 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {t('help.contact.email')}
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
