/**
 * 数据统计查询 API
 * 
 * 提供管理员查询统计数据的接口
 * - GET: 获取综合统计数据
 */

import { NextRequest, NextResponse } from 'next/server';
import analyticsService from '@/lib/services/analytics-service';
import authService from '@/lib/services/auth-service';

export const dynamic = 'force-dynamic';

const DEFAULT_TREND_DAYS = 30;
const MAX_TREND_DAYS = 90;

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份和权限 - 通过 Authorization header 获取 token
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const payload = authService.verifyToken(token);
    
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    // 获取用户信息检查角色
    const user = await authService.getUserById(payload.sub);
    
    if (!user || (user.role !== 'admin' && user.role !== 'teacher')) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin or Teacher role required' },
        { status: 403 }
      );
    }
    
    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview';
    const rawDays = Number.parseInt(searchParams.get('days') || `${DEFAULT_TREND_DAYS}`, 10);
    const days = Number.isFinite(rawDays)
      ? Math.min(Math.max(rawDays, 1), MAX_TREND_DAYS)
      : DEFAULT_TREND_DAYS;
    
    let data;
    
    switch (type) {
      case 'overview':
        // 综合统计概览
        data = await analyticsService.getStats();
        break;
        
      case 'trend':
        // 每日趋势
        data = await analyticsService.getDailyTrend(days);
        break;
        
      case 'ip':
        // IP 分布
        data = await analyticsService.getIpDistribution(20);
        break;
        
      default:
        data = await analyticsService.getStats();
    }
    
    return NextResponse.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Analytics Stats API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
