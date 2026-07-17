import { randomBytes } from 'crypto';
import type { AuthResponse } from '@/types/user';
import { authService } from './auth-service';
import { wechatIdentityClaimService, type WechatIdentityClaimInput, type WechatIdentityClaimResult } from './wechat-identity-claim-service';
import workspaceAccountService from './workspace-account-service';
import workspaceContextService from './workspace-context-service';
import workspaceService from './workspace-service';
import { COPY } from '@/lib/ui/copy';

export interface WechatIdentityInput {
  openId: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

interface WechatIdentityDependencies {
  claimIdentity: (input: WechatIdentityClaimInput) => Promise<WechatIdentityClaimResult>;
  createSessionForUserId: (userId: string) => Promise<AuthResponse>;
  ensureAccountDataOwnership: (userId: string) => Promise<unknown>;
  resolveWechatWorkspace: (openId: string) => Promise<unknown>;
  syncWechatInboxArtifactsForOpenId: (openId: string) => Promise<unknown>;
  randomHex: () => string;
}

export function createWechatIdentityService(deps: WechatIdentityDependencies) {
  const claim = async (
    input: WechatIdentityInput,
    targetUserId?: string,
  ): Promise<WechatIdentityClaimResult> => deps.claimIdentity({
    openId: input.openId,
    targetUserId,
    username: `wx_${input.openId.slice(-8)}_${deps.randomHex().slice(0, 6)}`,
    nickname: input.nickname || '微信用户',
    avatar: input.headimgurl,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
  });

  const syncIdentity = async (userId: string, openId: string): Promise<void> => {
    await deps.ensureAccountDataOwnership(userId);
    await deps.resolveWechatWorkspace(openId);
    await deps.syncWechatInboxArtifactsForOpenId(openId);
  };

  return {
    async login(input: WechatIdentityInput): Promise<AuthResponse> {
      const claimed = await claim(input);
      if (claimed.status === 'owned-by-other') {
        return { success: false, error: COPY.wechatQr.identityConflict };
      }

      await syncIdentity(claimed.userId, input.openId);
      return deps.createSessionForUserId(claimed.userId);
    },

    async bind(input: WechatIdentityInput & { userId: string }): Promise<{ success: boolean; error?: string }> {
      const claimed = await claim(input, input.userId);
      if (claimed.status === 'owned-by-other' || claimed.userId !== input.userId) {
        return { success: false, error: COPY.wechatQr.identityConflict };
      }

      await syncIdentity(input.userId, input.openId);
      return { success: true };
    },
  };
}

export const wechatIdentityService = createWechatIdentityService({
  claimIdentity: wechatIdentityClaimService.claim.bind(wechatIdentityClaimService),
  createSessionForUserId: authService.createSessionForUserId.bind(authService),
  ensureAccountDataOwnership: workspaceAccountService.ensureAccountDataOwnership.bind(workspaceAccountService),
  resolveWechatWorkspace: workspaceService.resolveWechatWorkspace.bind(workspaceService),
  syncWechatInboxArtifactsForOpenId: workspaceContextService.syncWechatInboxArtifactsForOpenId.bind(workspaceContextService),
  randomHex: () => randomBytes(16).toString('hex'),
});

export default wechatIdentityService;
