import { authService } from './auth-service';
import { getWechatAccessToken } from './wechat-media-service';
import { wechatIdentityService } from './wechat-identity-service';
import { prismaWechatQrChallengeRepository } from './wechat-qr-auth-repository';
import {
  createWechatQrAuthCoordinator,
  requestWechatOfficialQr,
} from './wechat-qr-auth-service';

export function isWechatQrAuthConfigured(): boolean {
  return Boolean(
    process.env.WECHAT_APP_ID?.trim()
    && process.env.WECHAT_APP_SECRET?.trim()
    && process.env.WECHAT_MP_TOKEN?.trim(),
  );
}

export const wechatQrAuthRuntime = createWechatQrAuthCoordinator({
  repository: prismaWechatQrChallengeRepository,
  async createOfficialQr(scene, expiresIn) {
    const accessToken = await getWechatAccessToken();
    if (!accessToken) throw new Error('公众号访问令牌不可用');
    return requestWechatOfficialQr({ accessToken, scene, expiresIn });
  },
  loginWithOpenId: (openId) => wechatIdentityService.login({ openId }),
  createSessionForUserId: (userId) => authService.createSessionForUserId(userId),
  bindOpenId: (userId, openId) => wechatIdentityService.bind({ userId, openId }),
});

export default wechatQrAuthRuntime;
