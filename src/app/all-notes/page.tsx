/**
 * 跨课程笔记管理页面
 * 
 * 显示学生所有课程的笔记，支持搜索和筛选
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import type { NoteSource, NoteWithSession } from '@/types';

// Demo 笔记数据
const DEMO_NOTES: NoteWithSession[] = [
  {
    id: 'note-1',
    sessionId: 'demo-session-1',
    studentId: 'student-1',
    source: 'transcript',
    text: '二次函数的顶点坐标公式：(-b/2a, (4ac-b²)/4a)，这个公式要记住！',
    metadata: {
      transcript: { start: 110000, end: 150000 },
      selectedText: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)',
      timestampLabel: '01:50'
    },
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    session: {
      sessionId: 'demo-session-1',
      subject: '数学',
      topic: '二次函数的图像与性质',
      date: new Date().toISOString().split('T')[0]
    }
  },
  {
    id: 'note-2',
    sessionId: 'demo-session-1',
    studentId: 'student-1',
    source: 'chat',
    text: 'AI 解释说 a 的正负决定开口方向，a > 0 向上，a < 0 向下。这个和我之前理解的一样。',
    metadata: {
      chat: { messageId: 'msg-1', role: 'assistant' },
      selectedText: '当 a 大于 0 时，抛物线开口向上'
    },
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    session: {
      sessionId: 'demo-session-1',
      subject: '数学',
      topic: '二次函数的图像与性质',
      date: new Date().toISOString().split('T')[0]
    }
  },
  {
    id: 'note-3',
    sessionId: 'demo-session-2',
    studentId: 'student-1',
    source: 'takeaways',
    text: '牛顿第三定律：作用力和反作用力大小相等、方向相反、作用在不同物体上。',
    metadata: {
      selectedText: '牛顿第三定律',
      extra: { timestamps: ['05:30'] }
    },
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    session: {
      sessionId: 'demo-session-2',
      subject: '物理',
      topic: '牛顿运动定律',
      date: new Date(Date.now() - 86400000).toISOString().split('T')[0]
    }
  },
  {
    id: 'note-4',
    sessionId: 'demo-session-3',
    studentId: 'student-1',
    source: 'custom',
    text: '今天学的文言文虚词"之"有四种用法：代词、助词、动词、兼词。需要多做练习区分。',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    session: {
      sessionId: 'demo-session-3',
      subject: '语文',
      topic: '文言文虚词',
      date: new Date(Date.now() - 172800000).toISOString().split('T')[0]
    }
  }
];

// 工具函数
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getSourceLabel(source: NoteSource): string {
  switch (source) {
    case 'chat': return '同学对话';
    case 'takeaways': return '知识点';
    case 'transcript': return '转录';
    case 'custom': return '自定义';
    default: return '笔记';
  }
}

function getSourceColor(source: NoteSource): string {
  switch (source) {
    case 'chat': return 'bg-purple-100 text-purple-700';
    case 'takeaways': return 'bg-green-100 text-green-700';
    case 'transcript': return 'bg-blue-100 text-blue-700';
    case 'custom': return 'bg-gray-100 text-gray-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function getSubjectColor(subject: string): string {
  switch (subject) {
    case '数学': return 'bg-blue-500';
    case '物理': return 'bg-green-500';
    case '化学': return 'bg-purple-500';
    case '语文': return 'bg-orange-500';
    case '英语': return 'bg-pink-500';
    default: return 'bg-gray-500';
  }
}

export default function AllNotesPage() {
  const [notes, setNotes] = useState<NoteWithSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<NoteSource | 'all'>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'subject'>('date');
  
  // 加载笔记
  useEffect(() => {
    // 模拟加载
    setTimeout(() => {
      setNotes(DEMO_NOTES);
      setIsLoading(false);
    }, 500);
  }, []);
  
  // 获取所有学科
  const subjects = useMemo(() => {
    const subjectSet = new Set<string>();
    notes.forEach(note => {
      if (note.session?.subject) {
        subjectSet.add(note.session.subject);
      }
    });
    return Array.from(subjectSet);
  }, [notes]);
  
  // 筛选和搜索
  const filteredNotes = useMemo(() => {
    let result = notes;
    
    // 搜索
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(note => 
        note.text.toLowerCase().includes(query) ||
        note.metadata?.selectedText?.toLowerCase().includes(query) ||
        note.session?.topic?.toLowerCase().includes(query)
      );
    }
    
    // 按来源筛选
    if (filterSource !== 'all') {
      result = result.filter(note => note.source === filterSource);
    }
    
    // 按学科筛选
    if (filterSubject !== 'all') {
      result = result.filter(note => note.session?.subject === filterSubject);
    }
    
    // 排序
    if (sortBy === 'date') {
      result = [...result].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else {
      result = [...result].sort((a, b) => 
        (a.session?.subject ?? '').localeCompare(b.session?.subject ?? '')
      );
    }
    
    return result;
  }, [notes, searchQuery, filterSource, filterSubject, sortBy]);
  
  // 按日期分组
  const groupedNotes = useMemo(() => {
    const groups: Record<string, NoteWithSession[]> = {};
    
    filteredNotes.forEach(note => {
      const date = note.session?.date ?? new Date(note.createdAt).toISOString().split('T')[0];
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(note);
    });
    
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredNotes]);
  
  // 删除笔记
  const handleDeleteNote = (noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  };
  
  // 统计
  const stats = useMemo(() => ({
    total: notes.length,
    bySource: {
      chat: notes.filter(n => n.source === 'chat').length,
      takeaways: notes.filter(n => n.source === 'takeaways').length,
      transcript: notes.filter(n => n.source === 'transcript').length,
      custom: notes.filter(n => n.source === 'custom').length
    },
    thisWeek: notes.filter(n => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(n.createdAt) >= weekAgo;
    }).length
  }), [notes]);
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">加载笔记中...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Header lessonTitle="我的笔记" courseName="跨课程笔记管理" />
      
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">总笔记数</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">{stats.thisWeek}</div>
            <div className="text-sm text-gray-500">本周新增</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-purple-600">{stats.bySource.chat}</div>
            <div className="text-sm text-gray-500">同学对话笔记</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-green-600">{subjects.length}</div>
            <div className="text-sm text-gray-500">涉及学科</div>
          </div>
        </div>
        
        {/* 搜索和筛选 */}
        <div className="bg-white rounded-xl p-4 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* 搜索框 */}
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索笔记内容..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {/* 筛选器 */}
            <div className="flex gap-2">
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as NoteSource | 'all')}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">全部来源</option>
                <option value="chat">同学对话</option>
                <option value="takeaways">知识点</option>
                <option value="transcript">转录</option>
                <option value="custom">自定义</option>
              </select>
              
              <select
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">全部学科</option>
                {subjects.map(subject => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
              
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'date' | 'subject')}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="date">按时间</option>
                <option value="subject">按学科</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* 笔记列表 */}
        {filteredNotes.length === 0 ? (
          <div className="bg-white rounded-xl p-12 shadow-sm text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? '未找到匹配的笔记' : '暂无笔记'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery ? '尝试使用其他关键词搜索' : '在复习时添加笔记，这里会显示所有课程的笔记'}
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              去添加笔记
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedNotes.map(([date, dateNotes]) => (
              <div key={date}>
                {/* 日期标题 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-sm font-medium text-gray-500">
                    {date === new Date().toISOString().split('T')[0] 
                      ? '今天' 
                      : date === new Date(Date.now() - 86400000).toISOString().split('T')[0]
                        ? '昨天'
                        : new Date(date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
                    }
                  </div>
                  <div className="flex-1 h-px bg-gray-200" />
                  <div className="text-xs text-gray-400">{dateNotes.length} 条</div>
                </div>
                
                {/* 笔记卡片 */}
                <div className="space-y-3">
                  {dateNotes.map(note => (
                    <div key={note.id} className="bg-white rounded-xl p-4 shadow-sm hover:transition-shadow">
                      <div className="flex items-start gap-3">
                        {/* 学科标记 */}
                        <div className={`w-1 h-full min-h-[60px] rounded-full ${getSubjectColor(note.session?.subject ?? '')}`} />
                        
                        <div className="flex-1 min-w-0">
                          {/* 头部信息 */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-0.5 text-xs rounded ${getSourceColor(note.source)}`}>
                              {getSourceLabel(note.source)}
                            </span>
                            {note.session && (
                              <>
                                <span className="text-xs text-gray-400">·</span>
                                <span className="text-xs text-gray-500">{note.session.subject}</span>
                                <span className="text-xs text-gray-400">·</span>
                                <span className="text-xs text-gray-500 truncate">{note.session.topic}</span>
                              </>
                            )}
                            <span className="ml-auto text-xs text-gray-400">{formatDate(note.createdAt)}</span>
                          </div>
                          
                          {/* 引用内容 */}
                          {note.metadata?.selectedText && (
                            <div className="mb-2 p-2 bg-gray-50 rounded border-l-2 border-gray-300">
                              <p className="text-xs text-gray-500 line-clamp-2">{note.metadata.selectedText}</p>
                            </div>
                          )}
                          
                          {/* 笔记内容 */}
                          <p className="text-gray-800">{note.text}</p>
                          
                          {/* 操作按钮 */}
                          <div className="flex items-center gap-2 mt-3">
                            <Link
                              href={`/?session=${note.sessionId}${note.metadata?.transcript?.start ? `&time=${note.metadata.transcript.start}` : ''}`}
                              className="text-xs text-blue-600 hover:text-blue-700"
                            >
                              查看原文
                            </Link>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => handleDeleteNote(note.id)}
                              className="text-xs text-red-500 hover:text-red-600"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* 底部提示 */}
        <div className="text-center py-8">
          <p className="text-sm text-gray-400">
            💡 好记性不如烂笔头，坚持记笔记，学习更高效！
          </p>
        </div>
      </main>
    </div>
  );
}
