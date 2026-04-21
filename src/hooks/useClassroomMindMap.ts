'use client';

/**
 * useClassroomMindMap — 录课中「思维导图」生长管线
 *
 * 设计意图：
 *   - 不追着用户跑：每 45s 对 /api/classroom/mindmap 拉一次完整树。
 *   - 合适时机加速：检测到老师说主题切换词（"接下来"/"好 下一个"/"那/另外/第二点"等）时，
 *     如果距离上次请求 ≥ 15s，就追加一次请求。
 *   - 预热保护：录音前 90s 不请求（后端也会挡），避免开场寒暄污染节点。
 *   - 去抖：上一次请求还没回时，新请求会先 abort 掉。
 *   - 稳定性：请求失败静默，保留上一次的树，不影响录音主流程。
 *
 * 返回：
 *   - tree：当前提炼出的整棵树（可能为空）
 *   - newNodeIds：最近一次 diff 中新增的节点 id 集合（用于 UI 做进入动画）
 *   - isSyncing：当前有无请求在途（UI 可以做细微提示，不强制）
 *
 * 不追求：
 *   - 不做 SSE 流式（完整树返回够快，增量并入的复杂度不值得）
 *   - 不做本地缓存持久化（刷新就重来，录课态本就是短会话）
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface MindMapNode {
  id: string;
  parentId: string | null;
  label: string;
  detail?: string;
  anchorMs: number;
}

export interface MindMapTree {
  title: string;
  nodes: MindMapNode[];
}

export interface UseClassroomMindMapInput {
  enabled: boolean;
  /** 从开录到现在的累计转录文本 */
  transcriptText: string | undefined;
  /** 从开录到现在的 interim（用于主题切换词嗅探） */
  interimText?: string;
  /** 录音开始时间戳（Date.now()）——用来算 elapsedMs */
  recordingStartAt: number | null;
  /** 当前课程标题（可选，给后端做上下文） */
  lessonTitle?: string;
  /** 课前预习材料关键词（可选） */
  importedHints?: string[];
}

export interface UseClassroomMindMapReturn {
  tree: MindMapTree;
  newNodeIds: Set<string>;
  isSyncing: boolean;
}

/** 两次请求最小间隔 */
const MIN_INTERVAL_MS = 45 * 1000;
/** 切换词触发后的最小间隔 */
const MIN_INTERVAL_BOOSTED_MS = 15 * 1000;
/** 第一次请求前的预热（后端也有，前端再兜一次）——30s 就开始，让用户早点看到东西 */
const MIN_ELAPSED_MS = 30 * 1000;
/** 主题切换词（命中即触发 boost） */
const TOPIC_SHIFT_WORDS = [
  '接下来',
  '下一个',
  '下一部分',
  '下一章',
  '另外',
  '再看',
  '再说',
  '然后呢',
  '好 那',
  '好，那',
  '那么',
  '第二点',
  '第三点',
  '第二个',
  '第三个',
  '讲下一',
  '我们看',
  '我们来看',
  '切换',
  '换一个',
  '补充一下',
];

const EMPTY_TREE: MindMapTree = { title: '', nodes: [] };

export function useClassroomMindMap({
  enabled,
  transcriptText,
  interimText,
  recordingStartAt,
  lessonTitle,
  importedHints,
}: UseClassroomMindMapInput): UseClassroomMindMapReturn {
  const [tree, setTree] = useState<MindMapTree>(EMPTY_TREE);
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  const lastRequestAtRef = useRef<number>(0);
  const lastTriggerWasBoostRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  const priorTreeRef = useRef<MindMapTree>(EMPTY_TREE);

  // 关闭时清理
  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setTree(EMPTY_TREE);
      setNewNodeIds(new Set());
      setIsSyncing(false);
      lastRequestAtRef.current = 0;
      lastTriggerWasBoostRef.current = false;
      priorTreeRef.current = EMPTY_TREE;
    }
  }, [enabled]);

  // 新一节课开始时也清空：recordingStartAt 每次开新录音都会变，
  // 这是区分"同一节续录"和"开新课"的最可靠信号。
  // 如果没这一步，上一节课留下的思维导图会泄漏到新课开头，
  // 用户体感是"我刚点开始，怎么已经有一张别人的图了"。
  useEffect(() => {
    if (!enabled) return;
    if (!recordingStartAt) return;
    setTree(EMPTY_TREE);
    setNewNodeIds(new Set());
    lastRequestAtRef.current = 0;
    lastTriggerWasBoostRef.current = false;
    priorTreeRef.current = EMPTY_TREE;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingStartAt]);

  // 主题切换词嗅探（只看 interim + 最后 40 字的 transcript）
  const topicShiftDetected = useMemo(() => {
    if (!enabled) return false;
    const tail = (transcriptText || '').slice(-60);
    const combined = `${tail}${interimText ?? ''}`;
    return TOPIC_SHIFT_WORDS.some((kw) => combined.includes(kw));
  }, [enabled, transcriptText, interimText]);

  // 组装请求 effect：触发一次拉取
  useEffect(() => {
    if (!enabled) return;
    if (!recordingStartAt) return;
    if (!transcriptText || transcriptText.trim().length < 80) return;

    const elapsedMs = Date.now() - recordingStartAt;
    if (elapsedMs < MIN_ELAPSED_MS) return;

    const now = Date.now();
    const sinceLast = now - lastRequestAtRef.current;
    const isFirst = lastRequestAtRef.current === 0;
    const interval = topicShiftDetected ? MIN_INTERVAL_BOOSTED_MS : MIN_INTERVAL_MS;

    if (!isFirst && sinceLast < interval) return;
    if (abortRef.current) return; // 请求在途，跳过

    lastRequestAtRef.current = now;
    lastTriggerWasBoostRef.current = topicShiftDetected;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsSyncing(true);

    (async () => {
      try {
        const res = await fetch('/api/classroom/mindmap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcriptText: transcriptText.slice(-6000),
            elapsedMs,
            lessonTitle,
            priorTree:
              priorTreeRef.current.nodes.length > 0 ? priorTreeRef.current : undefined,
            importedHints,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { tree?: MindMapTree };
        if (!data.tree || !Array.isArray(data.tree.nodes)) return;

        // diff 出新节点
        const oldIds = new Set(priorTreeRef.current.nodes.map((n) => n.id));
        const newIds = new Set<string>();
        for (const n of data.tree.nodes) {
          if (!oldIds.has(n.id)) newIds.add(n.id);
        }

        priorTreeRef.current = data.tree;
        setTree(data.tree);
        setNewNodeIds(newIds);

        // 动画窗口：2 秒后清空 newNodeIds，让新节点淡入常态
        window.setTimeout(() => {
          setNewNodeIds((prev) => {
            if (prev.size === 0) return prev;
            return new Set();
          });
        }, 2000);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // 静默失败——保留上一棵树
      } finally {
        setIsSyncing(false);
        if (abortRef.current === ctrl) {
          abortRef.current = null;
        }
      }
    })();
  }, [
    enabled,
    transcriptText,
    topicShiftDetected,
    recordingStartAt,
    lessonTitle,
    importedHints,
  ]);

  return { tree, newNodeIds, isSyncing };
}
