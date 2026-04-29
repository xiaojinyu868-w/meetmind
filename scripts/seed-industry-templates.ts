/**
 * Seed: Academic Service OS 预置 OrgIndustryTemplate
 *
 * 运行：npx tsx scripts/seed-industry-templates.ts
 *
 * 6 个起点模板：申博 / 保研 / 留学 / 论文 / 竞赛 / 空白
 * 每个带推荐场景清单（机构 onboarding 第 4 步用）+ seed playbook 骨架
 *
 * 详见 specs/academic-service-v0/multi-tenant-contract.md
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'prisma/meetmind.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

interface RecommendedScenario {
  name: string;
  description: string;
  productKind: 'practice' | 'review' | 'qa' | 'mock-interview' | 'material-polish';
  personaSeed: {
    tone: 'gentle' | 'direct' | 'probing' | 'structured';
    style: 'socratic' | 'mentor' | 'interviewer' | 'reviewer';
    feedbackAxes: string[];
    forbiddenZones: string[];
  };
  studentInputSchema: Array<{ key: string; label: string; kind: 'text' | 'textarea' | 'url'; required: boolean; placeholder?: string }>;
}

const templates: Array<{
  id: string;
  displayName: string;
  description: string;
  recommendedScenarios: RecommendedScenario[];
  seedPlaybook: string;
}> = [
  {
    id: 'shenbo',
    displayName: '申博 / 博士申请',
    description: '面向 PhD 申请辅导机构：导师匹配、套磁、研究计划、博士面试、CV 体检',
    recommendedScenarios: [
      {
        name: '博士面试模拟',
        description: '按目标项目与导师偏好进行一轮博士面试，重点打磨研究动机与深度',
        productKind: 'mock-interview',
        personaSeed: {
          tone: 'direct',
          style: 'interviewer',
          feedbackAxes: ['研究深度', '表达清晰度', '学术规范', '动机匹配'],
          forbiddenZones: ['不替学生决定投哪所学校', '不给出最终录取概率预测'],
        },
        studentInputSchema: [
          { key: 'target_program', label: '目标项目', kind: 'text', required: true, placeholder: 'CMU CS PhD' },
          { key: 'research_direction', label: '研究方向', kind: 'textarea', required: true },
          { key: 'focus_paper', label: '最想聊的论文（可选）', kind: 'text', required: false },
        ],
      },
      {
        name: '套磁信打磨',
        description: '围绕一封套磁草稿，按机构话术标准逐段反馈',
        productKind: 'material-polish',
        personaSeed: {
          tone: 'structured',
          style: 'reviewer',
          feedbackAxes: ['开场契合度', '研究展示', '互动意愿', '语言专业度'],
          forbiddenZones: ['不改动学生的核心研究观点'],
        },
        studentInputSchema: [
          { key: 'draft', label: '套磁信草稿', kind: 'textarea', required: true },
          { key: 'target_prof', label: '目标导师姓名 / 学校', kind: 'text', required: true },
        ],
      },
      {
        name: '研究计划会谈陪练',
        description: '模拟与导师讨论研究计划的过程，训练表达和回应追问',
        productKind: 'practice',
        personaSeed: {
          tone: 'probing',
          style: 'socratic',
          feedbackAxes: ['问题意识', '逻辑链条', '方法选择合理性', '可行性'],
          forbiddenZones: ['不替学生确定最终研究题目'],
        },
        studentInputSchema: [
          { key: 'proposal_summary', label: '研究计划摘要', kind: 'textarea', required: true },
        ],
      },
      {
        name: '导师匹配诊断',
        description: '根据学生背景与方向给出导师初筛建议',
        productKind: 'qa',
        personaSeed: {
          tone: 'gentle',
          style: 'mentor',
          feedbackAxes: ['方向匹配度', '学校层次', '导师风格', '录取可能性'],
          forbiddenZones: ['不保证录取'],
        },
        studentInputSchema: [
          { key: 'background', label: '学术背景概述', kind: 'textarea', required: true },
          { key: 'interest', label: '研究兴趣', kind: 'textarea', required: true },
        ],
      },
      {
        name: 'CV 体检',
        description: '逐条检查 CV 的学术适配度、留白与冗余',
        productKind: 'review',
        personaSeed: {
          tone: 'direct',
          style: 'reviewer',
          feedbackAxes: ['条目选择', '量化表达', '学术相关性', '排版'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'cv_text', label: 'CV 全文', kind: 'textarea', required: true },
        ],
      },
    ],
    seedPlaybook: `# 申博辅导 playbook（种子版本）

> 这是系统预置骨架，请机构替换为自己的真实经验。

## 交付主线
1. 目标与动机梳理
2. 导师与项目初筛
3. CV / PS / RP 打磨
4. 套磁
5. 面试训练
6. Offer 决策陪伴

## 核心判断点
- 学生是否清楚自己要解决什么问题
- 研究兴趣与目标导师实验室的真实匹配度
- 表达能否撑住真实面试压力

## 禁区
- 不替学生决定投哪所学校
- 不承诺录取概率
`,
  },
  {
    id: 'baoyan',
    displayName: '保研 / 国内直博',
    description: '面向国内保研/直博辅导机构：背景评估、项目匹配、材料诊断、夏令营/预推免面试',
    recommendedScenarios: [
      {
        name: '保研面试训练',
        description: '按目标院校面试风格进行模拟',
        productKind: 'mock-interview',
        personaSeed: {
          tone: 'direct',
          style: 'interviewer',
          feedbackAxes: ['专业基础', '科研潜质', '表达条理', '抗压'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'target_school', label: '目标院校 / 专业', kind: 'text', required: true },
          { key: 'known_questions', label: '已知常考问题（可选）', kind: 'textarea', required: false },
        ],
      },
      {
        name: '个人陈述打磨',
        description: '保研 PS 逐段反馈',
        productKind: 'material-polish',
        personaSeed: {
          tone: 'structured',
          style: 'reviewer',
          feedbackAxes: ['成长故事', '专业兴趣', '未来规划'],
          forbiddenZones: [],
        },
        studentInputSchema: [{ key: 'draft', label: 'PS 草稿', kind: 'textarea', required: true }],
      },
    ],
    seedPlaybook: `# 保研辅导 playbook（种子版本）\n\n机构请填充自己的真实 SOP / 优秀样本 / 高频面试题。`,
  },
  {
    id: 'liuxue',
    displayName: '留学申请',
    description: '面向硕士/本科留学申请机构：选校定位、PS/CV 诊断、申请节奏、面试训练',
    recommendedScenarios: [
      {
        name: 'PS 打磨',
        description: '按目标项目口径对 Personal Statement 逐段反馈',
        productKind: 'material-polish',
        personaSeed: {
          tone: 'structured',
          style: 'reviewer',
          feedbackAxes: ['主题一致性', '独特性', '目标匹配', '语言'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'draft', label: 'PS 草稿', kind: 'textarea', required: true },
          { key: 'target_programs', label: '目标项目列表', kind: 'textarea', required: true },
        ],
      },
      {
        name: '硕士面试模拟',
        description: 'MBA / MSc / MPP 面试训练',
        productKind: 'mock-interview',
        personaSeed: {
          tone: 'direct',
          style: 'interviewer',
          feedbackAxes: ['动机', '职业规划', '专业基础', '国际视野'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'target_program', label: '目标项目', kind: 'text', required: true },
        ],
      },
    ],
    seedPlaybook: `# 留学申请 playbook（种子版本）\n\n机构请填充自己的选校矩阵、PS/CV 优秀样本、面试高频题。`,
  },
  {
    id: 'lunwen',
    displayName: '论文 / 开题 / 答辩辅导',
    description: '面向论文辅导机构：选题、文献综述、方法论、答辩、审稿意见回复',
    recommendedScenarios: [
      {
        name: '审稿意见回复训练',
        description: '对着审稿意见练习回应与修改说明',
        productKind: 'practice',
        personaSeed: {
          tone: 'direct',
          style: 'reviewer',
          feedbackAxes: ['回应充分性', '修改落地', '学术礼仪'],
          forbiddenZones: ['不替学生决定是否撤稿'],
        },
        studentInputSchema: [
          { key: 'review_comments', label: '审稿意见原文', kind: 'textarea', required: true },
          { key: 'my_response_draft', label: '我的回复草稿（可选）', kind: 'textarea', required: false },
        ],
      },
      {
        name: '开题答辩模拟',
        description: '模拟开题评审的问答',
        productKind: 'mock-interview',
        personaSeed: {
          tone: 'probing',
          style: 'interviewer',
          feedbackAxes: ['选题意义', '文献扎实度', '方法可行性', '创新性'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'proposal_summary', label: '开题摘要', kind: 'textarea', required: true },
        ],
      },
      {
        name: '文献综述结构打磨',
        description: '反馈文献综述的结构与叙事',
        productKind: 'review',
        personaSeed: {
          tone: 'structured',
          style: 'reviewer',
          feedbackAxes: ['结构层次', '脉络', '立论', '覆盖度'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'draft', label: '综述草稿', kind: 'textarea', required: true },
        ],
      },
    ],
    seedPlaybook: `# 论文辅导 playbook（种子版本）\n\n机构请填充自己的审稿经验、优秀样本与方法论标准。`,
  },
  {
    id: 'jingsai',
    displayName: '竞赛 / 科研训练',
    description: '面向竞赛培训与科研训练机构：能力诊断、训练计划、样例拆解、复盘任务',
    recommendedScenarios: [
      {
        name: '竞赛复盘',
        description: '对一次比赛表现做复盘与下一步训练建议',
        productKind: 'review',
        personaSeed: {
          tone: 'direct',
          style: 'mentor',
          feedbackAxes: ['思路', '执行', '时间分配', '后续改进'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'competition', label: '比赛名称', kind: 'text', required: true },
          { key: 'self_reflection', label: '自我复盘（可选）', kind: 'textarea', required: false },
        ],
      },
      {
        name: '样例拆解陪练',
        description: '带学生拆解一个经典赛题或样例',
        productKind: 'practice',
        personaSeed: {
          tone: 'probing',
          style: 'socratic',
          feedbackAxes: ['问题分解', '知识迁移', '表达'],
          forbiddenZones: [],
        },
        studentInputSchema: [
          { key: 'problem', label: '题目 / 样例', kind: 'textarea', required: true },
        ],
      },
    ],
    seedPlaybook: `# 竞赛 / 科研训练 playbook（种子版本）\n\n机构请填充自己的训练体系、样题集与评分标准。`,
  },
  {
    id: 'blank',
    displayName: '空白 / 自定义行业',
    description: '从零开始构建自己的场景，不带任何预设',
    recommendedScenarios: [],
    seedPlaybook: `# Playbook（空白模板）\n\n从零开始写你的服务流程、案例与话术。`,
  },
];

async function main() {
  // eslint-disable-next-line no-console
  console.log('[seed] 开始写入 OrgIndustryTemplate...');

  for (const t of templates) {
    await prisma.orgIndustryTemplate.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        displayName: t.displayName,
        description: t.description,
        recommendedScenarios: JSON.stringify(t.recommendedScenarios),
        seedPlaybook: t.seedPlaybook,
      },
      update: {
        displayName: t.displayName,
        description: t.description,
        recommendedScenarios: JSON.stringify(t.recommendedScenarios),
        seedPlaybook: t.seedPlaybook,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${t.id}  ${t.displayName}`);
  }

  // eslint-disable-next-line no-console
  console.log('[seed] 完成，共写入', templates.length, '个模板');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] 失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
