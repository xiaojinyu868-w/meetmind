/**
 * Academic API 路由的统一包装：catch AcademicError → 转 HTTP 响应
 *
 * 用法：
 *   export const GET = academicRoute(async (req) => {
 *     const ctx = await resolveConsoleContext(req);
 *     const data = await orgService.listMyOrgs(ctx.userId);
 *     return { data };
 *   });
 *
 * 返回 { data } 会被自动包成 { ok: true, data }。
 * 返回 NextResponse 会直接透传。
 * 抛错 AcademicError 会被转成合适的 HTTP status + { ok: false, error }。
 */

import { NextRequest, NextResponse } from 'next/server';
import { toHttpError } from './errors';

export type AcademicRouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<{ data?: unknown } | NextResponse>;

export function academicRoute(handler: AcademicRouteHandler) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => {
    try {
      const result = await handler(req, ctx);
      if (result instanceof NextResponse) return result;
      return NextResponse.json({ ok: true, ...(result ?? {}) });
    } catch (err) {
      const { status, body } = toHttpError(err);
      return NextResponse.json({ ok: false, error: body }, { status });
    }
  };
}
