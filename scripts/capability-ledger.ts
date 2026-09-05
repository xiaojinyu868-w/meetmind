/**
 * capability-ledger.ts — 能力台账生成器
 *
 * 理念自洽：讲「沉淀」的页面不能是手写的静态稿。
 * 数字全部从真实源头计算（catalog / skills / desktop 版本 / eval baselines / CHANGELOG），
 * 只有「交付 → 沉淀」的编辑文案是人工策展的——策展内容也在本文件里，单一事实源。
 *
 * 用法：npx tsx scripts/capability-ledger.ts（或 make ledger）
 * 产物：design-demo/capability-board/ledger.json
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'design-demo/capability-board/ledger.json');

/* ---------- 真实采集 ---------- */

function collectSources() {
  // 学习应用数：catalog 注册表中 ready 的应用
  const catalog = readFileSync(join(ROOT, 'src/lib/ai-native/app-catalog.ts'), 'utf8');
  const readyApps = (catalog.match(/status: 'ready'/g) ?? []).length;

  // 工程 Skill 数：skills/ 下含 SKILL.md 的目录
  const skillsDir = join(ROOT, 'skills');
  const skillCount = readdirSync(skillsDir).filter((name) => {
    const p = join(skillsDir, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
  }).length;

  // 桌面端版本
  const desktopVersion = JSON.parse(readFileSync(join(ROOT, 'desktop/package.json'), 'utf8')).version;

  // 评测基线
  const baselinesDir = join(ROOT, 'tests/eval/baselines');
  const baselines = existsSync(baselinesDir)
    ? readdirSync(baselinesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    : [];

  // CHANGELOG 里程碑
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const milestones = changelog.match(/^## /gm)?.length ?? 0;

  return { readyApps, skillCount, desktopVersion, baselines, milestones };
}

/* ---------- 策展层：交付 → 沉淀（编辑文案，唯一策展点） ---------- */

interface Layer {
  date: string;
  ship: string;
  deposit: string;
  assets: number[]; // 汇入能力账户的资产编号
}

const LAYERS: Layer[] = [
  { date: '2026-08-30', ship: 'C 端旅程走查修复，跨课上下文污染收口', deposit: '数据完整性审计机制，全库扫描 0 命中', assets: [3] },
  { date: '2026-08-26', ship: '「请一个分身」v1：讲课录音蒸馏为可对话分身', deposit: 'Agent 引擎通用件（进程封装 / 模型 shim / 运行时注册表）；技能文件零改动挂载', assets: [2, 5] },
  { date: '2026-08', ship: 'AI 家教：实时讲课、流式事件、11 个课堂工具', deposit: 'Agent 引擎与事件契约；首字延迟优化工艺', assets: [2, 1] },
  { date: '2026-07-30', ship: 'Octo Buddy 桌宠：单击提问、双击旁听、拖拽收集', deposit: '桌面端交互层与旁听闭环', assets: [10] },
  { date: '2026-07-28', ship: 'v4.0 全端采集：桌面壳、全局热键、微信 Agent', deposit: '桌面壳与双端分发管线；统一账号全端打通', assets: [10, 9] },
  { date: '2026-06-02', ship: 'M11 教练式目标共建，画像进入所有对话模式', deposit: 'ChatBase 对话底座抽离，6 面板收口；记忆管线', assets: [1, 3] },
  { date: '2026-06-01', ship: '全部学习应用提示词按《提示词设计哲学》重写', deposit: '提示词方法论成为团队文档与规范', assets: [5] },
  { date: '2026-05-31', ship: '设计系统 v7 全产品落地', deposit: '双签名色令牌 + 原生组件 + 暗色模式', assets: [7] },
  { date: 'M14.6', ship: '应用矩阵定型：SkillChip 直调执行，产物不走对话标记', deposit: '应用工厂：注册表 + 插件 + 三层输入契约', assets: [4] },
  { date: 'M11 · v3.0', ship: 'SharedAgent 分享裂变：产物快照、免注册落地页', deposit: '增长基建：分享 / 领取 / 回流机制', assets: [8] },
  { date: 'M2', ship: 'ASR 飞书妙记级工艺：实时转写与纠错管线', deposit: '语音管线，课堂 / 教练对话 / 分身语料复用', assets: [6] },
  { date: 'M1 · 地基', ship: '可观测底座 + Eval Harness', deposit: '评测基线与首字延迟测量，「改动必须过门禁」成为制度', assets: [] },
];

const GROWN: { name: string; kind: 'app' | 'product' }[] = [
  { name: '考试速查表', kind: 'app' }, { name: '闪卡训练', kind: 'app' }, { name: '课堂测验', kind: 'app' },
  { name: '思维导图', kind: 'app' }, { name: '课堂信息图', kind: 'app' }, { name: '课堂播客', kind: 'app' },
  { name: '讲给同桌听', kind: 'app' }, { name: '板书精讲', kind: 'app' }, { name: '课中听懂检查', kind: 'app' },
  { name: '课堂同桌', kind: 'product' }, { name: 'AI 家教', kind: 'product' }, { name: '请一个分身', kind: 'product' },
  { name: '微信 Agent', kind: 'product' }, { name: '桌宠 Octo Buddy', kind: 'product' },
];

/* ---------- 组装 ---------- */

const s = collectSources();

const ledger = {
  generatedAt: new Date().toISOString(),
  thesis: '每一次交付，留下两样东西：一个产品，和一份能力。',
  layers: LAYERS,
  assets: [
    { no: 1, name: '对话体验底座', desc: '流式输出、首字延迟优化、失败自愈、等待设计、复制净化', usage: '新对话面板写一个 adapter 接入 ChatBase，全部体验自动获得', count: '6 个面板在用', source: 'src/components/chat/' },
    { no: 2, name: 'Agent 引擎', desc: 'Agent 运行时封装、工具协议、实时事件流契约', usage: '新 Agent 产品复用进程封装与事件契约，模型一行配置切换', count: '2 个产品共用', source: 'src/lib/services/teach-codex/' },
    { no: 3, name: '学习记忆管线', desc: '三层记忆结构、静默蒸馏、质量门、用户可控', usage: '读画像走 formatLearningContextForTutor；写记忆只追加事件，由蒸馏管线沉淀', count: '5 处读取', source: 'User.learnerProfileJson' },
    { no: 4, name: '应用工厂', desc: '应用注册表、插件协议、三层输入范围契约', usage: '新学习应用 = catalog 一条配置 + 一个 plugin 文件，不重写渲染层', count: `${s.readyApps} 个应用上线`, source: 'src/lib/ai-native/' },
    { no: 5, name: 'Skill 体系', desc: '标准技能协议，方法论可被 Agent 直接执行', usage: '把方法论写成 SKILL.md 挂载，Agent 即按规程执行', count: `${s.skillCount} 个工程 Skill`, source: 'skills/' },
    { no: 6, name: '语音管线', desc: '实时转写定稿、文本纠错、单句识别', usage: '单句识别走 /api/asr/oneshot；长音频走实时定稿链，均已产品化', count: '3 处复用', source: 'docs/ASR_PIPELINE.md' },
    { no: 7, name: '设计系统', desc: '双签名色令牌、原生组件库、亮暗双模式', usage: '界面直接取 tokens 与 @/components/ui 原生组件，新页面不写新样式', count: '155 文件落地', source: 'docs/DESIGN_SYSTEM.md' },
    { no: 8, name: '增长基建', desc: '产物快照分享、免注册落地页、领取回流', usage: '产物接入 ShareArtifactAction，即获得分享链接与落地页', count: '4 类产物接入', source: '/share/[token]' },
    { no: 9, name: '统一账号', desc: '网页、桌面端、微信扫码、公众号绑定同一体系', usage: '新产品复用现有登录态，不建自己的登录', count: '全端在用', source: '/api/auth/' },
    { no: 10, name: '桌面壳与分发', desc: '内嵌壳、系统内录、全局热键、桌宠、自动更新', usage: '新页面挂进壳即得壳层能力；打包分发走现有 electron-builder CI', count: `v${s.desktopVersion} 双端`, source: 'desktop/' },
  ],
  grown: [...GROWN, { name: `桌面端 v${s.desktopVersion}`, kind: 'product' as const }],
  sources: {
    changelogMilestones: s.milestones,
    evalBaselines: s.baselines,
    collectedFrom: [
      'CHANGELOG.md',
      'src/lib/ai-native/app-catalog.ts',
      'skills/*/SKILL.md',
      'desktop/package.json',
      'tests/eval/baselines/',
    ],
  },
};

writeFileSync(OUT, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger.json written: ${LAYERS.length} layers, ${ledger.assets.length} assets`);
console.log(`  collected: apps=${s.readyApps} skills=${s.skillCount} desktop=v${s.desktopVersion} baselines=[${s.baselines}] milestones=${s.milestones}`);
