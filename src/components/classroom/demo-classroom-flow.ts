import type { ClassroomFlowState } from '@/types/classroom-flow';

const MOMENTS = [
  {
    revealAtSec: 6,
    moment: {
      id: 'demo-opening',
      title: '进入搬家咨询的服务场景',
      summary: '搬家公司接起电话，先确认来电者需要什么帮助。',
      teachingMove: '建立对话场景',
      anchorMs: 0,
    },
  },
  {
    revealAtSec: 11,
    moment: {
      id: 'demo-uncertainty',
      title: '用 up in the air 表达“事情还没定”',
      summary: '这里不是“在空中”，而是搬家安排尚未确定、心里没有底。',
      teachingMove: '结合语境解释表达',
      anchorMs: 6_000,
    },
  },
  {
    revealAtSec: 25,
    moment: {
      id: 'demo-relocation',
      title: '交代下个月搬去美国的背景',
      summary: 'relocating 强调迁居或搬迁，比普通的 moving house 更正式。',
      teachingMove: '补充背景与词义',
      anchorMs: 17_000,
    },
  },
  {
    revealAtSec: 50,
    moment: {
      id: 'demo-listening-rule',
      title: '说明听力题只播放一次',
      summary: '接下来需要边听边抓信息，不能依赖第二次播放。',
      teachingMove: '说明任务规则',
      anchorMs: 42_000,
    },
  },
  {
    revealAtSec: 88,
    moment: {
      id: 'demo-form-details',
      title: '开始确认姓名、地址和电话',
      summary: '对话从背景说明进入表格信息填写，需要注意拼写和数字。',
      teachingMove: '从语境转入信息定位',
      anchorMs: 80_000,
    },
  },
] as const;

export function buildDemoClassroomFlow(seconds: number): {
  flow: ClassroomFlowState;
  newItemIds: Set<string>;
} {
  const visible = MOMENTS.filter((item) => seconds >= item.revealAtSec);
  if (visible.length === 0) {
    return {
      flow: { title: '', now: null, recent: [], keep: [], updatedAtMs: seconds * 1_000 },
      newItemIds: new Set(),
    };
  }

  const current = visible[visible.length - 1];
  const keep = [
    ...(seconds >= 11 ? [{
      id: 'demo-keep-up-in-air',
      kind: 'definition' as const,
      text: 'up in the air = 尚未决定、悬而未决',
      reason: '这类表达不能按字面翻译。',
      anchorMs: 6_000,
    }] : []),
    ...(seconds >= 25 ? [{
      id: 'demo-keep-relocate',
      kind: 'contrast' as const,
      text: 'relocate 比 move 更强调迁居或工作调动',
      anchorMs: 17_000,
    }] : []),
    ...(seconds >= 50 ? [{
      id: 'demo-keep-listening',
      kind: 'conclusion' as const,
      text: '单次播放的填表题要优先抓专名、地址和数字',
      anchorMs: 42_000,
    }] : []),
  ];

  return {
    flow: {
      title: "Australia's Moving Experience",
      now: { ...current.moment },
      recent: visible.slice(Math.max(0, visible.length - 4), -1).map((item) => ({ ...item.moment })),
      keep,
      updatedAtMs: seconds * 1_000,
    },
    newItemIds: new Set([
      current.moment.id,
      ...keep.filter((item) => item.anchorMs / 1_000 === current.revealAtSec).map((item) => item.id),
    ]),
  };
}
