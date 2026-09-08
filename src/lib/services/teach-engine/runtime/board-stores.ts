/**
 * 板上状态 store 三合一 —— 合并晋升 spike 的 store/canvas + whiteboard-history +
 * media-generation shim（out/tutor-engine-spike/src/shims/lib/store/*）。
 *
 * 与 spike 的差异：spike 是模块级单例 + 全局 setXxxRecorder（单 spike 进程一线程
 * 没问题，主路多线程并发会串板）；这里 `createBoardStores(recorder)` 工厂按线程
 * 构造，实例经 ActionEngine 构造参数注入（engine.ts 的 [ADAPT vs upstream] 点）。
 *
 * 三个 store 的职责（engine.ts 的实际消费面）：
 * - canvas：spotlight/laser 特效、whiteboardOpen/clearing、视频播放状态
 * - history：wb_clear 前的快照存根
 * - mediaGeneration：play_video 的媒体任务表（v1 无视频场景，恒空）
 */

export interface SpotlightState {
  elementId: string;
  dimness: number;
}

export interface LaserState {
  elementId: string;
  color: string;
}

export interface CanvasState {
  whiteboardOpen: boolean;
  whiteboardClearing: boolean;
  spotlight: SpotlightState | null;
  laser: LaserState | null;
  playingVideoElementId: string | null;
  setWhiteboardOpen(open: boolean): void;
  setWhiteboardClearing(clearing: boolean): void;
  setSpotlight(elementId: string, opts: { dimness?: number }): void;
  setLaser(elementId: string, opts: { color?: string }): void;
  clearAllEffects(): void;
  playVideo(elementId: string): void;
  pauseVideo(): void;
}

export interface CanvasStore {
  getState(): CanvasState;
  subscribe(l: (s: CanvasState) => void): () => void;
}

export interface WhiteboardHistoryStore {
  getState(): { pushSnapshot(elements: unknown[]): void };
}

export interface MediaTask {
  status: 'pending' | 'done' | 'failed';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MediaGenerationStore {
  getState(): { tasks: Record<string, MediaTask> };
  subscribe(cb: (state: { tasks: Record<string, MediaTask> }) => void): () => void;
}

export interface BoardStores {
  canvas: CanvasStore;
  history: WhiteboardHistoryStore;
  mediaGeneration: MediaGenerationStore;
}

export type BoardRecorder = (kind: string, detail: Record<string, unknown>) => void;

const NOOP: BoardRecorder = () => {};

export function createBoardStores(recorder: BoardRecorder = NOOP): BoardStores {
  let canvasState: CanvasState;
  const listeners = new Set<(s: CanvasState) => void>();
  const setState = (partial: Partial<CanvasState>) => {
    canvasState = { ...canvasState, ...partial };
    for (const l of listeners) l(canvasState);
  };

  canvasState = {
    whiteboardOpen: false,
    whiteboardClearing: false,
    spotlight: null,
    laser: null,
    playingVideoElementId: null,
    setWhiteboardOpen(open: boolean) {
      setState({ whiteboardOpen: open });
      recorder('board.setOpen', { open });
    },
    setWhiteboardClearing(clearing: boolean) {
      setState({ whiteboardClearing: clearing });
      recorder('board.setClearing', { clearing });
    },
    setSpotlight(elementId: string, opts: { dimness?: number }) {
      setState({ spotlight: { elementId, dimness: opts.dimness ?? 0.5 } });
      recorder('fx.spotlight.on', { elementId });
    },
    setLaser(elementId: string, opts: { color?: string }) {
      setState({ laser: { elementId, color: opts.color ?? '#ff0000' } });
      recorder('fx.laser.on', { elementId });
    },
    clearAllEffects() {
      const had = canvasState.spotlight || canvasState.laser;
      setState({ spotlight: null, laser: null });
      if (had) recorder('fx.clear', {});
    },
    playVideo(elementId: string) {
      setState({ playingVideoElementId: elementId });
      recorder('video.play', { elementId });
    },
    pauseVideo() {
      setState({ playingVideoElementId: null });
      recorder('video.pause', {});
    },
  };

  const canvas: CanvasStore = {
    getState: () => canvasState,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };

  const history: WhiteboardHistoryStore = {
    getState: () => ({
      pushSnapshot(elements: unknown[]) {
        recorder('board.snapshot', { elementCount: elements.length });
      },
    }),
  };

  const mediaGeneration: MediaGenerationStore = {
    getState: () => ({ tasks: {} }),
    subscribe: () => () => {},
  };

  return { canvas, history, mediaGeneration };
}
