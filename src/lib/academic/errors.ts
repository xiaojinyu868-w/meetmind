/**
 * Academic Service OS: 统一错误类
 *
 * API 路由里 catch 后，用 `toHttpError()` 转成 NextResponse，避免把堆栈泄到外部。
 */

export type AcademicErrorCode =
  | 'UNAUTHORIZED'           // 未登录
  | 'NO_ACTIVE_ORG'          // 登录了但没选/没加入任何机构
  | 'NOT_A_MEMBER'           // 请求的 orgId 不在用户 memberships 里
  | 'INSUFFICIENT_ROLE'      // 角色不够（student 去做 consultant 的事）
  | 'NOT_FOUND'              // 资源不存在 / 不属于当前 org
  | 'ALREADY_EXISTS'         // 重复
  | 'INVALID_INPUT'          // 参数错
  | 'ONBOARDING_REQUIRED'    // 机构还没完成 onboarding
  | 'INTERNAL';

const HTTP_STATUS: Record<AcademicErrorCode, number> = {
  UNAUTHORIZED: 401,
  NO_ACTIVE_ORG: 403,
  NOT_A_MEMBER: 403,
  INSUFFICIENT_ROLE: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  ONBOARDING_REQUIRED: 409,
  INTERNAL: 500,
};

export class AcademicError extends Error {
  readonly code: AcademicErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: AcademicErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AcademicError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

export function toHttpError(err: unknown): { status: number; body: { code: AcademicErrorCode; message: string; details?: unknown } } {
  if (err instanceof AcademicError) {
    return {
      status: err.httpStatus,
      body: { code: err.code, message: err.message, details: err.details },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: { code: 'INTERNAL', message },
  };
}
