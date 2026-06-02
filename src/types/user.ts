/**
 * 用户管理模块类型定义
 */

// ==================== 用户角色与权限 ====================

/**
 * 用户角色
 */
export type UserRole = 'student' | 'admin';

/**
 * 权限定义
 */
export type Permission = 
  | 'session:read'
  | 'session:write'
  | 'session:delete'
  | 'anchor:read'
  | 'anchor:write'
  | 'note:read'
  | 'note:write'
  | 'report:read'
  | 'report:generate'
  | 'user:read'
  | 'user:write'
  | 'admin:access';

/**
 * 角色权限映射
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  student: [
    'session:read', 'session:write',
    'anchor:read', 'anchor:write',
    'note:read', 'note:write',
    'report:read',
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

// ==================== 用户实体 ====================

/**
 * 用户账户状态
 */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

/**
 * 登录方式
 */
export type AuthProvider = 'local' | 'wechat' | 'google' | 'apple';

/**
 * 用户基本信息
 */
export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  nickname: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  learnerProfile?: LearnerProfile;
  onboardingCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

/**
 * 用户完整信息（含认证信息）
 */
export interface UserWithAuth extends User {
  passwordHash?: string;
  salt?: string;
  authProviders: AuthProviderLink[];
}

/**
 * 第三方登录绑定
 */
