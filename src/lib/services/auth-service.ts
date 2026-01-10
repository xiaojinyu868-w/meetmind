/**
 * 用户认证服务
 * 
 * 提供用户注册、登录、会话管理、权限验证等功能
 * 使用 JWT 进行无状态认证，支持刷新令牌机制
 */

import { createHash, randomBytes, createHmac } from 'crypto';
import type {
  User,
  UserWithAuth,
  UserRole,
  UserStatus,
  AuthProvider,
  AuthProviderLink,
  UserSession,
  JWTPayload,
  RefreshTokenPayload,
  Permission,
  ROLE_PERMISSIONS,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  UserProfile,
} from '@/types/user';

// ==================== 配置 ====================

const JWT_SECRET = process.env.JWT_SECRET || 'meetmind-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = 60 * 60 * 2; // 2小时
const REFRESH_TOKEN_EXPIRES_IN = 60 * 60 * 24 * 7; // 7天
const SALT_ROUNDS = 16;

// ==================== 内存存储（生产环境应使用数据库） ====================

const users = new Map<string, UserWithAuth>();
const sessions = new Map<string, UserSession>();
const refreshTokens = new Map<string, { userId: string; expiresAt: number }>();

// 登录失败限流记录
const loginAttempts = new Map<string, { count: number; firstAttempt: number; lockedUntil?: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION = 15 * 60 * 1000; // 15分钟锁定
const ATTEMPT_WINDOW = 10 * 60 * 1000; // 10分钟窗口期

// CSRF Token 存储
const csrfTokens = new Map<string, { userId?: string; createdAt: number }>();
const CSRF_TOKEN_EXPIRES = 60 * 60 * 1000; // 1小时过期

// 初始化管理员账户
const adminId = 'admin-001';
users.set(adminId, {
  id: adminId,
  username: 'admin',
  nickname: '管理员',
  role: 'admin',
  status: 'active',
  passwordHash: hashPassword('admin123', 'admin-salt').hash,
  salt: 'admin-salt',
  authProviders: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// ==================== 密码处理 ====================

/**
 * 生成密码哈希
 */
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || randomBytes(SALT_ROUNDS).toString('hex');
  const hash = createHmac('sha256', useSalt)
    .update(password)
    .digest('hex');
  return { hash, salt: useSalt };
}

/**
 * 验证密码
 */
function verifyPassword(password: string, hash: string, salt: string): boolean {
  const { hash: computedHash } = hashPassword(password, salt);
  return computedHash === hash;
}

/**
 * 验证密码强度
 * 要求：至少8个字符，包含大写字母、小写字母、数字
 */
function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: '密码至少8个字符' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: '密码必须包含小写字母' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码必须包含大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码必须包含数字' };
  }
  return { valid: true };
}

/**
 * 检查登录限流
 */
function checkLoginRateLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(identifier);
  
  if (!record) {
    return { allowed: true };
  }
  
  // 检查是否被锁定
  if (record.lockedUntil && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }
  
  // 清除过期的锁定
  if (record.lockedUntil && record.lockedUntil <= now) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }
  
  // 检查是否在窗口期内
  if (now - record.firstAttempt > ATTEMPT_WINDOW) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }
  
  return { allowed: true };
}

/**
 * 记录登录失败
 */
function recordLoginFailure(identifier: string): void {
  const now = Date.now();
  const record = loginAttempts.get(identifier);
  
  if (!record || now - record.firstAttempt > ATTEMPT_WINDOW) {
    loginAttempts.set(identifier, { count: 1, firstAttempt: now });
    return;
  }
  
  record.count++;
  
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = now + LOCK_DURATION;
  }
  
  loginAttempts.set(identifier, record);
}

/**
 * 清除登录失败记录
 */
function clearLoginFailures(identifier: string): void {
  loginAttempts.delete(identifier);
}

/**
 * 生成 CSRF Token
 */
function generateCsrfToken(userId?: string): string {
  const token = randomBytes(32).toString('hex');
  csrfTokens.set(token, { userId, createdAt: Date.now() });
  return token;
}

/**
 * 验证 CSRF Token
 */
function verifyCsrfToken(token: string, userId?: string): boolean {
  const record = csrfTokens.get(token);
  if (!record) return false;
  
  // 检查过期
  if (Date.now() - record.createdAt > CSRF_TOKEN_EXPIRES) {
    csrfTokens.delete(token);
    return false;
  }
  
  // 如果指定了用户ID，需要匹配
  if (userId && record.userId && record.userId !== userId) {
    return false;
  }
  
  // 一次性使用
  csrfTokens.delete(token);
  return true;
}

// ==================== JWT 处理 ====================

/**
 * Base64URL 编码
 */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL 解码
 */
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * 生成 JWT
 */
function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresIn: number = JWT_EXPIRES_IN): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };
  
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * 验证 JWT
 */
function verifyJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, signature] = parts;
    
    // 验证签名
    const expectedSignature = createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    if (signature !== expectedSignature) return null;
    
    // 解析 payload
    const payload: JWTPayload = JSON.parse(base64UrlDecode(payloadB64));
    
    // 检查过期
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * 生成刷新令牌
 */
function generateRefreshToken(userId: string): string {
  const jti = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + REFRESH_TOKEN_EXPIRES_IN * 1000;
  
  refreshTokens.set(jti, { userId, expiresAt });
  
  const payload: RefreshTokenPayload = {
    sub: userId,
    jti,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt / 1000),
  };
  
  return base64UrlEncode(JSON.stringify(payload));
}

/**
 * 验证刷新令牌
 */
function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const payload: RefreshTokenPayload = JSON.parse(base64UrlDecode(token));
    
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      refreshTokens.delete(payload.jti);
      return null;
    }
    
    const stored = refreshTokens.get(payload.jti);
    if (!stored || stored.userId !== payload.sub) return null;
    
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// ==================== 权限管理 ====================

/**
 * 获取角色权限
 */
function getRolePermissions(role: UserRole): Permission[] {
  const permissions: Record<UserRole, Permission[]> = {
    student: [
      'session:read', 'session:write',
      'anchor:read', 'anchor:write',
      'note:read', 'note:write',
      'report:read',
    ],
    parent: [
      'session:read',
      'anchor:read',
      'note:read',
      'report:read',
    ],
    teacher: [
      'session:read',
      'anchor:read',
      'note:read',
      'report:read', 'report:generate',
      'user:read',
    ],
    admin: [
      'session:read', 'session:write', 'session:delete',
      'anchor:read', 'anchor:write',
      'note:read', 'note:write',
      'report:read', 'report:generate',
      'user:read', 'user:write',
      'admin:access',
    ],
  };
  return permissions[role] || [];
}

// ==================== 认证服务 ====================

