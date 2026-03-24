/**
 * 数据分析 API 路由
 * 
 * 处理客户端的数据上报请求：
 * - POST: 创建/更新会话、记录页面访问、记录事件
 */

import { NextRequest, NextResponse } from 'next/server';
import analyticsService from '@/lib/services/analytics-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('analytics');


// 获取客户端 IP
function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || 'unknown';
}

// 验证请求体
interface AnalyticsPayload {
  action: 'session_start' | 'session_update' | 'session_end' | 'page_view' | 'event' | 'batch';
  sessionToken: string;
  userId?: string;
  data?: {
    // session_start
    entryPage?: string;
    isNewUser?: boolean;
    
    // session_update / session_end
    durationMs?: number;
    exitPage?: string;
    
    // page_view
    path?: string;
    referrer?: string;
    pageDuration?: number;
    
    // event
    eventName?: string;
    eventCategory?: string;
    eventData?: Record<string, unknown>;
    
    // batch
    events?: Array<{
      eventName: string;
      eventCategory?: string;
      eventData?: Record<string, unknown>;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AnalyticsPayload;
    const { action, sessionToken, userId, data } = body;
    
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Missing sessionToken' },
        { status: 400 }
      );
    }
    
    const ip = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || undefined;
    
    let result;
    
    switch (action) {
      case 'session_start':
        result = await analyticsService.createSession({
          sessionToken,
          userId,
          ip,
          userAgent,
          entryPage: data?.entryPage,
          isNewUser: data?.isNewUser,
        });
        break;
        
      case 'session_update':
        result = await analyticsService.updateSession({
          sessionToken,
          durationMs: data?.durationMs,
          exitPage: data?.exitPage,
          endSession: false,
        });
        break;
        
      case 'session_end':
        result = await analyticsService.updateSession({
          sessionToken,
          durationMs: data?.durationMs,
          exitPage: data?.exitPage,
          endSession: true,
        });
        break;
        
      case 'page_view':
        if (!data?.path) {
          return NextResponse.json(
            { success: false, error: 'Missing path for page_view' },
            { status: 400 }
          );
        }
        result = await analyticsService.trackPageView({
          sessionToken,
          path: data.path,
          durationMs: data.pageDuration,
          referrer: data.referrer,
        });
        break;
        
      case 'event':
        if (!data?.eventName) {
          return NextResponse.json(
            { success: false, error: 'Missing eventName for event' },
            { status: 400 }
          );
        }
        result = await analyticsService.trackEvent({
          sessionToken,
          eventName: data.eventName,
          eventCategory: data.eventCategory,
          eventData: data.eventData,
        });
        break;
        
      case 'batch':
        // 批量处理事件
        if (data?.events && Array.isArray(data.events)) {
          const eventParams = data.events.map(e => ({
            sessionToken,
            eventName: e.eventName,
            eventCategory: e.eventCategory,
            eventData: e.eventData,
          }));
          result = await analyticsService.trackEvents(eventParams);
        }
        
        // 同时更新会话
        if (data?.durationMs !== undefined) {
          await analyticsService.updateSession({
            sessionToken,
            durationMs: data.durationMs,
            exitPage: data.exitPage,
          });
        }
        break;
        
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    log.error('[Analytics API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// OPTIONS 请求支持（CORS preflight）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
