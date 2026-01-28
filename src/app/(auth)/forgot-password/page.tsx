'use client';

/**
 * 忘记密码页面
 * 步骤：
 * 1. 输入邮箱/手机号
 * 2. 获取验证码
 * 3. 输入验证码和新密码
 * 4. 重置成功，跳转登录
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type ResetStep = 'input' | 'verify' | 'success';
type TargetType = 'email' | 'phone';

export default function ForgotPasswordPage() {
  const router = useRouter();
  
  const [step, setStep] = useState<ResetStep>('input');
  const [targetType, setTargetType] = useState<TargetType>('email');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 验证输入格式
  const validateTarget = useCallback(() => {
    if (!target) {
      setError(targetType === 'email' ? '请输入邮箱' : '请输入手机号');
      return false;
    }
    
    if (targetType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('请输入正确的邮箱格式');
      return false;
    }
    
    if (targetType === 'phone' && !/^1[3-9]\d{9}$/.test(target)) {
      setError('请输入正确的手机号');
      return false;
    }
    
    return true;
  }, [target, targetType]);

  // 发送验证码
  const sendVerificationCode = async () => {
    if (!validateTarget()) return;
    
    setIsSendingCode(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          type: targetType === 'email' ? 'email' : 'sms',
          purpose: 'reset_password'
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setCountdown(60);
        setStep('verify');
      } else {
        setError(result.error || '发送失败');
        if (result.retryAfter) setCountdown(result.retryAfter);
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  };

  // 重置密码
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (code.length !== 6) {
      setError('请输入6位验证码');
      return;
    }
    
    if (newPassword.length < 8) {
      setError('密码至少8个字符');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          code,
          newPassword
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setStep('success');
      } else {
        setError(result.error || '重置失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 切换目标类型
  const handleTargetTypeChange = (type: TargetType) => {
    setTargetType(type);
    setTarget('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-blue-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* 返回登录 */}
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回登录
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* 步骤1: 输入邮箱/手机号 */}
          {step === 'input' && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-2">找回密码</h1>
              <p className="text-sm text-gray-500 mb-6">请输入您的邮箱或手机号，我们将发送验证码</p>

              {/* 切换邮箱/手机号 */}
              <div className="flex items-center gap-4 mb-5 border-b border-gray-200 pb-4">
                <button
                  onClick={() => handleTargetTypeChange('email')}
                  className="text-sm pb-1 border-b-2 transition-all font-medium"
                  style={{ 
                    color: targetType === 'email' ? '#E11D48' : '#6B7280',
                    borderColor: targetType === 'email' ? '#E11D48' : 'transparent',
                  }}
                >
                  邮箱找回
                </button>
                <button
                  onClick={() => handleTargetTypeChange('phone')}
                  className="text-sm pb-1 border-b-2 transition-all font-medium"
                  style={{ 
                    color: targetType === 'phone' ? '#E11D48' : '#6B7280',
                    borderColor: targetType === 'phone' ? '#E11D48' : 'transparent',
                  }}
                >
                  手机找回
                </button>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-600">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {targetType === 'email' ? '邮箱地址' : '手机号码'}
                  </label>
                  <input
                    type={targetType === 'email' ? 'email' : 'tel'}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={targetType === 'email' ? '请输入注册邮箱' : '请输入注册手机号'}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
                  />
                </div>

                <button
                  onClick={sendVerificationCode}
                  disabled={isSendingCode || countdown > 0}
                  className="w-full py-3 px-4 text-white font-medium rounded-xl transition-all disabled:opacity-50"
                  style={{ 
                    background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                    boxShadow: '0 4px 14px -3px rgba(225,29,72,0.4)'
                  }}
                >
                  {isSendingCode ? '发送中...' : countdown > 0 ? `${countdown}秒后重试` : '获取验证码'}
                </button>
              </div>
            </>
          )}

          {/* 步骤2: 输入验证码和新密码 */}
          {step === 'verify' && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-2">设置新密码</h1>
              <p className="text-sm text-gray-500 mb-6">
                验证码已发送至 <span className="text-rose-500">{target}</span>
              </p>

              {/* 错误提示 */}
              {error && (
                <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-600">
                  {error}
                </div>
              )}

              <form onSubmit={handleResetPassword} className="space-y-4">
                {/* 验证码 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">验证码</label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="请输入6位验证码"
                      maxLength={6}
                      required
                      className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={sendVerificationCode}
                      disabled={isSendingCode || countdown > 0}
                      className="px-4 py-3 rounded-xl font-medium whitespace-nowrap transition-all disabled:opacity-50 bg-rose-100 text-rose-600 hover:bg-rose-200 border border-rose-200"
                    >
                      {countdown > 0 ? `${countdown}s` : '重新发送'}
                    </button>
                  </div>
                </div>

                {/* 新密码 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少8个字符"
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
                    placeholder="再次输入新密码"
                    required
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 focus:outline-none transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 text-white font-medium rounded-xl transition-all disabled:opacity-50"
                  style={{ 
                    background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                    boxShadow: '0 4px 14px -3px rgba(225,29,72,0.4)'
                  }}
                >
                  {isSubmitting ? '重置中...' : '重置密码'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="w-full py-3 px-4 text-gray-600 font-medium rounded-xl transition-all bg-gray-100 hover:bg-gray-200"
                >
                  返回上一步
                </button>
              </form>
            </>
          )}

          {/* 步骤3: 成功 */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">密码重置成功</h1>
              <p className="text-sm text-gray-500 mb-6">您现在可以使用新密码登录了</p>
              
              <button
                onClick={() => router.push('/login')}
                className="w-full py-3 px-4 text-white font-medium rounded-xl transition-all"
                style={{ 
                  background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                  boxShadow: '0 4px 14px -3px rgba(225,29,72,0.4)'
                }}
              >
                去登录
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
