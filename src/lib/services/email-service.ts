/**
 * 邮箱服务
 * 
 * 使用 SMTP 发送邮件，支持 QQ 邮箱、163 邮箱等
 * 主要用于发送验证码邮件
 * 
 * 性能优化：
 * - 支持异步发送模式（fire-and-forget），快速返回响应
 * - 支持失败重试机制
 */

import nodemailer from 'nodemailer';
import { verificationCodeService, type CodePurpose } from './verification-code-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('email');


// 邮箱配置（从环境变量读取 - 使用函数确保运行时读取）
const getSmtpConfig = () => ({
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE !== 'false', // 默认 true
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '', // QQ邮箱使用授权码
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  appName: process.env.APP_NAME || 'MeetMind',
});

// 创建邮件传输器（每次调用时重新创建以确保使用最新配置）
function createTransporter(): nodemailer.Transporter {
  const config = getSmtpConfig();
  
  if (!config.user || !config.pass) {
    log.error('[EmailService] SMTP 配置检查:', {
      host: config.host,
      user: config.user ? '已配置' : '未配置',
      pass: config.pass ? '已配置' : '未配置',
    });
    throw new Error('邮箱服务未配置，请设置 SMTP_USER 和 SMTP_PASS 环境变量');
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

// 邮件模板生成函数（动态获取 appName）
const getEmailTemplates = () => {
  const appName = getSmtpConfig().appName;
  return {
    login: {
      subject: `【${appName}】登录验证码`,
      html: (code: string) => `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${appName}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
            <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">您正在登录 ${appName}，验证码为：</p>
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
      subject: `【${appName}】注册验证码`,
      html: (code: string) => `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${appName}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
            <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">欢迎注册 ${appName}，验证码为：</p>
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
      subject: `【${appName}】重置密码验证码`,
      html: (code: string) => `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${appName}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
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
};

interface SendEmailResult {
  success: boolean;
  error?: string;
  retryAfter?: number;
}

// 邮件发送选项
interface SendEmailOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔（毫秒） */
  retryDelay?: number;
}

/**
 * 异步发送邮件（带重试）
 * 不阻塞主流程，在后台执行
 */
async function sendEmailWithRetry(
  email: string,
  code: string,
  purpose: CodePurpose,
  options: SendEmailOptions = {}
): Promise<void> {
  const { maxRetries = 2, retryDelay = 1000 } = options;
  const templates = getEmailTemplates();
  const template = templates[purpose];
  const config = getSmtpConfig();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const transport = createTransporter();
      await transport.sendMail({
        from: `"${config.appName}" <${config.from}>`,
        to: email,
        subject: template.subject,
        html: template.html(code),
      });

      return; // 发送成功，退出
    } catch (error) {
      log.error(`[EmailService] 发送邮件失败 [attempt: ${attempt + 1}/${maxRetries + 1}]:`, error);
      
      if (attempt < maxRetries) {
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }

  // 所有重试都失败了，记录错误（但不影响用户操作，验证码已入库）
  log.error(`[EmailService] 发送邮件最终失败: ${email} (${purpose}) - 验证码已入库，用户可尝试重新发送`);
}

export const emailService = {
  /**
   * 检查邮箱服务是否可用
   */
  isConfigured(): boolean {
    const config = getSmtpConfig();
    return !!(config.user && config.pass);
  },

  /**
   * 发送验证码邮件（同步模式，等待发送完成）
   */
  async sendVerificationCode(email: string, purpose: CodePurpose): Promise<SendEmailResult> {
    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: '邮箱格式不正确' };
    }

    // 检查配置
    if (!this.isConfigured()) {
      log.error('[EmailService] SMTP 未配置');
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
    const templates = getEmailTemplates();
    const template = templates[purpose];
    const config = getSmtpConfig();

    try {
      const transport = createTransporter();
      await transport.sendMail({
        from: `"${config.appName}" <${config.from}>`,
        to: email,
        subject: template.subject,
        html: template.html(code),
      });

      return { success: true };
    } catch (error) {
      log.error('[EmailService] 发送邮件失败:', error);
      return { success: false, error: '发送邮件失败，请稍后重试' };
    }
  },

  /**
   * 发送验证码邮件（异步模式，立即返回）
   * 
   * 优点：
   * - 快速响应（<200ms）
   * - 邮件在后台发送，不阻塞用户操作
   * - 支持自动重试
   * 
   * 注意：
   * - 返回 success: true 仅表示验证码已创建并入库
   * - 邮件发送在后台进行，可能会失败（但有重试机制）
   */
  async sendVerificationCodeAsync(email: string, purpose: CodePurpose): Promise<SendEmailResult> {
    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: '邮箱格式不正确' };
    }

    // 检查配置
    if (!this.isConfigured()) {
      log.error('[EmailService] SMTP 未配置');
      return { success: false, error: '邮箱服务暂不可用' };
    }

    // 创建验证码（同步）
    const codeResult = await verificationCodeService.createCode(email, 'email', purpose);
    if (!codeResult.success) {
      return { 
        success: false, 
        error: codeResult.error,
        retryAfter: codeResult.retryAfter 
      };
    }

    const code = codeResult.code!;

    // 异步发送邮件（fire-and-forget）
    // 使用 setImmediate/setTimeout 确保不阻塞当前响应
    setImmediate(() => {
      sendEmailWithRetry(email, code, purpose, {
        maxRetries: 2,
        retryDelay: 1000,
      }).catch(err => {
        log.error('[EmailService] 异步发送邮件出错:', err);
      });
    });

    // 立即返回成功（验证码已入库）
    return { success: true };
  },

  /**
   * 验证邮箱验证码
   */
  async verifyCode(email: string, code: string, purpose: CodePurpose) {
    return verificationCodeService.verifyCode(email, code, 'email', purpose);
  },
};
