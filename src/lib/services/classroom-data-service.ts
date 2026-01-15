/**
 * 课堂数据共享服务
 * 
 * 负责学生端和教师端之间的数据共享，提供统一的数据读写接口。
 * 
 * 架构设计：
 * - 使用 IndexedDB (Dexie.js) 作为共享存储层
 * - 学生端写入困惑点和转录数据
 * - 教师端读取并聚合数据展示
 * - 支持按课程会话 (sessionId) 组织数据
 * 
 * 数据流：
 * 学生端 → saveStudentAnchor() → IndexedDB → getClassroomData() → 教师端
 */

import { db, generateSessionId } from '@/lib/db';
import type { TranscriptSegment } from '@/types';
import { DEMO_SEGMENTS, DEMO_ANCHORS, DEMO_SESSION_ID } from '@/fixtures/demo-data';

// ==================== 类型定义 ====================

/** 困惑点类型 */
export type AnchorType = 'confusion' | 'important' | 'question';

/** 困惑点状态 */
export type AnchorStatus = 'active' | 'cancelled' | 'resolved';

/**
 * 学生困惑点记录
 * 统一的困惑点数据结构，用于学生端写入和教师端读取
 */
export interface StudentAnchor {
  id: string;                    // 唯一标识 (UUID)
  sessionId: string;             // 课程会话ID
  studentId: string;             // 学生用户ID (来自认证系统)
  studentName: string;           // 学生昵称 (用于教师端显示)
  timestamp: number;             // 课堂时间戳 (毫秒)
  type: AnchorType;              // 困惑点类型
  status: AnchorStatus;          // 状态
  note?: string;                 // 学生备注
  aiExplanation?: string;        // AI 解释内容
  transcriptContext?: string;    // 关联的转录文本上下文
  createdAt: string;             // 创建时间 (ISO 字符串)
  resolvedAt?: string;           // 解决时间
  updatedAt: string;             // 更新时间
}

/**
 * 课程会话信息
 * 存储课程的基本信息，由学生端创建
 */
export interface ClassSession {
  id: string;                    // 会话ID (UUID)
  subject?: string;              // 学科
  topic?: string;                // 课程主题
  teacherName?: string;          // 教师名称
  duration: number;              // 课程时长 (毫秒)
  status: 'recording' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
  createdBy?: string;            // 创建者ID
}

/**
 * 困惑热点数据
 * 用于教师端展示的聚合数据
 */
export interface ConfusionHotspot {
  rank: number;                  // 排名
  timeRange: string;             // 时间范围显示 (如 "01:50 - 02:30")
  startMs: number;               // 开始时间 (毫秒)
  endMs: number;                 // 结束时间 (毫秒)
  count: number;                 // 困惑人数
  content: string;               // 困惑内容 (来自转录)
  students: string[];            // 困惑学生名单
  studentIds: string[];          // 学生ID列表
  possibleReason: string;        // 可能原因 (AI 推断)
  anchors: StudentAnchor[];      // 原始困惑点列表
  // v2.0 新增：搞定率统计
  resolvedCount: number;         // 已解决数量
  resolvedRate: number;          // 搞定率 (0-100)
}

/**
 * 课堂数据汇总
 * 教师端获取的完整课堂数据
 */
export interface ClassroomData {
  session: ClassSession;
  anchors: StudentAnchor[];
  transcripts: TranscriptSegment[];
  hotspots: ConfusionHotspot[];
  statistics: {
    totalStudents: number;       // 参与学生数
    totalAnchors: number;        // 困惑点总数
    unresolvedCount: number;     // 未解决数量
    peakConfusionTime?: number;  // 困惑高峰时间点
  };
}

// ==================== 存储键常量 ====================

const STORAGE_PREFIX = 'meetmind_classroom';
const ANCHORS_KEY = `${STORAGE_PREFIX}_anchors`;
const SESSIONS_KEY = `${STORAGE_PREFIX}_sessions`;

// ==================== 辅助函数 ====================

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 格式化时间戳为显示字符串
 */
function formatTimeRange(startMs: number, endMs: number): string {
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };
  return `${formatTime(startMs)} - ${formatTime(endMs)}`;
}

/**
 * 获取时间窗口的开始时间
 * @param timestamp 时间戳
 * @param windowSize 窗口大小 (毫秒)
 */
