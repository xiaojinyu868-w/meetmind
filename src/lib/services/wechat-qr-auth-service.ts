import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { AuthResponse } from '@/types/user';
import { COPY } from '@/lib/ui/copy';

export const WECHAT_QR_SCENE_PREFIX = 'mm_auth_';
export const WECHAT_QR_EXPIRES_IN_SECONDS = 5 * 60;

export type WechatQrAuthMode = 'login' | 'bind';
export type WechatQrChallengeStatus =
  | 'pending'
  | 'scanned'
  | 'processing'
  | 'consumed'
  | 'failed'
  | 'expired';

export interface WechatQrChallengeRecord {
  id: string;
  scene: string;
  mode: WechatQrAuthMode;
  browserTokenHash: string;
  targetUserId: string | null;
  status: WechatQrChallengeStatus;
  imageUrl: string;
  openId: string | null;
  resultUserId: string | null;
  error: string | null;
  expiresAt: Date;
  scannedAt: Date | null;
  consumedAt: Date | null;
}

export interface WechatQrChallengeRepository {
  create: (data: Omit<WechatQrChallengeRecord, 'id' | 'scannedAt' | 'consumedAt'>) => Promise<WechatQrChallengeRecord>;
  findById: (id: string) => Promise<WechatQrChallengeRecord | null>;
  findByScene: (scene: string) => Promise<WechatQrChallengeRecord | null>;
  findReusable: (input: {
    browserTokenHash: string;
    mode: WechatQrAuthMode;
    targetUserId: string | null;
    now: Date;
  }) => Promise<WechatQrChallengeRecord | null>;
  markScanned: (id: string, openId: string, scannedAt: Date) => Promise<boolean>;
  claimForProcessing: (id: string, now: Date) => Promise<boolean>;
  markConsumed: (id: string, resultUserId: string, consumedAt: Date) => Promise<boolean>;
  markFailed: (id: string, error: string) => Promise<boolean>;
  markExpired: (id: string) => Promise<boolean>;
  deleteStale: (before: Date) => Promise<number>;
}

interface CreateOfficialQrResult {
  imageUrl: string;
  expiresIn: number;
}

interface WechatQrAuthCoordinatorDependencies {
  repository: WechatQrChallengeRepository;
  createOfficialQr: (scene: string, expiresIn: number) => Promise<CreateOfficialQrResult>;
  loginWithOpenId: (openId: string) => Promise<AuthResponse>;
  createSessionForUserId: (userId: string) => Promise<AuthResponse>;
  bindOpenId: (userId: string, openId: string) => Promise<{ success: boolean; error?: string }>;
  createScene?: () => string;
  now?: () => Date;
}

interface WechatEventPayload {
  MsgType?: string;
  Event?: string;
  EventKey?: string;
}

export type WechatQrPollResult =
  | { status: 'pending' | 'scanned' | 'processing' | 'consumed' | 'expired' | 'not_found' }
  | { status: 'failed'; error: string }
  | { status: 'bound' }
  | { status: 'authenticated'; accessToken: string; refreshToken?: string; nickname?: string };

export function hashWechatQrBrowserToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractWechatQrAuthScene(payload: WechatEventPayload): string | null {
  if ((payload.MsgType || '').toLowerCase() !== 'event') return null;

  const event = (payload.Event || '').toLowerCase();
  if (event !== 'subscribe' && event !== 'scan') return null;

  const rawKey = (payload.EventKey || '').trim();
  const scene = event === 'subscribe' && rawKey.startsWith('qrscene_')
    ? rawKey.slice('qrscene_'.length)
    : rawKey;

  return scene.startsWith(WECHAT_QR_SCENE_PREFIX) ? scene : null;
}

