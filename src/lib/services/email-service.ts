/**
 * 邮箱服务
 * 
 * 使用 SMTP 发送邮件，支持 QQ 邮箱、163 邮箱等
 * 主要用于发送验证码邮件
 */

import nodemailer from 'nodemailer';
import { verificationCodeService, type CodePurpose } from './verification-code-service';

// 邮箱配置（从环境变量读取）
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false'; // 默认 true
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || ''; // QQ邮箱使用授权码
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const APP_NAME = process.env.APP_NAME || 'MeetMind';

// 创建邮件传输器
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!SMTP_USER || !SMTP_PASS) {
      throw new Error('邮箱服务未配置，请设置 SMTP_USER 和 SMTP_PASS 环境变量');
    }

    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

// 邮件模板
const EMAIL_TEMPLATES = {
  login: {
    subject: `【${APP_NAME}】登录验证码`,
    html: (code: string) => `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${APP_NAME}</h1>
          <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
        </div>
        <div style="background: linear-gradient(135deg, #FFF9F5 0%, #FFFBF0 100%); border-radius: 16px; padding: 30px; text-align: center;">
          <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">您正在登录 ${APP_NAME}，验证码为：</p>
          <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
            <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${code}</span>
          </div>
          <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
          如非本人操作，请忽略此邮件
        </p>
      </div>
    `,
  },
  register: {
    subject: `【${APP_NAME}】注册验证码`,
    html: (code: string) => `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${APP_NAME}</h1>
          <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
        </div>
        <div style="background: linear-gradient(135deg, #FFF9F5 0%, #FFFBF0 100%); border-radius: 16px; padding: 30px; text-align: center;">
          <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">欢迎注册 ${APP_NAME}，验证码为：</p>
          <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
            <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${code}</span>
          </div>
          <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
          如非本人操作，请忽略此邮件
        </p>
      </div>
    `,
  },
  reset_password: {
    subject: `【${APP_NAME}】重置密码验证码`,
    html: (code: string) => `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${APP_NAME}</h1>
          <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
        </div>
        <div style="background: linear-gradient(135deg, #FFF9F5 0%, #FFFBF0 100%); border-radius: 16px; padding: 30px; text-align: center;">
          <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">您正在重置密码，验证码为：</p>
          <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
            <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${code}</span>
          </div>
          <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
          如非本人操作，请立即修改密码
        </p>
      </div>
    `,
  },
};

interface SendEmailResult {
  success: boolean;
  error?: string;
  retryAfter?: number;
}

export const emailService = {
  /**
   * 检查邮箱服务是否可用
   */
  isConfigured(): boolean {
    return !!(SMTP_USER && SMTP_PASS);
  },

  /**
   * 发送验证码邮件
   */
  async sendVerificationCode(email: string, purpose: CodePurpose): Promise<SendEmailResult> {
    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: '邮箱格式不正确' };
    }

    // 检查配置
    if (!this.isConfigured()) {
      console.error('[EmailService] SMTP 未配置');
      return { success: false, error: '邮箱服务暂不可用' };
    }

    // 创建验证码
    const codeResult = await verificationCodeService.createCode(email, 'email', purpose);
    if (!codeResult.success) {
      return { 
        success: false, 
        error: codeResult.error,
        retryAfter: codeResult.retryAfter 
      };
    }

    const code = codeResult.code!;
    const template = EMAIL_TEMPLATES[purpose];

    try {
      const transport = getTransporter();
      await transport.sendMail({
        from: `"${APP_NAME}" <${SMTP_FROM}>`,
        to: email,
        subject: template.subject,
        html: template.html(code),
      });

      console.log(`[EmailService] 验证码已发送: ${email} (${purpose})`);
      return { success: true };
    } catch (error) {
      console.error('[EmailService] 发送邮件失败:', error);
      return { success: false, error: '发送邮件失败，请稍后重试' };
    }
  },

  /**
   * 验证邮箱验证码
   */
  async verifyCode(email: string, code: string, purpose: CodePurpose) {
    return verificationCodeService.verifyCode(email, code, 'email', purpose);
  },
};
