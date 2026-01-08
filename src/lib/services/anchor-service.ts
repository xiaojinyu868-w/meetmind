/**
 * 断点标注服务
 * 
 * 管理学生在课堂中标记的困惑点
 */

export type AnchorType = 'confusion' | 'important' | 'question';

export interface Anchor {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: number;  // 课堂时间戳（毫秒）
  type: AnchorType;
  cancelled: boolean;
  resolved: boolean;
  createdAt: string;
  note?: string;
}

// 本地存储 key
const STORAGE_KEY = 'meetmind_anchors';

/**
 * 断点服务
 */
export const anchorService = {
  /**
   * 标记断点
   */
  mark(
    sessionId: string,
    studentId: string,
    timestamp: number,
    type: AnchorType = 'confusion'
  ): Anchor {
    const anchor: Anchor = {
      id: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      studentId,
      timestamp,
      type,
      cancelled: false,
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    // 保存到本地存储
    const anchors = this.getAll(sessionId);
    anchors.push(anchor);
    this.saveAll(sessionId, anchors);

    return anchor;
  },

  /**
   * 撤销断点（5秒内可撤销）
   */
  cancel(anchorId: string, sessionId: string): boolean {
    const anchors = this.getAll(sessionId);
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (!anchor) return false;
    
    // 检查是否在5秒内
    const elapsed = Date.now() - new Date(anchor.createdAt).getTime();
    if (elapsed > 5000) {
      return false;
    }

    anchor.cancelled = true;
    this.saveAll(sessionId, anchors);
    return true;
  },

  /**
   * 标记为已解决
   */
  resolve(anchorId: string, sessionId: string): void {
    const anchors = this.getAll(sessionId);
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (anchor) {
      anchor.resolved = true;
      this.saveAll(sessionId, anchors);
    }
  },

  /**
   * 获取会话的所有断点
   */
  getAll(sessionId: string): Anchor[] {
    if (typeof window === 'undefined') return [];
    
    try {
      const data = localStorage.getItem(`${STORAGE_KEY}_${sessionId}`);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  /**
   * 获取有效断点（未撤销的）
   */
  getActive(sessionId: string): Anchor[] {
    return this.getAll(sessionId).filter(a => !a.cancelled);
  },

  /**
   * 获取未解决的断点
   */
  getUnresolved(sessionId: string): Anchor[] {
    return this.getActive(sessionId).filter(a => !a.resolved);
  },

  /**
   * 保存所有断点
   */
  saveAll(sessionId: string, anchors: Anchor[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${STORAGE_KEY}_${sessionId}`, JSON.stringify(anchors));
  },

  /**
   * 清空会话断点
   */
  clear(sessionId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${STORAGE_KEY}_${sessionId}`);
  },

  /**
   * 添加备注
   */
  addNote(anchorId: string, sessionId: string, note: string): void {
    const anchors = this.getAll(sessionId);
    const anchor = anchors.find(a => a.id === anchorId);
    
    if (anchor) {
      anchor.note = note;
      this.saveAll(sessionId, anchors);
    }
  },
};
