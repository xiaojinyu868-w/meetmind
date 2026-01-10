'use client';

/**
 * 个人资料页面
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, updateProfile, logout } = useAuth();
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    nickname: '',
    email: '',
    phone: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // 未登录则跳转
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // 初始化表单数据
  useEffect(() => {
    if (user) {
      setFormData({
        nickname: user.nickname || '',
        email: user.email || '',
        phone: user.phone || '',
      });
    }
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const success = await updateProfile(formData);
      
      if (success) {
        setMessage({ type: 'success', text: '保存成功' });
        setIsEditing(false);
      } else {
        setMessage({ type: 'error', text: '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    student: '学生',
    parent: '家长',
    teacher: '教师',
    admin: '管理员',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-blue-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 返回按钮 */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回首页
        </Link>

        {/* 头部 */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* 封面 */}
          <div className="h-32 bg-gradient-to-r from-rose-400 to-rose-500"></div>
          
          {/* 头像和基本信息 */}
          <div className="relative px-8 pb-8">
            <div className="absolute -top-12 left-8">
              <div className="w-24 h-24 bg-white rounded-2xl shadow-lg flex items-center justify-center text-4xl border-4 border-white">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.nickname} className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <span>👤</span>
                )}
              </div>
            </div>
            
            <div className="pt-16">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{user.nickname}</h1>
                  <p className="text-gray-500">@{user.username}</p>
                </div>
                <span className="px-3 py-1 bg-rose-100 text-rose-700 rounded-full text-sm font-medium">
                  {roleLabels[user.role] || user.role}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 消息提示 */}
        {message.text && (
          <div className={`mt-4 p-3 rounded-xl text-sm ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-100 text-green-600' 
              : 'bg-red-50 border border-red-100 text-red-600'
          }`}>
            {message.text}
          </div>
        )}

        {/* 个人资料 */}
        <div className="mt-6 bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">个人资料</h2>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              >
                编辑
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm text-white bg-rose-500 hover:bg-rose-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center py-3 border-b border-gray-100">
              <span className="w-24 text-sm text-gray-500">用户名</span>
              <span className="text-gray-900">{user.username}</span>
            </div>
            
            <div className="flex items-center py-3 border-b border-gray-100">
              <span className="w-24 text-sm text-gray-500">昵称</span>
              {isEditing ? (
                <input
                  type="text"
                  name="nickname"
                  value={formData.nickname}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300"
                />
              ) : (
                <span className="text-gray-900">{user.nickname}</span>
              )}
            </div>
            
            <div className="flex items-center py-3 border-b border-gray-100">
              <span className="w-24 text-sm text-gray-500">邮箱</span>
              {isEditing ? (
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300"
                  placeholder="未设置"
                />
              ) : (
                <span className="text-gray-900">{user.email || '未设置'}</span>
              )}
            </div>
            
            <div className="flex items-center py-3 border-b border-gray-100">
              <span className="w-24 text-sm text-gray-500">手机号</span>
              {isEditing ? (
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300"
                  placeholder="未设置"
                />
              ) : (
                <span className="text-gray-900">{user.phone || '未设置'}</span>
              )}
            </div>
            
            <div className="flex items-center py-3">
              <span className="w-24 text-sm text-gray-500">注册时间</span>
              <span className="text-gray-900">
                {new Date(user.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        </div>

        {/* 账户安全 */}
        <div className="mt-6 bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">账户安全</h2>
          
          <div className="space-y-4">
            <Link
              href="/profile/password"
              className="flex items-center justify-between py-3 border-b border-gray-100 hover:bg-gray-50 -mx-4 px-4 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🔒</span>
                <span className="text-gray-900">修改密码</span>
              </div>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            
            <Link
              href="/profile/bindwechat"
              className="flex items-center justify-between py-3 border-b border-gray-100 hover:bg-gray-50 -mx-4 px-4 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">💬</span>
                <span className="text-gray-900">绑定微信</span>
              </div>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* 退出登录 */}
        <div className="mt-6">
          <button
            onClick={handleLogout}
            className="w-full py-3 px-4 bg-white text-red-600 font-medium rounded-xl border border-red-200 hover:bg-red-50 transition-colors shadow-lg"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
