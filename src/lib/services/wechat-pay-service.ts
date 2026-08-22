/**
 * wechat-pay-service — 微信支付 APIv3 封装（积分充值 Native 扫码）
 *
 * 职责：
 * - isWechatPayConfigured：6 个 WECHAT_PAY_* env 是否齐全（未配置时充值入口 503）
 * - createNativeOrder：POST /v3/pay/transactions/native，APIv3 签名（商户私钥 RSA-SHA256）
 * - verifyNotifySignature：回调验签（平台证书公钥验 Wechatpay-Signature）
 * - decryptNotifyResource：回调资源体 AES-256-GCM 解密（APIv3 key）
 *
 * 平台证书说明（简化部署）：
 *   不实现平台证书自动下载/轮换，证书 PEM 由 env WECHAT_PAY_PLATFORM_CERT_PEM 注入
 *   （微信支付商户平台 → API 安全 → 平台证书手动下载）。证书到期轮换时更新 env 即可。
 *   env 里的多行 PEM 允许写成 \n 字面量，读取时统一还原。
 *
 * env 依赖：
 *   WECHAT_PAY_MCHID / WECHAT_PAY_APPID（公众号 appid，下单必带）/ WECHAT_PAY_APIV3_KEY /
 *   WECHAT_PAY_SERIAL_NO / WECHAT_PAY_PRIVATE_KEY / WECHAT_PAY_PLATFORM_CERT_PEM
 */

import crypto from 'node:crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('wechat-pay');

const MCH_API_BASE = 'https://api.mch.weixin.qq.com';
const NATIVE_ORDER_PATH = '/v3/pay/transactions/native';
const REQUEST_TIMEOUT_MS = 10_000;

// ==================== env ====================

function envOrEmpty(key: string): string {
  return (process.env[key] ?? '').trim();
}

/** env 中的 PEM 允许 \n 字面量（.env 单行书写），统一还原为真实换行 */
function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n');
}

export function isWechatPayConfigured(): boolean {
  return [
    'WECHAT_PAY_MCHID',
    'WECHAT_PAY_APPID',
    'WECHAT_PAY_APIV3_KEY',
    'WECHAT_PAY_SERIAL_NO',
    'WECHAT_PAY_PRIVATE_KEY',
    'WECHAT_PAY_PLATFORM_CERT_PEM',
  ].every((key) => envOrEmpty(key).length > 0);
}

// ==================== 签名 ====================

/**
 * 构造 APIv3 请求签名串（五步拼接，标准做法）：
 * `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
 * 单独导出便于单测。
 */
export function buildRequestSignMessage(
  method: string,
  urlPath: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
}

/** 构造回调验签串：`${timestamp}\n${nonce}\n${rawBody}\n` */
export function buildNotifySignMessage(timestamp: string, nonce: string, rawBody: string): string {
  return `${timestamp}\n${nonce}\n${rawBody}\n`;
}

function signWithMerchantKey(message: string): string {
  const privateKey = normalizePem(envOrEmpty('WECHAT_PAY_PRIVATE_KEY'));
  return crypto.createSign('RSA-SHA256').update(message, 'utf8').sign(privateKey, 'base64');
}

function buildAuthorization(method: string, urlPath: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = signWithMerchantKey(buildRequestSignMessage(method, urlPath, timestamp, nonce, body));
  const mchid = envOrEmpty('WECHAT_PAY_MCHID');
  const serialNo = envOrEmpty('WECHAT_PAY_SERIAL_NO');
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",` +
    `signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`
  );
}

// ==================== Native 下单 ====================

export interface CreateNativeOrderInput {
  outTradeNo: string;
  amountFen: number;
  description: string;
  notifyUrl: string;
}

interface NativeOrderResponse {
  code_url?: string;
  code?: string;
  message?: string;
}

/**
 * Native 下单，返回 code_url（前端渲染二维码）。
 * 非 2xx 或缺 code_url 一律抛带 status 的 Error（调用方归一为 PayUnavailableError）。
 */