export function createWechatQrAuthCoordinator(deps: WechatQrAuthCoordinatorDependencies) {
  const now = deps.now || (() => new Date());
  const createScene = deps.createScene || (() => `${WECHAT_QR_SCENE_PREFIX}${randomBytes(18).toString('base64url')}`);
  const creatingChallenges = new Map<string, Promise<{
    challengeId: string;
    imageUrl: string;
    expiresIn: number;
    expiresAt: string;
  }>>();
  const toAuthenticatedResult = (result: AuthResponse): WechatQrPollResult => {
    if (!result.success || !result.user || !result.accessToken) {
      return { status: 'failed', error: result.error || COPY.wechatQr.loginFailed };
    }
    return {
      status: 'authenticated',
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      nickname: result.user.nickname,
    };
  };

  return {
    async createChallenge(input: {
      mode: WechatQrAuthMode;
      browserToken: string;
      targetUserId?: string;
    }): Promise<{ challengeId: string; imageUrl: string; expiresIn: number; expiresAt: string }> {
      if (input.mode === 'bind' && !input.targetUserId) {
        throw new Error(COPY.wechatQr.bindRequiresLogin);
      }

      const browserTokenHash = hashWechatQrBrowserToken(input.browserToken);
      const targetUserId = input.targetUserId || null;
      const creationKey = `${browserTokenHash}:${input.mode}:${targetUserId || '-'}`;
      const inFlight = creatingChallenges.get(creationKey);
      if (inFlight) return inFlight;

      const creation = (async () => {
        const createdAt = now();
        await deps.repository.deleteStale(new Date(createdAt.getTime() - 24 * 60 * 60 * 1000));
        const reusable = await deps.repository.findReusable({
          browserTokenHash,
          mode: input.mode,
          targetUserId,
          now: createdAt,
        });
        if (reusable) {
          return {
            challengeId: reusable.id,
            imageUrl: reusable.imageUrl,
            expiresIn: Math.max(1, Math.ceil((reusable.expiresAt.getTime() - createdAt.getTime()) / 1000)),
            expiresAt: reusable.expiresAt.toISOString(),
          };
        }

        const scene = createScene();
        const officialQr = await deps.createOfficialQr(scene, WECHAT_QR_EXPIRES_IN_SECONDS);
        const expiresAt = new Date(createdAt.getTime() + officialQr.expiresIn * 1000);
        const record = await deps.repository.create({
          scene,
          mode: input.mode,
          browserTokenHash,
          targetUserId,
          status: 'pending',
          imageUrl: officialQr.imageUrl,
          openId: null,
          resultUserId: null,
          error: null,
          expiresAt,
        });
        return {
          challengeId: record.id,
          imageUrl: record.imageUrl,
          expiresIn: officialQr.expiresIn,
          expiresAt: expiresAt.toISOString(),
        };
      })();
      creatingChallenges.set(creationKey, creation);
      try {
        return await creation;
      } finally {
        if (creatingChallenges.get(creationKey) === creation) creatingChallenges.delete(creationKey);
      }
    },

    async markScanned(input: {
      scene: string;
      openId: string;
    }): Promise<{ accepted: boolean; mode?: WechatQrAuthMode }> {
      const record = await deps.repository.findByScene(input.scene);
      if (!record || record.expiresAt.getTime() <= now().getTime()) {
        if (record) await deps.repository.markExpired(record.id);
        return { accepted: false };
      }

      if (
        record.openId === input.openId
        && (record.status === 'scanned' || record.status === 'processing' || record.status === 'consumed')
      ) {
        return { accepted: true, mode: record.mode };
      }
      if (record.status !== 'pending') return { accepted: false };

      const accepted = await deps.repository.markScanned(record.id, input.openId, now());
      return accepted ? { accepted: true, mode: record.mode } : { accepted: false };
    },

    async poll(input: { challengeId: string; browserToken: string }): Promise<WechatQrPollResult> {
      const record = await deps.repository.findById(input.challengeId);
      if (!record) return { status: 'not_found' };

      const requestHash = hashWechatQrBrowserToken(input.browserToken);
      if (!hashesMatch(record.browserTokenHash, requestHash)) return { status: 'not_found' };

      const polledAt = now();
      if (record.status === 'expired') return { status: 'expired' };
      if (record.status === 'failed') return { status: 'failed', error: record.error || COPY.wechatQr.failed };
      if (record.status === 'consumed') {
        const recoveryExpiresAt = (record.consumedAt?.getTime() || record.expiresAt.getTime()) + 10 * 60 * 1000;
        if (polledAt.getTime() > recoveryExpiresAt) return { status: 'consumed' };
        if (record.mode === 'bind') return { status: 'bound' };
        if (!record.resultUserId) return { status: 'consumed' };
        return toAuthenticatedResult(await deps.createSessionForUserId(record.resultUserId));
      }

      if (record.expiresAt.getTime() <= polledAt.getTime()) {
        await deps.repository.markExpired(record.id);
        return { status: 'expired' };
      }
      if (record.status === 'pending') return { status: 'pending' };
      if (record.status === 'processing') return { status: 'processing' };
      if (!record.openId) return { status: 'failed', error: COPY.wechatQr.failed };

      const claimed = await deps.repository.claimForProcessing(record.id, polledAt);
      if (!claimed) return { status: 'processing' };

      try {
        if (record.mode === 'bind') {
          if (!record.targetUserId) {
            await deps.repository.markFailed(record.id, COPY.wechatQr.bindRequiresLogin);
            return { status: 'failed', error: COPY.wechatQr.bindRequiresLogin };
          }

          const bindResult = await deps.bindOpenId(record.targetUserId, record.openId);
          if (!bindResult.success) {
            const error = bindResult.error || COPY.wechatQr.bindFailed;
            await deps.repository.markFailed(record.id, error);
            return { status: 'failed', error };
          }

          const completed = await deps.repository.markConsumed(record.id, record.targetUserId, now());
          return completed ? { status: 'bound' } : { status: 'processing' };
        }

        const loginResult = await deps.loginWithOpenId(record.openId);
        const authenticated = toAuthenticatedResult(loginResult);
        if (authenticated.status !== 'authenticated' || !loginResult.user) {
          const error = authenticated.status === 'failed' ? authenticated.error : COPY.wechatQr.loginFailed;
          await deps.repository.markFailed(record.id, error);
          return { status: 'failed', error };
        }

        const completed = await deps.repository.markConsumed(record.id, loginResult.user.id, now());
        return completed ? authenticated : { status: 'processing' };
      } catch {
        await deps.repository.markFailed(record.id, COPY.wechatQr.failed);
        return { status: 'failed', error: COPY.wechatQr.failed };
      }
    },
  };
}

export async function requestWechatOfficialQr(input: {
  accessToken: string;
  scene: string;
  expiresIn: number;
  fetchFn?: typeof fetch;
}): Promise<CreateOfficialQrResult> {
  const fetchFn = input.fetchFn || fetch;
  const response = await fetchFn(
    `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(input.accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expire_seconds: input.expiresIn,
        action_name: 'QR_STR_SCENE',
        action_info: { scene: { scene_str: input.scene } },
      }),
    },
  );
  const payload = await response.json() as {
    ticket?: string;
    expire_seconds?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || !payload.ticket) {
    throw new Error(payload.errmsg || `微信二维码创建失败（${payload.errcode || response.status}）`);
  }

  return {
    imageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(payload.ticket)}`,
    expiresIn: payload.expire_seconds || input.expiresIn,
  };
}