function getWindowStart(timestamp: number, windowSize: number): number {
  return Math.floor(timestamp / windowSize) * windowSize;
}

/**
 * 根据困惑点数量推断可能原因
 */
function inferPossibleReason(count: number, content: string): string {
  if (count >= 5) {
    if (content.includes('公式') || content.includes('推导')) {
      return '公式推导步骤跳跃';
    }
    if (content.includes('概念') || content.includes('定义')) {
      return '概念引入过快';
    }
    return '讲解节奏过快';
  }
  if (count >= 3) {
    return '知识点较难理解';
  }
  return '个别学生基础薄弱';
}

// ==================== 本地存储操作 ====================

/**
 * 获取所有困惑点 (从 localStorage)
 */
function getAllAnchorsFromStorage(): StudentAnchor[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(ANCHORS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 保存困惑点到 localStorage
 */
function saveAnchorsToStorage(anchors: StudentAnchor[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ANCHORS_KEY, JSON.stringify(anchors));
}

/**
 * 获取所有课程会话
 */
function getAllSessionsFromStorage(): ClassSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 保存课程会话
 */
function saveSessionsToStorage(sessions: ClassSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

// ==================== 课堂数据服务 ====================

export const classroomDataService = {
  // ============ 课程会话管理 ============

  /**
   * 创建或更新课程会话
   */
  saveSession(session: Partial<ClassSession> & { id: string }): ClassSession {
    const sessions = getAllSessionsFromStorage();
    const now = new Date().toISOString();
    
    const existingIndex = sessions.findIndex(s => s.id === session.id);
    
    const fullSession: ClassSession = {
      id: session.id,
      subject: session.subject || '未知学科',
      topic: session.topic,
      teacherName: session.teacherName,
      duration: session.duration || 0,
      status: session.status || 'recording',
      createdAt: existingIndex >= 0 ? sessions[existingIndex].createdAt : now,
      updatedAt: now,
      createdBy: session.createdBy,
    };
    
    if (existingIndex >= 0) {
      sessions[existingIndex] = fullSession;
    } else {
      sessions.push(fullSession);
    }
    
    saveSessionsToStorage(sessions);
    return fullSession;
  },

  /**
   * 获取课程会话
   */
  getSession(sessionId: string): ClassSession | null {
    const sessions = getAllSessionsFromStorage();
    return sessions.find(s => s.id === sessionId) || null;
  },

  /**
   * 获取所有课程会话
   */
  getAllSessions(): ClassSession[] {
    return getAllSessionsFromStorage();
  },

  /**
   * 更新课程时长
   */
  updateSessionDuration(sessionId: string, duration: number): void {
    const sessions = getAllSessionsFromStorage();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.duration = duration;
      session.updatedAt = new Date().toISOString();
      saveSessionsToStorage(sessions);
    }
  },

  /**
   * 完成课程
   */
  completeSession(sessionId: string): void {
    const sessions = getAllSessionsFromStorage();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.status = 'completed';
      session.updatedAt = new Date().toISOString();
      saveSessionsToStorage(sessions);
    }
  },

  // ============ 学生困惑点操作 (学生端使用) ============

  /**
   * 保存学生困惑点
   * 学生端调用此方法记录困惑点
   */
  saveStudentAnchor(
    sessionId: string,
    studentId: string,
    studentName: string,
    timestamp: number,
    type: AnchorType = 'confusion',
    transcriptContext?: string
  ): StudentAnchor {
    const anchors = getAllAnchorsFromStorage();
    const now = new Date().toISOString();
    
    const anchor: StudentAnchor = {
      id: generateId(),
      sessionId,
      studentId,
      studentName,
      timestamp,
      type,
      status: 'active',
      transcriptContext,
      createdAt: now,
      updatedAt: now,
    };
    
    anchors.push(anchor);
    saveAnchorsToStorage(anchors);
    
    // 同时广播给其他标签页 (教师端)
    this.broadcastAnchorUpdate('add', anchor);
    
    return anchor;
  },

  /**
   * 撤销困惑点 (5秒内可撤销)
   */
  cancelAnchor(anchorId: string): boolean {
    const anchors = getAllAnchorsFromStorage();
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (!anchor) return false;
    
    // 检查是否在5秒内
    const elapsed = Date.now() - new Date(anchor.createdAt).getTime();
    if (elapsed > 5000) return false;
    
    anchor.status = 'cancelled';
    anchor.updatedAt = new Date().toISOString();
    saveAnchorsToStorage(anchors);
    
    this.broadcastAnchorUpdate('cancel', anchor);
    return true;
  },

  /**
   * 标记困惑点为已解决
   */
  resolveAnchor(anchorId: string, aiExplanation?: string): void {
    const anchors = getAllAnchorsFromStorage();
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (anchor) {
      anchor.status = 'resolved';
      anchor.resolvedAt = new Date().toISOString();
      anchor.updatedAt = new Date().toISOString();
      if (aiExplanation) {
        anchor.aiExplanation = aiExplanation;
      }
      saveAnchorsToStorage(anchors);
      
      this.broadcastAnchorUpdate('resolve', anchor);
    }
  },

  /**
   * 添加备注
   */
  addNote(anchorId: string, note: string): void {
    const anchors = getAllAnchorsFromStorage();
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (anchor) {
      anchor.note = note;
      anchor.updatedAt = new Date().toISOString();
      saveAnchorsToStorage(anchors);
    }
  },

  // ============ 教师端数据查询 ============

  /**
   * 获取课程的所有困惑点
   */
  getSessionAnchors(sessionId: string): StudentAnchor[] {
    const anchors = getAllAnchorsFromStorage();
    return anchors
      .filter(a => a.sessionId === sessionId && a.status !== 'cancelled')
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  /**
   * 获取指定学生的困惑点
   */
  getStudentAnchors(sessionId: string, studentId: string): StudentAnchor[] {
    return this.getSessionAnchors(sessionId)
      .filter(a => a.studentId === studentId);
  },

  /**
   * 聚合困惑热点数据
   * 将困惑点按时间窗口聚合，生成教师端展示的热点数据
   * 
   * @param sessionId 课程会话ID
   * @param transcripts 转录内容 (用于获取困惑点对应的文本)
   * @param windowSize 时间窗口大小 (毫秒)，默认30秒
   * @param topN 返回前N个热点，默认10
   */
  aggregateHotspots(
    sessionId: string,
    transcripts: TranscriptSegment[],
    windowSize: number = 30000,
    topN: number = 10
  ): ConfusionHotspot[] {
    const anchors = this.getSessionAnchors(sessionId);
    
    if (anchors.length === 0) return [];
    
    // 按时间窗口分组
    const windowMap = new Map<number, StudentAnchor[]>();
    
    anchors.forEach(anchor => {
      const windowStart = getWindowStart(anchor.timestamp, windowSize);
      if (!windowMap.has(windowStart)) {
        windowMap.set(windowStart, []);
      }
      windowMap.get(windowStart)!.push(anchor);
    });
    
    // 转换为热点数据
    const hotspots: ConfusionHotspot[] = Array.from(windowMap.entries())
      .map(([startMs, windowAnchors]) => {
        const endMs = startMs + windowSize;
        
        // 获取该时间段的转录内容
        const content = this.getTranscriptContent(transcripts, startMs, endMs);
        
        // 去重学生
        const studentMap = new Map<string, string>();
        windowAnchors.forEach(a => {
          studentMap.set(a.studentId, a.studentName);
        });
        
        // v2.0: 计算搞定率
        const resolvedCount = windowAnchors.filter(a => a.status === 'resolved').length;
        const totalCount = windowAnchors.length;
        const resolvedRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
        
        return {
          rank: 0, // 稍后设置
          timeRange: formatTimeRange(startMs, endMs),
          startMs,
          endMs,
          count: studentMap.size,
          content: content || '(无转录内容)',
          students: Array.from(studentMap.values()),
          studentIds: Array.from(studentMap.keys()),
          possibleReason: inferPossibleReason(studentMap.size, content),
          anchors: windowAnchors,
          resolvedCount,
          resolvedRate,
        };
      })
      // 按困惑人数降序排序
      .sort((a, b) => b.count - a.count)
      // 取前N个
      .slice(0, topN)
      // 设置排名
      .map((hotspot, index) => ({
        ...hotspot,
        rank: index + 1,
      }));
    
    return hotspots;
  },

  /**
   * 获取指定时间范围的转录内容
   */
  getTranscriptContent(
    transcripts: TranscriptSegment[],
    startMs: number,
    endMs: number
  ): string {
    const relevantSegments = transcripts.filter(
      t => t.startMs < endMs && t.endMs > startMs
    );
    
    if (relevantSegments.length === 0) return '';
    
    return relevantSegments
      .sort((a, b) => a.startMs - b.startMs)
      .map(t => t.text)
      .join(' ')
      .slice(0, 200); // 限制长度
  },

  /**
   * 获取完整的课堂数据 (教师端主要接口)
   */
  async getClassroomData(sessionId: string): Promise<ClassroomData | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;
    
    const anchors = this.getSessionAnchors(sessionId);
    
    // 从 IndexedDB 获取转录内容
    const dbTranscripts = await db.transcripts
      .where('sessionId')
      .equals(sessionId)
      .sortBy('startMs');
    
    // 转换为 TranscriptSegment 类型
    const transcripts: TranscriptSegment[] = dbTranscripts.map(t => ({
      id: String(t.id ?? ''),
      text: t.text,
      startMs: t.startMs,
      endMs: t.endMs,
      confidence: t.confidence,
      isFinal: t.isFinal,
    }));
    
    const hotspots = this.aggregateHotspots(sessionId, transcripts);
    
    // 统计数据
    const studentIds = new Set(anchors.map(a => a.studentId));
    const unresolvedCount = anchors.filter(a => a.status === 'active').length;
    
    // 找出困惑高峰时间
    let peakTime: number | undefined;
    if (hotspots.length > 0) {
      peakTime = hotspots[0].startMs;
    }
    
    return {
      session,
      anchors,
      transcripts,
      hotspots,
      statistics: {
        totalStudents: studentIds.size,
        totalAnchors: anchors.length,
        unresolvedCount,
        peakConfusionTime: peakTime,
      },
    };
  },

  // ============ 跨标签页同步 ============

  /**
   * 广播困惑点更新 (使用 BroadcastChannel)
   */
  broadcastAnchorUpdate(action: 'add' | 'cancel' | 'resolve', anchor: StudentAnchor): void {
    if (typeof window === 'undefined') return;
    
    try {
      const channel = new BroadcastChannel('meetmind_classroom_sync');
      channel.postMessage({
        type: 'ANCHOR_UPDATE',
        action,
        anchor,
        timestamp: Date.now(),
      });
      channel.close();
    } catch {
      // BroadcastChannel 不支持时静默失败
    }
  },

  /**
   * 监听困惑点更新 (教师端使用)
   */
  onAnchorUpdate(callback: (action: string, anchor: StudentAnchor) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    
    try {
      const channel = new BroadcastChannel('meetmind_classroom_sync');
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'ANCHOR_UPDATE') {
          callback(event.data.action, event.data.anchor);
        }
      };
      
      channel.addEventListener('message', handler);
      
      // 返回清理函数
      return () => {
        channel.removeEventListener('message', handler);
        channel.close();
      };
    } catch {
      return () => {};
    }
  },

  // ============ 数据清理 ============

  /**
   * 清除课程数据
   */
  clearSessionData(sessionId: string): void {
    // 清除困惑点
    const anchors = getAllAnchorsFromStorage();
    const filtered = anchors.filter(a => a.sessionId !== sessionId);
    saveAnchorsToStorage(filtered);
    
    // 清除会话
    const sessions = getAllSessionsFromStorage();
    const filteredSessions = sessions.filter(s => s.id !== sessionId);
    saveSessionsToStorage(filteredSessions);
  },

  /**
   * 清除所有数据
   */
  clearAllData(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(ANCHORS_KEY);
    localStorage.removeItem(SESSIONS_KEY);
  },

  // ============ 兼容旧版 anchor-service ============

  /**
   * 从旧版 anchor-service 迁移数据
   * 用于兼容已有的学生端数据
   */
  migrateFromLegacyAnchorService(
    sessionId: string,
    studentId: string,
    studentName: string
  ): number {
    const legacyKey = `meetmind_anchors_${sessionId}`;
    if (typeof window === 'undefined') return 0;
    
    try {
      const legacyData = localStorage.getItem(legacyKey);
      if (!legacyData) return 0;
      
      const legacyAnchors = JSON.parse(legacyData);
      const existingAnchors = getAllAnchorsFromStorage();
      const existingIds = new Set(existingAnchors.map(a => a.id));
      
      let migratedCount = 0;
      
      legacyAnchors.forEach((legacy: {
        id: string;
        sessionId: string;
        studentId: string;
        timestamp: number;
        type: AnchorType;
        cancelled: boolean;
        resolved: boolean;
        createdAt: string;
        note?: string;
      }) => {
        // 跳过已迁移的
        if (existingIds.has(legacy.id)) return;
        
        const anchor: StudentAnchor = {
          id: legacy.id,
          sessionId: legacy.sessionId,
          studentId: studentId, // 使用真实用户ID
          studentName: studentName,
          timestamp: legacy.timestamp,
          type: legacy.type,
          status: legacy.cancelled ? 'cancelled' : (legacy.resolved ? 'resolved' : 'active'),
          note: legacy.note,
          createdAt: legacy.createdAt,
          updatedAt: legacy.createdAt,
        };
        
        existingAnchors.push(anchor);
        migratedCount++;
      });
      
      if (migratedCount > 0) {
        saveAnchorsToStorage(existingAnchors);
      }
      
      return migratedCount;
    } catch {
      return 0;
    }
  },

  // ============ 演示数据 ============

  /**
   * 获取演示数据的转录内容
   * 用于教师端在没有真实数据时显示统一的演示数据
   */
  getDemoTranscripts(): TranscriptSegment[] {
    return DEMO_SEGMENTS;
  },

  /**
   * 获取演示数据的困惑点
   */
  getDemoAnchors(): StudentAnchor[] {
    return DEMO_ANCHORS.map(anchor => ({
      id: anchor.id,
      sessionId: anchor.sessionId,
      studentId: anchor.studentId,
      studentName: '演示学生',
      timestamp: anchor.timestamp,
      type: anchor.type,
      status: anchor.resolved ? 'resolved' : (anchor.cancelled ? 'cancelled' : 'active'),
      createdAt: anchor.createdAt,
      updatedAt: anchor.createdAt,
    }));
  },

  /**
   * 获取演示数据的课程会话ID
   */
  getDemoSessionId(): string {
    return DEMO_SESSION_ID;
  },

  /**
   * 获取演示数据的困惑热点
   * 基于 DEMO_SEGMENTS 和 DEMO_ANCHORS 生成
   */
  getDemoHotspots(): ConfusionHotspot[] {
    const transcripts = DEMO_SEGMENTS;
    const anchors = this.getDemoAnchors();
    
    // 按时间窗口分组 (30秒)
    const windowSize = 30000;
    const windowMap = new Map<number, StudentAnchor[]>();
    
    anchors.forEach(anchor => {
      const windowStart = Math.floor(anchor.timestamp / windowSize) * windowSize;
      if (!windowMap.has(windowStart)) {
        windowMap.set(windowStart, []);
      }
      windowMap.get(windowStart)!.push(anchor);
    });
    
    // 转换为热点数据
    const hotspots: ConfusionHotspot[] = Array.from(windowMap.entries())
      .map(([startMs, windowAnchors]) => {
        const endMs = startMs + windowSize;
        
        // 获取该时间段的转录内容
        const content = this.getTranscriptContent(transcripts, startMs, endMs);
        
        // 去重学生
        const studentMap = new Map<string, string>();
        windowAnchors.forEach(a => {
          studentMap.set(a.studentId, a.studentName);
        });
        
        // v2.0: 计算搞定率
        const resolvedCount = windowAnchors.filter(a => a.status === 'resolved').length;
        const totalCount = windowAnchors.length;
        const resolvedRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
        
        return {
          rank: 0,
          timeRange: formatTimeRange(startMs, endMs),
          startMs,
          endMs,
          count: studentMap.size,
          content: content || '(无转录内容)',
          students: Array.from(studentMap.values()),
          studentIds: Array.from(studentMap.keys()),
          possibleReason: inferPossibleReason(studentMap.size, content),
          anchors: windowAnchors,
          resolvedCount,
          resolvedRate,
        };
      })
      .sort((a, b) => b.count - a.count)
      .map((hotspot, index) => ({
        ...hotspot,
        rank: index + 1,
      }));
    
    return hotspots;
  },
};

export default classroomDataService;
