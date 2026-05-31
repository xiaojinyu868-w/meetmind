'use client';

/**
 * useShareAgentCreator — 一键创建 SharedAgent 并弹出 ShareAgentCard 的钩子（v3.0）
 *
 * 用法：
 *   const { openCreator, modal } = useShareAgentCreator();
 *   <button onClick={() => openCreator(snapshot)}>分享</button>
 *   {modal}
 *
 * 内部流程：
 *   openCreator(snapshot)
 *     → POST /api/share/agent
 *     → 拿到 token + shareUrl
 *     → 弹出 ShareAgentCard（用户可保存 / 系统分享 / 复制）
 *
 * 鉴权：未登录会 toast 提示；登录后自动带 Authorization header。
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { ShareAgentCard, type ShareAgentCardData } from './ShareAgentCard';
import type { SharedAgentSnapshot } from '@/lib/services/share-agent-service';

export interface UseShareAgentCreatorReturn {
  /** 是否正在调用 /api/share/agent */
  isCreating: boolean;
  /** 触发创建并打开分享卡 */
  openCreator: (
    snapshot: SharedAgentSnapshot,
    options?: {
      hookLine?: string;
      /** 完整 artifact payload —— 让 ShareAgentCard 能按 artifactKind 画产物本身 */
      artifactPayload?: unknown;
    },
  ) => Promise<void>;
  /** 渲染 modal（在父组件 JSX 末尾插一行 `{modal}`） */
  modal: React.ReactNode;
}

interface ActiveCard extends ShareAgentCardData {
  token: string;
}

export function useShareAgentCreator(): UseShareAgentCreatorReturn {
  const { isAuthenticated, accessToken } = useAuth();
  const [isCreating, setIsCreating] = React.useState(false);
  const [active, setActive] = React.useState<ActiveCard | null>(null);

  const openCreator = React.useCallback<UseShareAgentCreatorReturn['openCreator']>(
    async (snapshot, options) => {
      if (!isAuthenticated || !accessToken) {
        toast.error('先登录再分享');
        return;
      }
      setIsCreating(true);
      try {
        const res = await fetch('/api/share/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ snapshot }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { success: boolean; token: string; shareUrl: string };
        setActive({
          token: data.token,
          shareUrl: data.shareUrl,
          title: snapshot.title,
          subject: snapshot.subject,
          artifactKind: snapshot.artifactKind,
          sharerNickname: snapshot.sharerNickname,
          hookLine: options?.hookLine,
          artifactPayload: options?.artifactPayload,
        });
        toast.success(COPY.share.creator.doneTitle);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '创建分享失败';
        toast.error(msg);
      } finally {
        setIsCreating(false);
      }
    },
    [accessToken, isAuthenticated],
  );

  const handleClose = React.useCallback(() => setActive(null), []);

  const modal = active ? (
    <ShareAgentCard data={active} open onClose={handleClose} />
  ) : null;

  return { isCreating, openCreator, modal };
}
