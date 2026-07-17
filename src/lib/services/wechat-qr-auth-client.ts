import type { WechatQrAuthMode } from './wechat-qr-auth-service';
import { COPY } from '@/lib/ui/copy';

export interface WechatQrChallengeResponse {
  success: true;
  challengeId: string;
  imageUrl: string;
  expiresAt: string;
  expiresIn: number;
}

export interface WechatQrPollResponse {
  success: boolean;
  status:
    | 'pending'
    | 'scanned'
    | 'processing'
    | 'authenticated'
    | 'bound'
    | 'consumed'
    | 'expired'
    | 'failed'
    | 'not_found';
  accessToken?: string;
  nickname?: string;
  error?: string;
}

export async function createWechatQrChallenge(input: {
  mode: WechatQrAuthMode;
  accessToken?: string | null;
  clientNonce?: string;
  fetchFn?: typeof fetch;
}): Promise<WechatQrChallengeResponse> {
  if (input.mode === 'bind' && !input.accessToken) {
    throw new Error(COPY.wechatQr.bindRequiresLogin);
  }

  const fetchFn = input.fetchFn || fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.mode === 'bind' && input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const response = await fetchFn('/api/auth/wechat/qr', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ mode: input.mode, clientNonce: input.clientNonce }),
  });
  const payload = await response.json() as Partial<WechatQrChallengeResponse> & { error?: string };

  if (!response.ok || !payload.success || !payload.challengeId || !payload.imageUrl) {
    throw new Error(payload.error || COPY.wechatQr.createFailed);
  }

  return payload as WechatQrChallengeResponse;
}

export async function pollWechatQrChallenge(input: {
  challengeId: string;
  fetchFn?: typeof fetch;
}): Promise<WechatQrPollResponse> {
  const fetchFn = input.fetchFn || fetch;
  const response = await fetchFn(
    `/api/auth/wechat/qr?id=${encodeURIComponent(input.challengeId)}`,
    { credentials: 'include', cache: 'no-store' },
  );
  return response.json() as Promise<WechatQrPollResponse>;
}