export interface AuthProviderLink {
  provider: AuthProvider;
  providerId: string;       // 第三方平台用户ID
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  linkedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * 用户资料（可编辑部分）
 */
export interface UserProfile {
  nickname: string;
  avatar?: string;
  email?: string;
  phone?: string;
  school?: string;
  grade?: string;
  bio?: string;
  preferences?: UserPreferences;
}

/**
 * 用户偏好设置
 */
export interface UserPreferences {
  theme?: 'light' | 'dark' | 'auto';
  language?: 'zh-CN' | 'en-US';
  notifications?: {
    email?: boolean;
    push?: boolean;
    wechat?: boolean;
  };
  aiModel?: string;
  autoSave?: boolean;
}

// ==================== 学习者画像 ====================

/** 身份阶段 */
export type LearnerStage = 'k12' | 'university' | 'graduate' | 'working';

export const LEARNER_STAGE_LABELS: Record<LearnerStage, string> = {
  k12: '中小学生',
  university: '大学生',
  graduate: '研究生',
  working: '在职学习',
};

interface LearnerProfileBase {
  stage: LearnerStage;
  goal?: string; // "期末不挂科" / "考研" / "转行" — 旧字段，保留兼容
  otherInterests?: string; // "英语、出国准备" — 和主方向无关的学习线
  /**
   * 「聊聊你想要的」教练对话沉淀下来的目标卡。
   * 不是固定字段，是用户和 AI 一起聊出来的"我想做的事"——可以多条，可以更新。
   * 这一层是 v3.0 信息流产品哲学的核心：用户带着 target 进来，剩下的内容流由 AI 围绕这些 target 组织。
   */
  goals?: GoalEntry[];
  /**
   * AI 在「聊聊你想要的」首次会面对话里提炼的"我了解到的你"画像。
   * 1-3 句话，第二人称，写他的身份/阶段/状态/在乎的事。
   * 这是个人上下文的核心——后续 IntentDialog 回访 / 复习态 tutor / shared 态都可以读这一段。
   *
   * 仅由 IntentDialog 的 ---我了解到的你--- marker 写入。
   */
  bio?: BioEntry;
}

/**
 * 一条"我想做的事"。
 * - title 必填，是用户面卡片的标题（最好用户自己说出口的那句话）
 * - summary 可选，详细描述（同样最好是用户自己的措辞）
 * - source 标记是从哪轮对话提炼出来的，方便后续追溯
 */
export interface GoalEntry {
  /** 稳定 ID（前端生成 / 后端不强约束） */
  id: string;
  /** 一句话标题，最多 40 字 */
  title: string;
  /** 详细描述，可选 */
  summary?: string;
  /** ISO 创建时间 */
  createdAt: string;
  /** ISO 最后更新时间 */
  updatedAt: string;
  /** 关联的对话 conversationId（可选，用于"翻回当时聊的内容"） */
  conversationId?: string;
  /** 用户标记的状态：active = 正在追求 / paused = 先放放 / done = 已达成 */
  status?: 'active' | 'paused' | 'done';
}

/**
 * 一份"我了解到的你"画像。
 * 是 AI 在首次会面对话里提炼 + 用户确认后才落库的。后续会话直接读这一段，不再重复问身份阶段。
 */
export interface BioEntry {
  /** 一句话核心：身份 + 阶段 + 当前状态。例如"大三计算机学生，在准备考研，最近在数学上卡了一阵" */
  headline: string;
  /** 可选 1-2 行 detail：在乎的事 / 节奏 / 值得记住的细节 */
  detail?: string;
  /** ISO 首次创建时间 */
  createdAt: string;
  /** ISO 最近一次更新时间（用户每次主动重聊都可以更新） */
  updatedAt: string;
  /** 关联首次提炼时的 conversationId */
  conversationId?: string;
}

export interface K12Profile extends LearnerProfileBase {
  stage: 'k12';
  gradeLevel: string;        // "高一" / "初三"
  textbookEdition?: string;  // "人教版" / "北师大版"
  weakSubjects?: string[];   // ["数学", "物理"]
}

export interface UniversityProfile extends LearnerProfileBase {
  stage: 'university';
  major: string;             // "计算机科学"
  year: string;              // "大二"
  currentCourses?: string[]; // ["数据结构", "线性代数"]
}

export interface GraduateProfile extends LearnerProfileBase {
  stage: 'graduate';
  field: string;             // "NLP" / "量化金融"
  advisor?: string;          // 导师
  researchTopic?: string;    // "大模型幻觉检测"
}

export interface WorkingProfile extends LearnerProfileBase {
  stage: 'working';
  industry: string;          // "互联网" / "金融"
  learningGoal: string;      // "转行产品经理" / "CPA考证"
}

export type LearnerProfile = K12Profile | UniversityProfile | GraduateProfile | WorkingProfile;

// ==================== 微信登录相关 ====================

/**
 * 微信用户信息
 */
export interface WechatUserInfo {
  openid: string;
  unionid?: string;
  nickname: string;
  headimgurl: string;
  sex?: number;
  province?: string;
  city?: string;
  country?: string;
  privilege?: string[];
}

/**
 * 微信 OAuth 令牌
 */
export interface WechatTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

/**
 * 微信登录状态
 */
export interface WechatAuthState {
  state: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}

// ==================== 会话管理 ====================

/**
 * 用户会话
 */
export interface UserSession {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  userAgent?: string;
  ip?: string;
  expiresAt: string;
  createdAt: string;
  lastActiveAt: string;
}

/**
 * JWT Payload
 */
export interface JWTPayload {
  sub: string;          // 用户ID
  username: string;
  role: UserRole;
  permissions: Permission[];
  iat: number;          // 签发时间
  exp: number;          // 过期时间
  jti?: string;         // JWT ID
}

/**
 * 刷新令牌 Payload
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

// ==================== 请求/响应类型 ====================

/**
 * 注册请求
 */
export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  phone?: string;
  nickname?: string;
  role?: UserRole;
  inviteCode?: string;
}

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 微信登录请求
 */
export interface WechatLoginRequest {
  code: string;
  state: string;
}

/**
 * 认证响应
 */
export interface AuthResponse {
  success: boolean;
  user?: User;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

/**
 * 刷新令牌请求
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * 更新资料请求
 */
export interface UpdateProfileRequest {
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  school?: string;
  grade?: string;
  bio?: string;
}

/**
 * 修改密码请求
 */
export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

/**
 * 绑定微信请求
 */
export interface BindWechatRequest {
  code: string;
  state: string;
}

/**
 * 邀请码
 */
export interface InviteCode {
  code: string;
  createdBy: string;
  role: UserRole;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}
