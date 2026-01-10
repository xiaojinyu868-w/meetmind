/**
 * 微信 OAuth 2.0 登录服务
 * 
 * 实现微信网页授权登录流程：
 * 1. 生成授权 URL，引导用户跳转微信授权页
 * 2. 用户同意授权后，微信回调携带 code
 * 3. 使用 code 换取 access_token
 * 4. 使用 access_token 获取用户信息
 * 5. 创建或绑定本地用户账户
 */

import { randomBytes } from 'crypto';
import type {
  WechatUserInfo,
  WechatTokenResponse,
  WechatAuthState,
  User,
  AuthResponse,
} from '@/types/user';
import { authService } from './auth-service';

// ==================== 配置 ====================

const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const WECHAT_REDIRECT_URI = process.env.WECHAT_REDIRECT_URI || 'http://localhost:3001/api/auth/wechat/callback';

// 微信 API 端点
const WECHAT_AUTH_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECHAT_QRCONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_REFRESH_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/refresh_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';
const WECHAT_CHECK_TOKEN_URL = 'https://api.weixin.qq.com/sns/auth';

// 状态存储（生产环境应使用 Redis）
const authStates = new Map<string, WechatAuthState>();

// 状态过期时间（5分钟）
const STATE_EXPIRES_IN = 5 * 60 * 1000;

// ==================== 工具函数 ====================

/**
 * 生成随机状态码
 */
function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 清理过期状态
 */
function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [state, data] of authStates.entries()) {
    if (data.expiresAt < now) {
      authStates.delete(state);
    }
  }
}

// ==================== 微信认证服务 ====================

