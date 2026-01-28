/**
 * 验证码服务
 * 
 * 支持邮箱验证码和短信验证码的发送与验证
 * - 生成6位数字验证码
 * - 存储到数据库，5分钟过期
 * - 限制发送频率（60秒间隔）
 * - 限制验证尝试次数（最多5次）
 */

import prisma from '@/lib/prisma';
import { randomInt } from 'crypto';

// 验证码配置
const CODE_LENGTH = 6;
const CODE_EXPIRES_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

export type CodeType = 'email' | 'sms';
export type CodePurpose = 'login' | 'register' | 'reset_password';

interface SendCodeResult {
  success: boolean;
  error?: string;
  retryAfter?: number; // 剩余等待秒数
}

interface VerifyCodeResult {
  success: boolean;
  error?: string;
  attemptsLeft?: number;
}

/**
 * 生成6位数字验证码
 */
function generateCode(): string {
  return String(randomInt(100000, 999999));
}

/**
 * 检查是否可以发送验证码（频率限制）
 */
async function canSendCode(target: string, type: CodeType): Promise<{ allowed: boolean; retryAfter?: number }> {
  const recentCode = await prisma.verificationCode.findFirst({
    where: {
      target,
      type,
      createdAt: {
        gte: new Date(Date.now() - SEND_INTERVAL_SECONDS * 1000)
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (recentCode) {
    const elapsed = Math.floor((Date.now() - recentCode.createdAt.getTime()) / 1000);
    return { allowed: false, retryAfter: SEND_INTERVAL_SECONDS - elapsed };
  }

  return { allowed: true };
}

/**
 * 清理过期的验证码
 */
async function cleanupExpiredCodes(): Promise<void> {
  await prisma.verificationCode.deleteMany({
    where: {
      expiresAt: { lt: new Date() }
    }
  });
}

export const verificationCodeService = {
  /**
   * 创建验证码记录（不发送，由具体服务发送）
   */
  async createCode(target: string, type: CodeType, purpose: CodePurpose): Promise<SendCodeResult & { code?: string }> {
    // 检查发送频率
    const rateCheck = await canSendCode(target, type);
    if (!rateCheck.allowed) {
      return { 
        success: false, 
        error: `请${rateCheck.retryAfter}秒后再试`,
        retryAfter: rateCheck.retryAfter 
      };
    }

    // 清理该目标的旧验证码
    await prisma.verificationCode.deleteMany({
      where: { target, type, purpose }
    });

    // 生成新验证码
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRES_MINUTES * 60 * 1000);

    await prisma.verificationCode.create({
      data: {
        target,
        code,
        type,
        purpose,
        expiresAt
      }
    });

    // 定期清理过期验证码
    cleanupExpiredCodes().catch(console.error);

    return { success: true, code };
  },

  /**
   * 验证验证码
   */
  async verifyCode(target: string, code: string, type: CodeType, purpose: CodePurpose): Promise<VerifyCodeResult> {
    const record = await prisma.verificationCode.findFirst({
      where: {
        target,
        type,
        purpose,
        verified: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!record) {
      return { success: false, error: '请先获取验证码' };
    }

    // 检查是否过期
    if (record.expiresAt < new Date()) {
      await prisma.verificationCode.delete({ where: { id: record.id } });
      return { success: false, error: '验证码已过期，请重新获取' };
    }

    // 检查尝试次数
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await prisma.verificationCode.delete({ where: { id: record.id } });
      return { success: false, error: '验证次数过多，请重新获取验证码' };
    }

    // 验证码不匹配
    if (record.code !== code) {
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 }
      });
      return { 
        success: false, 
        error: '验证码错误',
        attemptsLeft: MAX_VERIFY_ATTEMPTS - record.attempts - 1
      };
    }

    // 验证成功，标记为已使用
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { verified: true }
    });

    return { success: true };
  },

  /**
   * 检查验证码是否已验证（用于后续操作）
   */
  async isCodeVerified(target: string, type: CodeType, purpose: CodePurpose): Promise<boolean> {
    const record = await prisma.verificationCode.findFirst({
      where: {
        target,
        type,
        purpose,
        verified: true,
        expiresAt: { gte: new Date() }
      }
    });

    return !!record;
  },

  /**
   * 消费已验证的验证码（验证后执行操作时调用）
   */
  async consumeVerifiedCode(target: string, type: CodeType, purpose: CodePurpose): Promise<boolean> {
    const result = await prisma.verificationCode.deleteMany({
      where: {
        target,
        type,
        purpose,
        verified: true
      }
    });

    return result.count > 0;
  }
};
