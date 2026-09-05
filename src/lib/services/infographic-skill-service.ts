/**
 * 课堂信息图 skill 管线(单一真相)。
 *
 * 设计手册:宝玉 baoyu-infographic skill,原文零改动 vendor 在
 * `assets/infographic/baoyu-infographic/`(只随上游版本整体替换,不做局部改写)。
 *
 * 线上链路(2026-09 起):LLM 单次过整节课转录 → 按手册预设组装最终生图提示词 →
 * 生图模型(DashScope 优先,判定在 infographic-image-provider.ts)。
 * 风格/版式/画幅在这里预设死,LLM 不做选择题只做填空题;要换风格只改 INFOGRAPHIC_PRESET。
 *
 * 本模块只在服务端使用(读 skill 文件);被 studio-workshop 插件与
 * ai-control-service(管理员提示词预览/受控试跑)共用。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTerminologyHintBlock } from '@/lib/ai-native/prompt-context';
import type { StructuredAppPromptContext } from '@/lib/ai-native/app-prompts';

export const INFOGRAPHIC_PROMPT_VERSION = 'app-infographic-v2-skill';

/** 信息图预设:课堂场景实测最稳的组合(手绘教育风 + 便当格版式 + 横版,方便投屏展示) */
export const INFOGRAPHIC_PRESET = {
  style: 'hand-drawn-edu',
  layout: 'bento-grid',
  orientation: 'landscape' as const,
  aspectRatio: 'landscape 16:9 (1280x720)',
  language: 'Simplified Chinese (简体中文)',
  /** 给生图模型与前端 draft 看的风格标签 */
  stylePresetLabel: '手绘教育信息图,马卡龙色块,米白纸张质感',
};

const SKILL_DIR = path.join(process.cwd(), 'assets', 'infographic', 'baoyu-infographic');

export interface InfographicSkillMaterials {
  basePromptTemplate: string;
  styleGuide: string;
  layoutGuide: string;
}

let cachedMaterials: InfographicSkillMaterials | null = null;

/** 读 skill 手册材料(base 模板 + 预设风格 + 预设版式),进程内缓存,文件零改动 */
export function getInfographicSkillMaterials(): InfographicSkillMaterials {
  if (cachedMaterials) return cachedMaterials;
  cachedMaterials = {
    basePromptTemplate: readFileSync(path.join(SKILL_DIR, 'references', 'base-prompt.md'), 'utf8'),
    styleGuide: readFileSync(path.join(SKILL_DIR, 'references', 'styles', `${INFOGRAPHIC_PRESET.style}.md`), 'utf8'),
    layoutGuide: readFileSync(path.join(SKILL_DIR, 'references', 'layouts', `${INFOGRAPHIC_PRESET.layout}.md`), 'utf8'),
  };
  return cachedMaterials;
}

export function buildInfographicSkillSystemPrompt(): string {
  const materials = getInfographicSkillMaterials();
  return `你是一位教育信息设计师。把一节课提炼成"一张图带走"的横版信息图:先判断这节课最值得被看见的一个中心命题,再用极少文字呈现支撑它的结构。严格基于课堂证据,不编造老师金句、数字或关系。

视觉设计严格遵循以下设计手册(画风与版式已定,不要更换):

## 版式定义(固定使用)
${materials.layoutGuide}

## 画风定义(固定使用)
${materials.styleGuide}

只输出 JSON,不解释。`;
}

export function buildInfographicSkillUserPrompt(context: StructuredAppPromptContext): string {
  return `应用目标:${context.goalIntent || '生成一张图带走这节课'}
应用场景:学生复习时扫一眼,也可能投屏或分享到班级群;横版 16:9,视觉上先看到中心命题,再看到支撑要点。

输出 JSON:
{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "infographic": {
    "title": "信息图标题(≤14 字)",
    "subtitle": "副标题(≤28 字)",
    "keyPoints": ["3-5 个关键点,每条 ≤22 字"],
    "contentOutline": "图上每个格子的内容安排:hero 格放中心命题,其余格各放一个支撑要点(含一句≤40 字的说明);按系统提示的版式/画风定义描述每格配什么小插图",
    "textLabels": ["图上允许出现的全部中文文字,逐字列出:标题、副标题、每个关键点、每格说明"],
    "stylePreset": "${INFOGRAPHIC_PRESET.stylePresetLabel}",
    "suggestedScene": "class-take-away",
    "suggestedOrientation": "landscape",
    "suggestedDetailLevel": "standard"
  }
}

质量合同:
- 只保留一个中心命题和 3-5 个真正支撑它的要点;不要把整节课摘要塞进一张图
- textLabels 里的每一条都必须逐字来自课堂证据的提炼,图上除此之外不允许出现任何其他文字
- 老师原话只有在课堂原文有可核对措辞时才能作为引语;否则改写为知识陈述,不加引号
- 没有数值证据时不得编造数据图表;没有顺序或因果证据时不得编造流程
- 全部输出都必须基于下面的课堂原文,不允许编造

${context.anchorContext ? `学习者关注点:\n${context.anchorContext}\n\n` : ''}课堂原文:
${context.transcriptContext}${buildTerminologyHintBlock(context.terminologyHint)}`;
}

export interface InfographicImagePromptInput {
  title: string;
  subtitle: string;
  keyPoints: string[];
  contentOutline: string;
  textLabels: string[];
}

/**
 * 代码侧确定性拼装最终生图提示词:手册基座模板的全部 {{占位符}} 在这里替换,
 * 不让 LLM 抄模板(实测 LLM 会留下 {{CONTENT}} 空占位符,生图模型随即自由发挥跑题)。
 */
export function assembleInfographicImagePrompt(input: InfographicImagePromptInput): string {
  const materials = getInfographicSkillMaterials();
  const keyPoints = input.keyPoints.filter(Boolean);
  const labels = (input.textLabels.length > 0 ? input.textLabels : [input.title, input.subtitle, ...keyPoints])
    .filter(Boolean)
    .map((label, index) => `${index + 1}. ${label}`)
    .join('\n');
  const content = [
    `Main title: ${input.title}`,
    input.subtitle ? `Subtitle: ${input.subtitle}` : '',
    keyPoints.length > 0 ? `Key points:\n${keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}` : '',
    `Cell-by-cell plan:\n${input.contentOutline}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return materials.basePromptTemplate
    .replace('{{LAYOUT}}', INFOGRAPHIC_PRESET.layout)
    .replace('{{STYLE}}', INFOGRAPHIC_PRESET.style)
    .replace('{{ASPECT_RATIO}}', INFOGRAPHIC_PRESET.aspectRatio)
    .replaceAll('{{LANGUAGE}}', INFOGRAPHIC_PRESET.language)
    .replace('{{LAYOUT_GUIDELINES}}', materials.layoutGuide)
    .replace('{{STYLE_GUIDELINES}}', materials.styleGuide)
    .replace('{{CONTENT}}', content)
    .replace('{{TEXT_LABELS}}', labels)
    + '\n\n硬性要求:图上文字必须逐字来自上方 Text labels 清单,禁止新增任何文字、禁止伪造数字、禁止密集小字。';
}