export const wechatAuthService = {
  /**
   * 检查微信配置是否完整
   */
  isConfigured(): boolean {
    return !!(WECHAT_APP_ID && WECHAT_APP_SECRET);
  },

  /**
   * 生成微信授权 URL（网页授权 - 适用于微信内置浏览器）
   * 
   * @param redirectUri 授权后回调地址
   * @param scope 授权范围：snsapi_base（静默）或 snsapi_userinfo（需用户确认）
   */
  getAuthUrl(redirectUri?: string, scope: 'snsapi_base' | 'snsapi_userinfo' = 'snsapi_userinfo'): string {
    cleanExpiredStates();
    
    const state = generateState();
    const finalRedirectUri = redirectUri || WECHAT_REDIRECT_URI;
    
    // 存储状态
    authStates.set(state, {
      state,
      redirectUri: finalRedirectUri,
      createdAt: Date.now(),
      expiresAt: Date.now() + STATE_EXPIRES_IN,
    });
    
    const params = new URLSearchParams({
      appid: WECHAT_APP_ID,
      redirect_uri: finalRedirectUri,
      response_type: 'code',
      scope,
      state,
    });
    
    return `${WECHAT_AUTH_URL}?${params.toString()}#wechat_redirect`;
  },

  /**
   * 生成微信扫码登录 URL（适用于 PC 网页）
   * 
   * @param redirectUri 授权后回调地址
   */
  getQRConnectUrl(redirectUri?: string): string {
    cleanExpiredStates();
    
    const state = generateState();
    const finalRedirectUri = redirectUri || WECHAT_REDIRECT_URI;
    
    // 存储状态
    authStates.set(state, {
      state,
      redirectUri: finalRedirectUri,
      createdAt: Date.now(),
      expiresAt: Date.now() + STATE_EXPIRES_IN,
    });
    
    const params = new URLSearchParams({
      appid: WECHAT_APP_ID,
      redirect_uri: finalRedirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    });
    
    return `${WECHAT_QRCONNECT_URL}?${params.toString()}#wechat_redirect`;
  },

  /**
   * 验证状态码
   */
  validateState(state: string): boolean {
    cleanExpiredStates();
    
    const stored = authStates.get(state);
    if (!stored) return false;
    
    // 使用后删除（一次性）
    authStates.delete(state);
    return true;
  },

  /**
   * 使用授权码获取访问令牌
   */
  async getAccessToken(code: string): Promise<WechatTokenResponse | null> {
    if (!this.isConfigured()) {
      console.error('微信配置不完整');
      return null;
    }
    
    try {
      const params = new URLSearchParams({
        appid: WECHAT_APP_ID,
        secret: WECHAT_APP_SECRET,
        code,
        grant_type: 'authorization_code',
      });
      
      const response = await fetch(`${WECHAT_TOKEN_URL}?${params.toString()}`);
      const data = await response.json();
      
      if (data.errcode) {
        console.error('获取微信令牌失败:', data);
        return null;
      }
      
      return data as WechatTokenResponse;
    } catch (error) {
      console.error('获取微信令牌异常:', error);
      return null;
    }
  },

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(refreshToken: string): Promise<WechatTokenResponse | null> {
    try {
      const params = new URLSearchParams({
        appid: WECHAT_APP_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      
      const response = await fetch(`${WECHAT_REFRESH_TOKEN_URL}?${params.toString()}`);
      const data = await response.json();
      
      if (data.errcode) {
        console.error('刷新微信令牌失败:', data);
        return null;
      }
      
      return data as WechatTokenResponse;
    } catch (error) {
      console.error('刷新微信令牌异常:', error);
      return null;
    }
  },

  /**
   * 验证访问令牌是否有效
   */
  async checkAccessToken(accessToken: string, openid: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        access_token: accessToken,
        openid,
      });
      
      const response = await fetch(`${WECHAT_CHECK_TOKEN_URL}?${params.toString()}`);
      const data = await response.json();
      
      return data.errcode === 0;
    } catch {
      return false;
    }
  },

  /**
   * 获取微信用户信息
   */
  async getUserInfo(accessToken: string, openid: string): Promise<WechatUserInfo | null> {
    try {
      const params = new URLSearchParams({
        access_token: accessToken,
        openid,
        lang: 'zh_CN',
      });
      
      const response = await fetch(`${WECHAT_USERINFO_URL}?${params.toString()}`);
      const data = await response.json();
      
      if (data.errcode) {
        console.error('获取微信用户信息失败:', data);
        return null;
      }
      
      return data as WechatUserInfo;
    } catch (error) {
      console.error('获取微信用户信息异常:', error);
      return null;
    }
  },

  /**
   * 微信登录完整流程
   * 
   * @param code 微信授权码
   * @param state 状态码
   */
  async login(code: string, state: string): Promise<AuthResponse> {
    // 验证状态
    if (!this.validateState(state)) {
      return { success: false, error: '无效的授权状态' };
    }
    
    // 获取访问令牌
    const tokenResponse = await this.getAccessToken(code);
    if (!tokenResponse) {
      return { success: false, error: '获取微信授权失败' };
    }
    
    // 获取用户信息
    const wechatUser = await this.getUserInfo(tokenResponse.access_token, tokenResponse.openid);
    if (!wechatUser) {
      return { success: false, error: '获取微信用户信息失败' };
    }
    
    // 查找是否已绑定用户
    const existingUser = await authService.findUserByProvider('wechat', wechatUser.openid);
    
    if (existingUser) {
      // 已绑定用户，直接登录
      // 更新微信令牌
      await authService.linkAuthProvider(existingUser.id, 'wechat', {
        providerId: wechatUser.openid,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
        metadata: {
          unionid: wechatUser.unionid,
          nickname: wechatUser.nickname,
          headimgurl: wechatUser.headimgurl,
        },
      });
      
      // 生成本地令牌
      return authService.login({
        username: existingUser.username,
        password: '', // 跳过密码验证
      });
    }
    
    // 新用户，自动注册
    const username = `wx_${wechatUser.openid.slice(-8)}`;
    const registerResult = await authService.register({
      username,
      password: randomBytes(16).toString('hex'), // 随机密码
      nickname: wechatUser.nickname || '微信用户',
      role: 'student',
    });
    
    if (!registerResult.success || !registerResult.user) {
      return { success: false, error: registerResult.error || '创建用户失败' };
    }
    
    // 绑定微信
    await authService.linkAuthProvider(registerResult.user.id, 'wechat', {
      providerId: wechatUser.openid,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
      metadata: {
        unionid: wechatUser.unionid,
        nickname: wechatUser.nickname,
        headimgurl: wechatUser.headimgurl,
      },
    });
    
    // 更新头像
    if (wechatUser.headimgurl) {
      await authService.updateProfile(registerResult.user.id, {
        avatar: wechatUser.headimgurl,
        nickname: wechatUser.nickname,
      });
    }
    
    return registerResult;
  },

  /**
   * 绑定微信到现有账户
   */
  async bindToUser(userId: string, code: string, state: string): Promise<{ success: boolean; error?: string }> {
    // 验证状态
    if (!this.validateState(state)) {
      return { success: false, error: '无效的授权状态' };
    }
    
    // 获取访问令牌
    const tokenResponse = await this.getAccessToken(code);
    if (!tokenResponse) {
      return { success: false, error: '获取微信授权失败' };
    }
    
    // 获取用户信息
    const wechatUser = await this.getUserInfo(tokenResponse.access_token, tokenResponse.openid);
    if (!wechatUser) {
      return { success: false, error: '获取微信用户信息失败' };
    }
    
    // 检查是否已被其他账户绑定
    const existingUser = await authService.findUserByProvider('wechat', wechatUser.openid);
    if (existingUser && existingUser.id !== userId) {
      return { success: false, error: '该微信已绑定其他账户' };
    }
    
    // 绑定微信
    const success = await authService.linkAuthProvider(userId, 'wechat', {
      providerId: wechatUser.openid,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
      metadata: {
        unionid: wechatUser.unionid,
        nickname: wechatUser.nickname,
        headimgurl: wechatUser.headimgurl,
      },
    });
    
    if (!success) {
      return { success: false, error: '绑定失败' };
    }
    
    return { success: true };
  },
};

export default wechatAuthService;
