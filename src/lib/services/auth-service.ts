/**
 * 用户认证服务
 * 
 * 提供用户注册、登录、会话管理、权限验证等功能
 * 使用 JWT 进行无状态认证，支持刷新令牌机制
 * 
 * 数据存储：SQLite (通过 Prisma ORM)
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
import { AuthConfig } from '@/lib/config';
import prisma from '@/lib/prisma';

// ==================== 配置（从统一配置读取） ====================

const JWT_SECRET = AuthConfig.jwt.secret;
const JWT_EXPIRES_IN = AuthConfig.jwt.expiresIn;
const REFRESH_TOKEN_EXPIRES_IN = AuthConfig.jwt.refreshExpiresIn;
const SALT_ROUNDS = AuthConfig.password.saltRounds;

// 登录限流配置
const MAX_LOGIN_ATTEMPTS = AuthConfig.rateLimit.maxAttempts;
const LOCK_DURATION = AuthConfig.rateLimit.lockDurationMs;
const ATTEMPT_WINDOW = AuthConfig.rateLimit.attemptWindowMs;

// CSRF Token 配置
const CSRF_TOKEN_EXPIRES = AuthConfig.csrf.tokenExpiresMs;

// 检查配置有效性
if (!JWT_SECRET) {
  console.warn('[AuthService] 警告: JWT_SECRET 未配置，请在环境变量中设置');
}

// ==================== 初始化管理员账户 ====================

async function initializeAdminAccount(): Promise<void> {
  const adminUsername = AuthConfig.admin.username;
  const adminPassword = AuthConfig.admin.password;
  
  if (adminUsername && adminPassword) {
    try {
      // 检查管理员是否已存在
      const existingAdmin = await prisma.user.findUnique({
        where: { username: adminUsername }
      });
      
      if (!existingAdmin) {
        const { hash, salt } = hashPassword(adminPassword);
        
        await prisma.user.create({
          data: {
            username: adminUsername,
            nickname: '管理员',
            role: 'admin',
            status: 'active',
            passwordHash: hash,
            salt: salt,
          }
        });
        
        console.log('[AuthService] 管理员账户已初始化');
      }
    } catch (error) {
      console.error('[AuthService] 初始化管理员账户失败:', error);
    }
  } else {
    console.warn('[AuthService] 未配置管理员账户，请设置 ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量');
  }
}

// 延迟初始化管理员账户
let adminInitialized = false;
async function ensureAdminInitialized(): Promise<void> {
  if (!adminInitialized) {
    await initializeAdminAccount();
    adminInitialized = true;
  }
}

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
 * 检查登录限流（使用数据库）
 */
async function checkLoginRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  
  const record = await prisma.loginAttempt.findUnique({
    where: { identifier }
  });
  
  if (!record) {
    return { allowed: true };
  }
  
  // 检查是否被锁定
  if (record.lockedUntil && record.lockedUntil > now) {
    const retryAfter = Math.ceil((record.lockedUntil.getTime() - now.getTime()) / 1000);
    return { allowed: false, retryAfter };
  }
  
  // 清除过期的锁定
  if (record.lockedUntil && record.lockedUntil <= now) {
    await prisma.loginAttempt.delete({ where: { identifier } });
    return { allowed: true };
  }
  
  // 检查是否在窗口期内
  if (now.getTime() - record.firstAttempt.getTime() > ATTEMPT_WINDOW) {
    await prisma.loginAttempt.delete({ where: { identifier } });
    return { allowed: true };
  }
  
  return { allowed: true };
}

/**
 * 记录登录失败（使用数据库）
 */
async function recordLoginFailure(identifier: string): Promise<void> {
  const now = new Date();
  
  const record = await prisma.loginAttempt.findUnique({
    where: { identifier }
  });
  
  if (!record || now.getTime() - record.firstAttempt.getTime() > ATTEMPT_WINDOW) {
    await prisma.loginAttempt.upsert({
      where: { identifier },
      update: { count: 1, firstAttempt: now, lockedUntil: null },
      create: { identifier, count: 1, firstAttempt: now }
    });
    return;
  }
  
  const newCount = record.count + 1;
  const lockedUntil = newCount >= MAX_LOGIN_ATTEMPTS 
    ? new Date(now.getTime() + LOCK_DURATION) 
    : null;
  
  await prisma.loginAttempt.update({
    where: { identifier },
    data: { count: newCount, lockedUntil }
  });
}

