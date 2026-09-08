/**
 * 每线程内存 stage store —— vendor ActionEngine 依赖的板书存储接口实现。
 *
 * 晋升自 spike shim（out/tutor-engine-spike/src/shims/lib/api/stage-api.ts），
 * 关键修正：去掉模块级全局 `setStageRecorder`（多线程并发时后到的线程会覆盖
 * recorder，板书事件串线——P1 蓝图点名的事故源），改为
 * `createThreadStageStore(threadId, recorder)` 构造注入；engine.ts 内部调用的
 * `createStageAPI(store)` 通过 WeakMap 找回该 store 所属的 recorder。
 *
 * engine.ts 只用 whiteboard 命名空间的 get/addElement/update/getElement/
 * updateElement/deleteElement，以及 StageStore.getState()（resolveActionVideoMedia
 * 用，v1 无 slide 场景，恒返回空 scenes）。
 */

export interface WhiteboardElement {
  id: string;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface WhiteboardData {
  id: string;
  elements: WhiteboardElement[];
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StageSceneStub {
  id: string;
  content: {
    type: string;
    canvas: { elements: Array<{ id: string; type: string }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface StageState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stage: any;
  scenes: StageSceneStub[];
  currentSceneId: string | null;
}

export interface StageStore {
  getState(): StageState;
  subscribe?(cb: (state: StageState) => void): () => void;
}

/** 板书/特效变更回调（服务层据此把落板确认转成 tool-result 事件） */
export type StageRecorder = (kind: string, detail: Record<string, unknown>) => void;

export interface ThreadStageStore extends StageStore {
  readonly threadId: string;
  readonly whiteboard: WhiteboardData;
}

/** store → recorder 的归属表（WeakMap 按 store 实例键控，无线程串线） */
const recorders = new WeakMap<StageStore, StageRecorder>();

const NOOP_RECORDER: StageRecorder = () => {};

export function createThreadStageStore(threadId: string, recorder: StageRecorder): ThreadStageStore {
  const whiteboard: WhiteboardData = { id: `wb_${threadId}`, elements: [] };
  const state: StageState = { stage: { id: `stage_${threadId}` }, scenes: [], currentSceneId: null };
  const store: ThreadStageStore = {
    threadId,
    whiteboard,
    getState: () => state,
  };
  recorders.set(store, recorder);
  return store;
}

export function createStageAPI(store: StageStore) {
  const wb = () => (store as ThreadStageStore).whiteboard;
  const recorder = recorders.get(store) ?? NOOP_RECORDER;

  return {
    whiteboard: {
      get(): ApiResult<WhiteboardData> {
        return { success: true, data: wb() };
      },
      addElement(element: WhiteboardElement, _wbId: string): ApiResult<WhiteboardElement> {
        wb().elements.push(element);
        recorder('board.addElement', {
          elementType: element.type,
          id: element.id,
          element: summarize(element),
        });
        return { success: true, data: element };
      },
      update(patch: Partial<WhiteboardData>, _wbId: string): ApiResult<WhiteboardData> {
        Object.assign(wb(), patch);
        recorder('board.update', { elements: wb().elements.length });
        return { success: true, data: wb() };
      },
      getElement(elementId: string, _wbId: string): ApiResult<WhiteboardElement | undefined> {
        const el = wb().elements.find((e) => e.id === elementId);
        return el ? { success: true, data: el } : { success: false, error: 'not found' };
      },
      updateElement(element: WhiteboardElement, _wbId: string): ApiResult<WhiteboardElement> {
        const els = wb().elements;
        const idx = els.findIndex((e) => e.id === element.id);
        if (idx === -1) return { success: false, error: 'not found' };
        els[idx] = element;
        recorder('board.updateElement', { elementType: element.type, id: element.id });
        return { success: true, data: element };
      },
      deleteElement(elementId: string, _wbId: string): ApiResult<void> {
        const els = wb().elements;
        const idx = els.findIndex((e) => e.id === elementId);
        if (idx === -1) return { success: false, error: 'not found' };
        els.splice(idx, 1);
        recorder('board.deleteElement', { id: elementId });
        return { success: true };
      },
    },
  };
}

/** 板书元素摘要（事件/日志不整段 dump 内容） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarize(el: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof el.content === 'string') out.contentPreview = el.content.slice(0, 60);
  if (typeof el.latex === 'string') out.latex = el.latex;
  if (typeof el.shape === 'string') out.shape = el.shape;
  if (el.chartType) out.chartType = el.chartType;
  if (Array.isArray(el.data)) out.tableRows = el.data.length;
  if (Array.isArray(el.lines)) out.codeLines = el.lines.length;
  if (typeof el.start === 'object') out.line = true;
  return out;
}
