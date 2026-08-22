/**
 * wechat-pay-service 单测 —— 纯函数与加解密回路
 *
 * 覆盖：
 * - 签名串构造（请求五步拼接 / 回调三步拼接，微信支付 APIv3 标准格式）
 * - verifyNotifySignature：用临时 RSA 密钥对做签名→验签回路（公钥 PEM 代替平台证书，
 *   createPublicKey 对两者都适用）；篡改报文验签失败
 * - decryptNotifyResource：AES-256-GCM 加密→解密回路（associated_data 不一致解密失败）
 *
 * 不触碰网络（createNativeOrder 不在此测试），env 在测试内临时注入。
 */

import crypto from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildNotifySignMessage,
  buildRequestSignMessage,
  decryptNotifyResource,
  verifyNotifySignature,
} from '@/lib/services/wechat-pay-service';

const SAVED_ENV: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  if (!(key in SAVED_ENV)) SAVED_ENV[key] = process.env[key];
  process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete SAVED_ENV[key];
  }
});

describe('签名串构造', () => {
  it('请求签名串：method\\nurl\\ntimestamp\\nnonce\\nbody\\n', () => {
    const message = buildRequestSignMessage('POST', '/v3/pay/transactions/native', '1700000000', 'abc', '{"a":1}');
    expect(message).toBe('POST\n/v3/pay/transactions/native\n1700000000\nabc\n{"a":1}\n');
  });

  it('回调验签串：timestamp\\nnonce\\nbody\\n', () => {
    expect(buildNotifySignMessage('1700000000', 'nonce', '{"id":"1"}')).toBe('1700000000\nnonce\n{"id":"1"}\n');
  });
});

describe('verifyNotifySignature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  function headersOf(fields: Record<string, string>): Headers {
    return new Headers(fields);
  }

  beforeEach(() => {
    // 公钥 PEM 代替平台证书（createPublicKey 对证书/公钥 PEM 都接受）
    setEnv('WECHAT_PAY_PLATFORM_CERT_PEM', publicKeyPem);
  });

  function signBody(rawBody: string): Record<string, string> {
    const timestamp = '1700000000';
    const nonce = 'testnonce';
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(buildNotifySignMessage(timestamp, nonce, rawBody), 'utf8')
      .sign(privateKey, 'base64');
    return {
      'wechatpay-signature': signature,
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
    };
  }

  it('合法签名验过', () => {
    const rawBody = '{"id":"event-1","resource":{}}';
    expect(verifyNotifySignature(headersOf(signBody(rawBody)), rawBody)).toBe(true);
  });

  it('篡改报文 / 缺头验签失败', () => {
    const rawBody = '{"id":"event-1"}';
    const headers = signBody(rawBody);
    expect(verifyNotifySignature(headersOf(headers), '{"id":"event-2"}')).toBe(false);
    expect(verifyNotifySignature(headersOf({}), rawBody)).toBe(false);
  });

  it('env 里的 \\n 字面量 PEM 也能验（normalizePem 还原）', () => {
    setEnv('WECHAT_PAY_PLATFORM_CERT_PEM', publicKeyPem.replace(/\n/g, '\\n'));
    const rawBody = '{"id":"event-1"}';
    expect(verifyNotifySignature(headersOf(signBody(rawBody)), rawBody)).toBe(true);
  });
});

describe('decryptNotifyResource', () => {
  const APIV3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节

  function encrypt(plaintext: string, associatedData: string) {
    const nonce = crypto.randomBytes(12).toString('hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(APIV3_KEY, 'utf8'), nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
    return { ciphertext, nonce, associated_data: associatedData };
  }

  beforeEach(() => {
    setEnv('WECHAT_PAY_APIV3_KEY', APIV3_KEY);
  });

  it('加密→解密回路：还原 JSON 交易对象', () => {
    const payload = JSON.stringify({ out_trade_no: 'R123', amount: { total: 1800 } });
    const resource = encrypt(payload, 'transaction');
    expect(decryptNotifyResource(resource)).toEqual({ out_trade_no: 'R123', amount: { total: 1800 } });
  });

  it('associated_data 不一致解密失败（GCM 完整性校验）', () => {
    const resource = encrypt('{"a":1}', 'transaction');
    resource.associated_data = 'tampered';
    expect(() => decryptNotifyResource(resource)).toThrow();
  });
});
