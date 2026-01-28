/**
 * 腾讯云短信服务
 * 
 * 使用腾讯云 SMS API 发送短信验证码
 * 文档：https://cloud.tencent.com/document/product/382
 */

import { createHmac, createHash } from 'crypto';
import { verificationCodeService, type CodePurpose } from './verification-code-service';

// 腾讯云短信配置（从环境变量读取）
const SMS_SECRET_ID = process.env.TENCENT_SMS_SECRET_ID || '';
const SMS_SECRET_KEY = process.env.TENCENT_SMS_SECRET_KEY || '';
const SMS_SDK_APP_ID = process.env.TENCENT_SMS_SDK_APP_ID || '';
const SMS_SIGN_NAME = process.env.TENCENT_SMS_SIGN_NAME || 'MeetMind';
const SMS_TEMPLATE_ID = process.env.TENCENT_SMS_TEMPLATE_ID || '';
const APP_NAME = process.env.APP_NAME || 'MeetMind';

// 腾讯云 API 地址
const SMS_HOST = 'sms.tencentcloudapi.com';
const SMS_SERVICE = 'sms';
const SMS_VERSION = '2021-01-11';
const SMS_ACTION = 'SendSms';
const SMS_REGION = 'ap-guangzhou';

interface SendSmsResult {
  success: boolean;
  error?: string;
  retryAfter?: number;
}

/**
 * 腾讯云 API 签名（TC3-HMAC-SHA256）
 */
function sign(secretKey: string, date: string, service: string, stringToSign: string): string {
  const secretDate = createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = createHmac('sha256', secretService).update('tc3_request').digest();
  return createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
}

/**
 * 生成腾讯云 API 请求头
 */
function generateHeaders(payload: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // CanonicalRequest
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const contentType = 'application/json; charset=utf-8';
  const hashedRequestPayload = createHash('sha256').update(payload).digest('hex');
  const canonicalHeaders = `content-type:${contentType}\nhost:${SMS_HOST}\nx-tc-action:${SMS_ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

  // StringToSign
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${SMS_SERVICE}/tc3_request`;
  const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  // Signature
  const signature = sign(SMS_SECRET_KEY, date, SMS_SERVICE, stringToSign);

  // Authorization
  const authorization = `${algorithm} Credential=${SMS_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': contentType,
    'Host': SMS_HOST,
    'X-TC-Action': SMS_ACTION,
    'X-TC-Version': SMS_VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': SMS_REGION,
    'Authorization': authorization,
  };
}

/**
 * 发送短信请求
 */
async function sendSmsRequest(phoneNumber: string, templateParams: string[]): Promise<{ success: boolean; error?: string }> {
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phoneNumber}`],
    SmsSdkAppId: SMS_SDK_APP_ID,
    SignName: SMS_SIGN_NAME,
    TemplateId: SMS_TEMPLATE_ID,
    TemplateParamSet: templateParams,
  });

  const headers = generateHeaders(payload);

  try {
    const response = await fetch(`https://${SMS_HOST}`, {
      method: 'POST',
      headers,
      body: payload,
    });

    const result = await response.json();

    if (result.Response?.Error) {
      console.error('[SmsService] 腾讯云API错误:', result.Response.Error);
      return { success: false, error: '短信发送失败' };
    }

    const sendStatus = result.Response?.SendStatusSet?.[0];
    if (sendStatus?.Code !== 'Ok') {
      console.error('[SmsService] 短信发送失败:', sendStatus);
      return { success: false, error: sendStatus?.Message || '短信发送失败' };
    }

    return { success: true };
  } catch (error) {
    console.error('[SmsService] 请求失败:', error);
    return { success: false, error: '网络错误，请稍后重试' };
  }
}

export const smsService = {
  /**
   * 检查短信服务是否可用
   */
  isConfigured(): boolean {
    return !!(SMS_SECRET_ID && SMS_SECRET_KEY && SMS_SDK_APP_ID && SMS_TEMPLATE_ID);
  },

  /**
   * 发送验证码短信
   */
  async sendVerificationCode(phone: string, purpose: CodePurpose): Promise<SendSmsResult> {
    // 验证手机号格式（中国大陆）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return { success: false, error: '手机号格式不正确' };
    }

    // 检查配置
    if (!this.isConfigured()) {
      console.error('[SmsService] 腾讯云短信未配置');
      return { success: false, error: '短信服务暂不可用' };
    }

    // 创建验证码
    const codeResult = await verificationCodeService.createCode(phone, 'sms', purpose);
    if (!codeResult.success) {
      return {
        success: false,
        error: codeResult.error,
        retryAfter: codeResult.retryAfter,
      };
    }

    const code = codeResult.code!;

    // 发送短信（模板参数：验证码, 有效期分钟数）
    const sendResult = await sendSmsRequest(phone, [code, '5']);

    if (!sendResult.success) {
      return { success: false, error: sendResult.error };
    }

    console.log(`[SmsService] 验证码已发送: ${phone} (${purpose})`);
    return { success: true };
  },

  /**
   * 验证短信验证码
   */
  async verifyCode(phone: string, code: string, purpose: CodePurpose) {
    return verificationCodeService.verifyCode(phone, code, 'sms', purpose);
  },
};