export async function createNativeOrder(input: CreateNativeOrderInput): Promise<{ codeUrl: string }> {
  const body = JSON.stringify({
    appid: envOrEmpty('WECHAT_PAY_APPID'),
    mchid: envOrEmpty('WECHAT_PAY_MCHID'),
    description: input.description,
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    amount: { total: input.amountFen, currency: 'CNY' },
  });

  const response = await fetch(`${MCH_API_BASE}${NATIVE_ORDER_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: buildAuthorization('POST', NATIVE_ORDER_PATH, body),
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => ({}))) as NativeOrderResponse;
  if (!response.ok || !data.code_url) {
    log.error('native order rejected', {
      outTradeNo: input.outTradeNo,
      httpStatus: response.status,
      wxCode: data.code,
      wxMessage: data.message,
    });
    const error = new Error(`wechat native order failed: ${data.code ?? response.status} ${data.message ?? ''}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return { codeUrl: data.code_url };
}

// ==================== 主动查单（回调之外的第二通道） ====================

const QUERY_ORDER_PATH = '/v3/pay/transactions/out-trade-no';

export interface WechatOrderQuery {
  tradeState: string;
  transactionId: string;
  amountFen: number;
  mchid: string;
  successTime?: string;
}

/**
 * 按商户订单号主动查询微信支付订单。404（微信侧无此单）返回 null；
 * 其他非 2xx 抛错（调用方 best-effort 捕获，不影响主流程）。
 * 用途：回调丢失/延迟时由轮询路径主动兑账——回调与查单互为冗余。
 */
export async function queryNativeOrder(outTradeNo: string): Promise<WechatOrderQuery | null> {
  const mchid = envOrEmpty('WECHAT_PAY_MCHID');
  const urlPath = `${QUERY_ORDER_PATH}/${encodeURIComponent(outTradeNo)}?mchid=${mchid}`;
  const response = await fetch(`${MCH_API_BASE}${urlPath}`, {
    headers: {
      Accept: 'application/json',
      Authorization: buildAuthorization('GET', urlPath, ''),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  const data = (await response.json().catch(() => ({}))) as {
    trade_state?: string;
    transaction_id?: string;
    mchid?: string;
    success_time?: string;
    amount?: { total?: number };
    code?: string;
    message?: string;
  };
  if (!response.ok || !data.trade_state) {
    log.error('order query rejected', {
      outTradeNo,
      httpStatus: response.status,
      wxCode: data.code,
      wxMessage: data.message,
    });
    throw new Error(`wechat order query failed: ${data.code ?? response.status} ${data.message ?? ''}`);
  }
  return {
    tradeState: data.trade_state,
    transactionId: data.transaction_id ?? '',
    amountFen: data.amount?.total ?? -1,
    mchid: data.mchid ?? '',
    successTime: data.success_time,
  };
}

// ==================== 回调验签 ====================

/**
 * 验签支付回调（平台证书公钥验 RSA-SHA256）。
 * headers 取 Wechatpay-Signature / Wechatpay-Timestamp / Wechatpay-Nonce；
 * 平台证书序列号（Wechatpay-Serial）只记日志，不强制比对（证书轮换期会不一致）。
 */
export function verifyNotifySignature(headers: Headers, rawBody: string): boolean {
  const signature = headers.get('wechatpay-signature');
  const timestamp = headers.get('wechatpay-timestamp');
  const nonce = headers.get('wechatpay-nonce');
  if (!signature || !timestamp || !nonce) return false;

  const certPem = normalizePem(envOrEmpty('WECHAT_PAY_PLATFORM_CERT_PEM'));
  if (!certPem) return false;

  try {
    const message = buildNotifySignMessage(timestamp, nonce, rawBody);
    // createPublicKey 可直接从证书 PEM 提取公钥
    const publicKey = crypto.createPublicKey(certPem);
    return crypto
      .createVerify('RSA-SHA256')
      .update(message, 'utf8')
      .verify(publicKey, signature, 'base64');
  } catch (error) {
    log.error('notify signature verify error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ==================== 回调解密 ====================

export interface WechatNotifyResource {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}

/**
 * AES-256-GCM 解密回调 resource：
 * 密文 base64 解码后末 16 字节是 authTag；key 是 APIv3 key（32 字节）。
 * 返回解析后的 JSON（交易对象含 out_trade_no / transaction_id / amount.total 等）。
 */
export function decryptNotifyResource(resource: WechatNotifyResource): unknown {
  const apiv3Key = envOrEmpty('WECHAT_PAY_APIV3_KEY');
  const data = Buffer.from(resource.ciphertext, 'base64');
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiv3Key, 'utf8'), resource.nonce);
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  }
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}