export const authService = {
  /**
   * 用户注册
   */
  async register(request: RegisterRequest): Promise<AuthResponse> {
    const { username, password, email, phone, nickname, role = 'student' } = request;
    
    // 验证用户名
    if (!username || username.length < 3) {
      return { success: false, error: '用户名至少3个字符' };
    }
    
    // 检查用户名是否已存在
    for (const user of users.values()) {
      if (user.username === username) {
        return { success: false, error: '用户名已存在' };
      }
      if (email && user.email === email) {
        return { success: false, error: '邮箱已被使用' };
      }
      if (phone && user.phone === phone) {
        return { success: false, error: '手机号已被使用' };
      }
    }
    
    // 验证密码强度
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }
    
    // 创建用户
    const userId = `user-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const { hash, salt } = hashPassword(password);
    
    const newUser: UserWithAuth = {
      id: userId,
      username,
      email,
      phone,
      nickname: nickname || username,
      role: role as UserRole,
      status: 'active',
      passwordHash: hash,
      salt,
      authProviders: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    users.set(userId, newUser);
    
    // 生成令牌
    const permissions = getRolePermissions(newUser.role);
    const accessToken = generateJWT({
      sub: userId,
      username: newUser.username,
      role: newUser.role,
      permissions,
    });
    const refreshToken = generateRefreshToken(userId);
    
    // 返回用户信息（不含敏感数据）
    const { passwordHash: _, salt: __, ...safeUser } = newUser;
    
    return {
      success: true,
      user: safeUser as User,
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },

  /**
   * 用户登录
   */
  async login(request: LoginRequest): Promise<AuthResponse> {
    const { username, password } = request;
    
    // 检查登录限流
    const rateLimit = checkLoginRateLimit(username);
    if (!rateLimit.allowed) {
      return { 
        success: false, 
        error: `登录尝试次数过多，请 ${rateLimit.retryAfter} 秒后重试` 
      };
    }
    
    // 查找用户
    let foundUser: UserWithAuth | null = null;
    for (const user of users.values()) {
      if (user.username === username || user.email === username || user.phone === username) {
        foundUser = user;
        break;
      }
    }
    
    if (!foundUser) {
      recordLoginFailure(username);
      return { success: false, error: '用户名或密码错误' };
    }
    
    // 检查账户状态
    if (foundUser.status !== 'active') {
      return { success: false, error: '账户已被禁用' };
    }
    
    // 验证密码
    if (!foundUser.passwordHash || !foundUser.salt) {
      return { success: false, error: '请使用第三方登录' };
    }
    
    if (!verifyPassword(password, foundUser.passwordHash, foundUser.salt)) {
      recordLoginFailure(username);
      return { success: false, error: '用户名或密码错误' };
    }
    
    // 登录成功，清除失败记录
    clearLoginFailures(username);
    
    // 更新最后登录时间
    foundUser.lastLoginAt = new Date().toISOString();
    foundUser.updatedAt = new Date().toISOString();
    
    // 生成令牌
    const permissions = getRolePermissions(foundUser.role);
    const accessToken = generateJWT({
      sub: foundUser.id,
      username: foundUser.username,
      role: foundUser.role,
      permissions,
    });
    const refreshToken = generateRefreshToken(foundUser.id);
    
    // 返回用户信息
    const { passwordHash: _, salt: __, ...safeUser } = foundUser;
    
    return {
      success: true,
      user: safeUser as User,
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
    const result = verifyRefreshToken(refreshToken);
    if (!result) {
      return { success: false, error: '刷新令牌无效或已过期' };
    }
    
    const user = users.get(result.userId);
    if (!user || user.status !== 'active') {
      return { success: false, error: '用户不存在或已被禁用' };
    }
    
    // 生成新的访问令牌
    const permissions = getRolePermissions(user.role);
    const accessToken = generateJWT({
      sub: user.id,
      username: user.username,
      role: user.role,
      permissions,
    });
    
    const { passwordHash: _, salt: __, ...safeUser } = user;
    
    return {
      success: true,
      user: safeUser as User,
      accessToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },

  /**
   * 验证访问令牌
   */
  verifyToken(token: string): JWTPayload | null {
    return verifyJWT(token);
  },

  /**
   * 登出
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload: RefreshTokenPayload = JSON.parse(base64UrlDecode(refreshToken));
      refreshTokens.delete(payload.jti);
    } catch {
      // 忽略无效令牌
    }
  },

  /**
   * 获取用户信息
   */
  async getUserById(userId: string): Promise<User | null> {
    const user = users.get(userId);
    if (!user) return null;
    
    const { passwordHash: _, salt: __, ...safeUser } = user;
    return safeUser as User;
  },

  /**
   * 更新用户资料
   */
  async updateProfile(userId: string, profile: Partial<UserProfile>): Promise<User | null> {
    const user = users.get(userId);
    if (!user) return null;
    
    if (profile.nickname) user.nickname = profile.nickname;
    if (profile.avatar) user.avatar = profile.avatar;
    if (profile.email) user.email = profile.email;
    if (profile.phone) user.phone = profile.phone;
    user.updatedAt = new Date().toISOString();
    
    const { passwordHash: _, salt: __, ...safeUser } = user;
    return safeUser as User;
  },

  /**
   * 修改密码
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    const user = users.get(userId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }
    
    if (!user.passwordHash || !user.salt) {
      return { success: false, error: '请先设置密码' };
    }
    
    if (!verifyPassword(oldPassword, user.passwordHash, user.salt)) {
      return { success: false, error: '原密码错误' };
    }
    
    if (newPassword.length < 8) {
      return { success: false, error: '新密码至少8个字符' };
    }
    
    // 验证新密码强度
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }
    
    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.salt = salt;
    user.updatedAt = new Date().toISOString();
    
    return { success: true };
  },

  /**
   * 检查权限
   */
  hasPermission(payload: JWTPayload, permission: Permission): boolean {
    return payload.permissions.includes(permission);
  },

  /**
   * 获取所有用户（管理员）
   */
  async getAllUsers(): Promise<User[]> {
    const result: User[] = [];
    for (const user of users.values()) {
      const { passwordHash: _, salt: __, ...safeUser } = user;
      result.push(safeUser as User);
    }
    return result;
  },

  /**
   * 绑定第三方登录
   */
  async linkAuthProvider(userId: string, provider: AuthProvider, providerData: Omit<AuthProviderLink, 'provider' | 'linkedAt'>): Promise<boolean> {
    const user = users.get(userId);
    if (!user) return false;
    
    // 检查是否已绑定
    const existingIndex = user.authProviders.findIndex(p => p.provider === provider);
    
    const link: AuthProviderLink = {
      provider,
      ...providerData,
      linkedAt: new Date().toISOString(),
    };
    
    if (existingIndex >= 0) {
      user.authProviders[existingIndex] = link;
    } else {
      user.authProviders.push(link);
    }
    
    user.updatedAt = new Date().toISOString();
    return true;
  },

  /**
   * 通过第三方登录查找用户
   */
  async findUserByProvider(provider: AuthProvider, providerId: string): Promise<User | null> {
    for (const user of users.values()) {
      const link = user.authProviders.find(p => p.provider === provider && p.providerId === providerId);
      if (link) {
        const { passwordHash: _, salt: __, ...safeUser } = user;
        return safeUser as User;
      }
    }
    return null;
  },

  /**
   * 生成 CSRF Token
   */
  generateCsrfToken(userId?: string): string {
    return generateCsrfToken(userId);
  },

  /**
   * 验证 CSRF Token
   */
  verifyCsrfToken(token: string, userId?: string): boolean {
    return verifyCsrfToken(token, userId);
  },

  /**
   * 验证密码强度
   */
  validatePasswordStrength(password: string): { valid: boolean; error?: string } {
    return validatePasswordStrength(password);
  },
};

export default authService;