/**
 * 清除登录失败记录
 */
async function clearLoginFailures(identifier: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { identifier }
  });
}

/**
 * 生成 CSRF Token（使用数据库）
 */
async function generateCsrfTokenDb(userId?: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prisma.csrfToken.create({
    data: { token, userId }
  });
  return token;
}

/**
 * 验证 CSRF Token（使用数据库）
 */
async function verifyCsrfTokenDb(token: string, userId?: string): Promise<boolean> {
  const record = await prisma.csrfToken.findUnique({
    where: { token }
  });
  
  if (!record) return false;
  
  // 检查过期
  if (Date.now() - record.createdAt.getTime() > CSRF_TOKEN_EXPIRES) {
    await prisma.csrfToken.delete({ where: { token } });
    return false;
  }
  
  // 如果指定了用户ID，需要匹配
  if (userId && record.userId && record.userId !== userId) {
    return false;
  }
  
  // 一次性使用
  await prisma.csrfToken.delete({ where: { token } });
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
 * 生成刷新令牌（使用数据库）
 */
async function generateRefreshTokenDb(userId: string): Promise<string> {
  const jti = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN * 1000);
  
  await prisma.refreshToken.create({
    data: {
      token: jti,
      userId,
      expiresAt
    }
  });
  
  const payload: RefreshTokenPayload = {
    sub: userId,
    jti,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  
  return base64UrlEncode(JSON.stringify(payload));
}

/**
 * 验证刷新令牌（使用数据库）
 */
async function verifyRefreshTokenDb(token: string): Promise<{ userId: string } | null> {
  try {
    const payload: RefreshTokenPayload = JSON.parse(base64UrlDecode(token));
    
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      await prisma.refreshToken.deleteMany({ where: { token: payload.jti } });
      return null;
    }
    
    const stored = await prisma.refreshToken.findUnique({
      where: { token: payload.jti }
    });
    
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

/**
 * 将数据库用户转换为应用用户类型
 */
function dbUserToUser(dbUser: any): User {
  return {
    id: dbUser.id,
    username: dbUser.username,
    email: dbUser.email || undefined,
    phone: dbUser.phone || undefined,
    nickname: dbUser.nickname,
    avatar: dbUser.avatar || undefined,
    role: dbUser.role as UserRole,
    status: dbUser.status as UserStatus,
    createdAt: dbUser.createdAt.toISOString(),
    updatedAt: dbUser.updatedAt.toISOString(),
    lastLoginAt: dbUser.lastLoginAt?.toISOString(),
  };
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
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ]
      }
    });
    
    if (existingUser) {
      if (existingUser.username === username) {
        return { success: false, error: '用户名已存在' };
      }
      if (email && existingUser.email === email) {
        return { success: false, error: '邮箱已被使用' };
      }
      if (phone && existingUser.phone === phone) {
        return { success: false, error: '手机号已被使用' };
      }
    }
    
    // 验证密码强度
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }
    
    // 创建用户
    const { hash, salt } = hashPassword(password);
    
    const newUser = await prisma.user.create({
      data: {
        username,
        email,
        phone,
        nickname: nickname || username,
        role: role as string,
        status: 'active',
        passwordHash: hash,
        salt,
      }
    });
    
    // 生成令牌
    const permissions = getRolePermissions(role as UserRole);
    const accessToken = generateJWT({
      sub: newUser.id,
      username: newUser.username,
      role: newUser.role as UserRole,
      permissions,
    });
    const refreshToken = await generateRefreshTokenDb(newUser.id);
    
    return {
      success: true,
      user: dbUserToUser(newUser),
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },

  /**
   * 用户登录
   */
  async login(request: LoginRequest): Promise<AuthResponse> {
    // 确保管理员账户已初始化
    await ensureAdminInitialized();
    
    const { username, password } = request;
    
    // 检查登录限流
    const rateLimit = await checkLoginRateLimit(username);
    if (!rateLimit.allowed) {
      return { 
        success: false, 
        error: `登录尝试次数过多，请 ${rateLimit.retryAfter} 秒后重试` 
      };
    }
    
    // 查找用户
    const foundUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: username },
          { phone: username },
        ]
      }
    });
    
    if (!foundUser) {
      await recordLoginFailure(username);
      return { success: false, error: '用户名或密码错误' };
    }
    
    // 检查账户状态
    if (foundUser.status !== 'active') {
      return { success: false, error: '账户已被禁用' };
    }
    
    // 验证密码
    if (!foundUser.passwordHash || !foundUser.salt) {
      return { success: false, error: '该账户未设置密码，请使用验证码登录' };
    }
    
    if (!verifyPassword(password, foundUser.passwordHash, foundUser.salt)) {
      await recordLoginFailure(username);
      return { success: false, error: '用户名或密码错误' };
    }
    
    // 登录成功，清除失败记录
    await clearLoginFailures(username);
    
    // 更新最后登录时间
    const updatedUser = await prisma.user.update({
      where: { id: foundUser.id },
      data: { lastLoginAt: new Date() }
    });
    
    // 生成令牌
    const permissions = getRolePermissions(updatedUser.role as UserRole);
    const accessToken = generateJWT({
      sub: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role as UserRole,
      permissions,
    });
    const refreshToken = await generateRefreshTokenDb(updatedUser.id);
    
    return {
      success: true,
      user: dbUserToUser(updatedUser),
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
    const result = await verifyRefreshTokenDb(refreshToken);
    if (!result) {
      return { success: false, error: '刷新令牌无效或已过期' };
    }
    
    const user = await prisma.user.findUnique({
      where: { id: result.userId }
    });
    
    if (!user || user.status !== 'active') {
      return { success: false, error: '用户不存在或已被禁用' };
    }
    
    // 生成新的访问令牌
    const permissions = getRolePermissions(user.role as UserRole);
    const accessToken = generateJWT({
      sub: user.id,
      username: user.username,
      role: user.role as UserRole,
      permissions,
    });
    
    return {
      success: true,
      user: dbUserToUser(user),
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
      await prisma.refreshToken.deleteMany({
        where: { token: payload.jti }
      });
    } catch {
      // 忽略无效令牌
    }
  },

  /**
   * 获取用户信息
   */
  async getUserById(userId: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) return null;
    return dbUserToUser(user);
  },

  /**
   * 更新用户资料
   */
  async updateProfile(userId: string, profile: Partial<UserProfile>): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) return null;
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(profile.nickname && { nickname: profile.nickname }),
        ...(profile.avatar && { avatar: profile.avatar }),
        ...(profile.email && { email: profile.email }),
        ...(profile.phone && { phone: profile.phone }),
      }
    });
    
    return dbUserToUser(updatedUser);
  },

  /**
   * 修改密码
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
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
    
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, salt }
    });
    
    return { success: true };
  },

  /**
   * 设置密码（用于未设置密码的用户）
   */
  async setPassword(userId: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return { success: false, error: '用户不存在' };
    }
    
    // 已有密码则不能使用此方法
    if (user.passwordHash && user.salt) {
      return { success: false, error: '已设置密码，请使用修改密码功能' };
    }
    
    if (newPassword.length < 8) {
      return { success: false, error: '密码至少8个字符' };
    }
    
    // 验证密码强度
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }
    
    const { hash, salt } = hashPassword(newPassword);
    
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, salt }
    });
    
    return { success: true };
  },

  /**
   * 重置密码（通过验证码验证后）
   * 用于忘记密码场景
   */
  async resetPassword(target: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    // 根据 target 查找用户（支持邮箱和手机号）
    const isEmail = target.includes('@');
    const user = await prisma.user.findFirst({
      where: isEmail ? { email: target } : { phone: target }
    });
    
    if (!user) {
      return { success: false, error: '用户不存在' };
    }
    
    if (newPassword.length < 8) {
      return { success: false, error: '密码至少8个字符' };
    }
    
    // 验证密码强度
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }
    
    const { hash, salt } = hashPassword(newPassword);
    
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, salt }
    });
    
    return { success: true };
  },

  /**
   * 检查用户是否已设置密码
   */
  async hasPassword(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, salt: true }
    });
    return !!(user?.passwordHash && user?.salt);
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
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    return users.map(dbUserToUser);
  },

  /**
   * 绑定第三方登录
   */
  async linkAuthProvider(userId: string, provider: AuthProvider, providerData: Omit<AuthProviderLink, 'provider' | 'linkedAt'>): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) return false;
    
    await prisma.authProvider.upsert({
      where: {
        provider_providerId: {
          provider,
          providerId: providerData.providerId
        }
      },
      update: {
        accessToken: providerData.accessToken,
        refreshToken: providerData.refreshToken,
        expiresAt: providerData.expiresAt ? new Date(providerData.expiresAt) : null,
      },
      create: {
        userId,
        provider,
        providerId: providerData.providerId,
        accessToken: providerData.accessToken,
        refreshToken: providerData.refreshToken,
        expiresAt: providerData.expiresAt ? new Date(providerData.expiresAt) : null,
      }
    });
    
    return true;
  },

  /**
   * 通过第三方登录查找用户
   */
  async findUserByProvider(provider: AuthProvider, providerId: string): Promise<User | null> {
    const authProvider = await prisma.authProvider.findUnique({
      where: {
        provider_providerId: { provider, providerId }
      },
      include: { user: true }
    });
    
    if (!authProvider) return null;
    return dbUserToUser(authProvider.user);
  },

  /**
   * 生成 CSRF Token
   */
  async generateCsrfToken(userId?: string): Promise<string> {
    return generateCsrfTokenDb(userId);
  },

  /**
   * 验证 CSRF Token
   */
  async verifyCsrfToken(token: string, userId?: string): Promise<boolean> {
    return verifyCsrfTokenDb(token, userId);
  },

  /**
   * 验证密码强度
   */
  validatePasswordStrength(password: string): { valid: boolean; error?: string } {
    return validatePasswordStrength(password);
  },

  /**
   * 验证码登录（邮箱或手机号）
   * 如果用户不存在则自动注册
   */
  async loginWithCode(target: string, type: 'email' | 'phone'): Promise<AuthResponse> {
    // 确保管理员账户已初始化
    await ensureAdminInitialized();

    // 查找用户
    const whereCondition = type === 'email' ? { email: target } : { phone: target };
    let foundUser = await prisma.user.findFirst({ where: whereCondition });

    // 如果用户不存在，自动创建
    if (!foundUser) {
      const username = type === 'email' 
        ? target.split('@')[0] + '_' + Date.now().toString(36)
        : 'user_' + target.slice(-4) + '_' + Date.now().toString(36);
      
      foundUser = await prisma.user.create({
        data: {
          username,
          [type]: target,
          nickname: type === 'email' ? target.split('@')[0] : `用户${target.slice(-4)}`,
          role: 'student',
          status: 'active',
        }
      });
      
      console.log(`[AuthService] 验证码登录自动注册: ${target}`);
    }

    // 检查账户状态
    if (foundUser.status !== 'active') {
      return { success: false, error: '账户已被禁用' };
    }

    // 更新最后登录时间
    const updatedUser = await prisma.user.update({
      where: { id: foundUser.id },
      data: { lastLoginAt: new Date() }
    });

    // 生成令牌
    const permissions = getRolePermissions(updatedUser.role as UserRole);
    const accessToken = generateJWT({
      sub: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role as UserRole,
      permissions,
    });
    const refreshToken = await generateRefreshTokenDb(updatedUser.id);

    return {
      success: true,
      user: dbUserToUser(updatedUser),
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
    };
  },
};

export default authService;
