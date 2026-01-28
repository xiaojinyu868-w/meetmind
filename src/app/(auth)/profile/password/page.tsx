'use client';

/**
 * 密码管理页面
 * - 未设置密码：显示设置密码表单
 * - 已设置密码：显示修改密码表单
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';

export default function PasswordPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, accessToken } = useAuth();
  
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // 未登录则跳转
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // 检查是否已设置密码
  useEffect(() => {
    if (!accessToken) return;
    
    const checkPasswordStatus = async () => {
      try {
        const response = await fetch('/api/auth/password/set', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await response.json();
        if (data.success) {
          setHasPassword(data.hasPassword);
        }
      } catch (error) {
        console.error('检查密码状态失败:', error);
      } finally {
        setIsChecking(false);
      }
    };
    
    checkPasswordStatus();
  }, [accessToken]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });
    
    if (password.length < 8) {
      setMessage({ type: 'error', text: '密码至少8个字符' });
      return;
    }
    
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }
    
    setIsSaving(true);
    
    try {
      const response = await fetch('/api/auth/password/set', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ password })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: '密码设置成功！' });
        setPassword('');
        setConfirmPassword('');
        setHasPassword(true);
      } else {
        setMessage({ type: 'error', text: data.error || '设置失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });
    
    if (!oldPassword) {
      setMessage({ type: 'error', text: '请输入原密码' });
      return;
    }
    
    if (password.length < 8) {
      setMessage({ type: 'error', text: '新密码至少8个字符' });
      return;
    }
    
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }
    
    setIsSaving(true);
    
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ oldPassword, newPassword: password })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: '密码修改成功！' });
        setOldPassword('');
        setPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.error || '修改失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-400" style={{ animationDelay: '0ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-300" style={{ animationDelay: '150ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-200" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-blue-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        {/* 返回按钮 */}
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回个人中心
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-6">
            {hasPassword ? '修改密码' : '设置密码'}
          </h1>
          
          {!hasPassword && (
            <p className="text-sm text-gray-500 mb-6">
              您还未设置密码，设置后可使用密码登录
            </p>
          )}

          {/* 消息提示 */}
          {message.text && (
            <div className={`mb-6 p-3 rounded-xl text-sm ${
              message.type === 'success' 
                ? 'bg-green-50 border border-green-100 text-green-600' 
                : 'bg-red-50 border border-red-100 text-red-600'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={hasPassword ? handleChangePassword : handleSetPassword} className="space-y-4">
            {/* 原密码（仅修改时显示） */}
            {hasPassword && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">原密码</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="请输入原密码"
                  required
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
                />
              </div>
            )}
            
            {/* 新密码 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {hasPassword ? '新密码' : '密码'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少8个字符，包含字母和数字"
                required
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
              />
            </div>
            
            {/* 确认密码 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                required
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
              />
            </div>

            {/* 密码强度提示 */}
            <div className="text-xs text-gray-500 space-y-1">
              <p>密码要求：</p>
              <ul className="list-disc list-inside ml-2 space-y-0.5">
                <li>至少8个字符</li>
                <li>包含字母和数字</li>
              </ul>
            </div>

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-3 px-4 text-white font-medium rounded-xl transition-all disabled:opacity-50"
              style={{ 
                background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                boxShadow: '0 4px 14px -3px rgba(225,29,72,0.4)'
              }}
            >
              {isSaving ? '处理中...' : (hasPassword ? '修改密码' : '设置密码')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
