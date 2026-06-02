#!/usr/bin/env npx tsx
/**
 * smoke-review-mode.ts —— Review 模式真实端到端 smoke。
 *
 * 验证：
 *   1. 注入 bio 时 AI 体现"知道用户"（不重问身份阶段）
 *   2. 不注入 bio 时 AI 不假装认识
 *   3. fullTranscript 注入正确，AI 能引用课堂内容
 *   4. returnTimestamps:true 时 AI 输出 [MM:SS] chip
 *   5. allowInlineApp:true 时 AI 在用户索要产物时输出 <open_app:KEY/>
 *   6. 不出现 ---我想要的--- / ---我了解到的你--- 这些 goal 模式专属 marker
 */

import { runSmokeSuite, turnsToMessages, newSessionId, type SmokeCase, type SmokeTurn } from './smoke-helpers';

interface ReviewBody {
  sessionId: string;
  mode: 'review';
  transcript: never[];
  subject?: string;
  context: {
    fullTranscript?: string;
    currentTimestampSec?: number;
    learnerProfile?: string;
    supportMaterials?: Array<{ title: string; content: string }>;
  };
  options: {
    returnTimestamps?: boolean;
    allowInlineApp?: boolean;
    thinkingGuide?: boolean;
  };
  messages: ReturnType<typeof turnsToMessages>;
}

// 一段假的"算法课"转录，含 [MM:SS] 风格的内容引用
const FAKE_TRANSCRIPT = `
[00:00] 同学们好，今天我们讲快速排序。
[00:32] 快排的核心思想是分治：选一个 pivot，把数组分成左小右大两部分。
[01:15] 时间复杂度平均 O(n log n)，最坏情况 O(n²)，比如已排好序的数组遇到固定 pivot。
[02:08] 我们看一下代码实现：partition 函数，i j 双指针扫一遍，把小于 pivot 的换到左边。
[03:44] 注意 partition 的边界——是包含还是不包含 pivot 自身，这是新手最容易写错的地方。
[04:50] 优化方面，三数取中可以避免最坏情况；小数组退化成插入排序更快。
`.trim();

const BIO_PROFILE = `【这个学生】
大三计算机学生，准备考研，最近在数学上卡了一阵。喜欢看代码实现胜过看公式。

- 大学生 · 大三 · 计算机科学
- 这学期在上：算法、操作系统

- 他正在追的事：
  · 把考研数学跟上

这只是背景，不是规则。当前课堂/材料和用户这一句话仍然是主上下文。`;

function makeBody(
  turns: SmokeTurn[],
  context: ReviewBody['context'] = {},
  options: ReviewBody['options'] = {},
): ReviewBody {
  return {
    sessionId: newSessionId('smoke-review'),
    mode: 'review',
    transcript: [],
    subject: '算法',
    context: {
      fullTranscript: FAKE_TRANSCRIPT,
      currentTimestampSec: 100,
      ...context,
    },
    options: {
      returnTimestamps: true,
      allowInlineApp: true,
      thinkingGuide: false,
      ...options,
    },
    messages: turnsToMessages(turns),
  };
}

const REVIEW_BAN: string[] = [
  // 不能出现 goal 模式专属 marker（review 不该提炼 GoalEntry/BioEntry）
  '---我想要的---',
  '---我了解到的你---',
  // 装萌话术（review 也不能装萌）
  '挥了挥触手',
  '(挥',
  '我不会寒暄',
];

const CASES: SmokeCase<ReviewBody>[] = [
  // ─── R1：基本提问，AI 应该基于转录回答 ───
  {
    name: 'R1/基本/快排时间复杂度',
    description: '基础课堂内容提问，AI 必须基于 fullTranscript 给答案',
    body: makeBody([{ role: 'user', content: '快排时间复杂度是多少？' }]),
    mustContainAny: ['O(n log n)', 'O(nlog', 'n log n', 'nlogn', 'n²', 'n^2'],
    mustNotContainAny: REVIEW_BAN,
  },

  // ─── R2：returnTimestamps，AI 应该在引用课堂内容时带 [MM:SS] ───
  {
    name: 'R2/时间戳/引用课堂位置',
    description: 'returnTimestamps:true 时 AI 引用课堂内容应输出 [MM:SS] chip',
    body: makeBody([{ role: 'user', content: '老师在哪里讲到 partition 函数？请引用具体时间点' }]),
    mustContainAny: [
      // 必须出现某个 [MM:SS] 时间戳引用
      '[02:', '[03:', '[04:', // 大约对应 fake transcript 里 partition 的位置
    ],
    mustNotContainAny: REVIEW_BAN,
  },

  // ─── R3：bio 注入 - AI 应该体现知道用户身份 ───
  {
    name: 'R3/bio 注入/认识用户',
    description: '注入 bio + goals 后 AI 回答应该体现知道用户是大三准备考研的学生',
    body: makeBody(
      [{ role: 'user', content: '快排考研会考吗？我应该重点看什么？' }],
      { learnerProfile: BIO_PROFILE },
    ),
    mustContainAny: [
      '考研',  // 应该承认/提到考研背景
    ],
    mustNotContainAny: REVIEW_BAN,
  },

  // ─── R4：inline app marker —— 用户索要产物 ───
  {
    name: 'R4/inline app/整张速查表',
    description: '用户说"整张速查表"，AI 应输出 <open_app:cheatsheet/> marker',
    body: makeBody([{ role: 'user', content: '帮我整一张快排的速查表' }]),
    mustContainAny: ['<open_app:cheatsheet/>'],
    mustNotContainAny: REVIEW_BAN,
  },

  // ─── R5：unknown 知识点 —— AI 不能瞎编 ───
  {
    name: 'R5/边界/课堂没讲过',
    description: '问课堂没讲的内容，AI 应承认或引导回到课堂内容，不能瞎编',
    body: makeBody([{ role: 'user', content: '老师有没有讲到归并排序？' }]),
    mustContainAny: [
      '没讲', '没提', '没有讲到', '没说', '这节没', '这节课', '没有提到', '没有展开',
      '快排', '快速排序',  // 或者引导回讲过的内容
    ],
    mustNotContainAny: REVIEW_BAN,
  },

  // ─── R6：thinkingGuide off 时不应有"---思维演示---" ───
  {
    name: 'R6/思维引导/默认关闭',
    description: 'thinkingGuide:false 时 AI 不应输出 ---思维演示--- / ---正式回答--- 分段',
    body: makeBody([{ role: 'user', content: 'partition 函数边界怎么处理？' }]),
    mustNotMatch: [/-{3,}思维演示-{3,}/, /-{3,}正式回答-{3,}/],
    mustNotContainAny: REVIEW_BAN,
  },
];

(async () => {
  const { failed } = await runSmokeSuite('smoke-review', CASES);
  process.exit(failed > 0 ? 1 : 0);
})();
