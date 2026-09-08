/**
 * board-blocks — 结构化板书块动作（teach-engine 全量词表，P3 引入）。
 *
 * 从 board-script.ts 拆出（类型文件 300 行限制）；BoardAction 联合类型在
 * board-script.ts 聚合，这里放四个块动作的定义与 helper。
 *
 * 设计要点：
 * - vendor wb_draw_* 的绝对坐标（x/y/width/height，1000×562 幻灯坐标系）不进
 *   数据模型——v2 起排版收归播放器（流式版面零预计算坐标），坐标只在映射层
 *   换算成语义字段（shape 的宽高比 / line 的归一端点）。
 * - 块不占 wN 编号（countPageWrites 只数 write）；elementId 是引擎语义 id
 *   （spotlight/laser/wb_edit_code 的定位键），由服务端 ensureElementId 保证存在。
 * - 与 write 一样受 flattenPage 的 clear 截断（wb_clear 语义覆盖全部板面动作）。
 */

export interface BoardShapeAction {
  type: 'shape';
  shape: 'rectangle' | 'circle' | 'triangle';
  /** 宽高比（vendor width/height 换算，缺省/非法 → 渲染层用默认比例） */
  aspect?: number;
  /** 图形下方的标注文字（vendor 词表无此参数，预留） */
  label?: string;
  /** vendor fillColor 透传（缺省 = 备课本浅紫底填充） */
  fill?: string;
  /** 引擎语义 elementId（spotlight/laser 定位用） */
  elementId?: string;
}

export interface BoardTableAction {
  type: 'table';
  /** 二维文本，第一行表头（vendor wb_draw_table.data 同构） */
  data: string[][];
  elementId?: string;
}

export interface BoardLineAction {
  type: 'line';
  /** 端点（vendor 1000×562 虚拟坐标原样保留；渲染层归一到块内包围盒） */
  start: { x: number; y: number };
  end: { x: number; y: number };
  dashed?: boolean;
  /** 端点箭头（vendor points: ['','arrow'] 等四态归并） */
  arrow?: 'none' | 'start' | 'end' | 'both';
  label?: string;
  elementId?: string;
}

/** 代码行：行级稳定 id（wb_edit_code 的 lineId/lineIds 引用以它为准）。 */
export interface BoardCodeLine {
  id: string;
  content: string;
}

export interface BoardCodeAction {
  type: 'code';
  language: string;
  fileName?: string;
  /** 初始行 id = L1..Ln（与 vendor codeToLines 同规则，模型从词表描述学会引用） */
  lines: BoardCodeLine[];
  elementId?: string;
}

/** vendor codeToLines 同款：原始代码文本 → 行数组（L1..Ln）。 */
export function codeTextToLines(code: string): BoardCodeLine[] {
  return code.split('\n').map((content, index) => ({ id: `L${index + 1}`, content }));
}
