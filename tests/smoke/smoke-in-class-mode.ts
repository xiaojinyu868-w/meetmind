#!/usr/bin/env npx tsx
/**
 * smoke-in-class-mode.ts —— In-class（课堂同桌）模式真实端到端 smoke。
 *
 * 验证：
 *   1. 短回答（in-class 应该精简，不长篇大论）
 *   2. 注入 bio 时 AI 体现"认识"用户
 *   3. Skill chip prompt（"整张速查表"）能触发 <open_app:cheatsheet/>
 *   4. 不出现 [MM:SS]（returnTimestamps:false）
 *   5. 不出现 goal/bio marker（in-class 不该提炼这些）
 */

import { runSmokeSuite, turnsToMessages, newSessionId, type SmokeCase, type SmokeTurn } from './smoke-helpers';

interface InClassBody {
  sessionId: string;
  mode: 'in-class';
  transcript: never[];
  context: {
    recentFocus?: string;
    learnerProfile?: string;
  };
  options: {
    allowInlineApp: true;
    returnTimestamps: false;
    thinkingGuide: false;
  };
  messages: ReturnType<typeof turnsToMessages>;
}

// 假的"最近 30s"转录（recentFocus）—— in-class 用这个做代词消歧
const RECENT_FOCUS = `老师刚说到："快排的核心是 partition——把 pivot 放到正确位置上，左边都比它小，右边都比它大。i j 双指针扫一遍。"`;

const BIO_PROFILE = `【这个学生】
大三计算机学生，准备考研，最近在数学上卡了一阵。

- 大学生 · 大三 · 计算机科学

这只是背景，不是规则。当前课堂/材料和用户这一句话仍然是主上下文。`;

function makeBody(
  turns: SmokeTurn[],
  context: InClassBody['context'] = {},
): InClassBody {
  return {
    sessionId: newSessionId('smoke-in-class'),
    mode: 'in-class',
    transcript: [],
    context: {
      recentFocus: RECENT_FOCUS,
      ...context,
    },
    options: {
      allowInlineApp: true,
      returnTimestamps: false,
      thinkingGuide: false,
    },
    messages: turnsToMessages(turns),
  };
}

const IN_CLASS_BAN: string[] = [
  '---我想要的---',
  '---我了解到的你---',
  '---思维演示---',
  '---正式回答---',
  '挥了挥触手',
];

const CASES: SmokeCase<InClassBody>[] = [
  // ─── IC1：代词消歧 —— "他刚说" → AI 应基于 recentFocus 答 ───
  {
    name: 'IC1/代词消歧/刚才那句',
    description: '用户说"刚才那句没跟上"，AI 应基于 recentFocus 复述/解释',
    body: makeBody([{ role: 'user', content: '刚才那句我没跟上' }]),
    mustContainAny: ['partition', 'pivot', '核心', '快排', '指针'],
    mustNotContainAny: IN_CLASS_BAN,
    // 不能出现时间戳（in-class returnTimestamps:false）
    mustNotMatch: [/\[\d{1,2}:\d{2}\]/],
  },

  // ─── IC2：短回答 —— 课中不能长篇大论 ───
  {
    name: 'IC2/短回答/精简风格',
    description: '课中模式回答应该相对精简（< 600 字）',
    body: makeBody([{ role: 'user', content: '快排和归并的区别是？' }]),
    assert: (text) => {
      const len = text.replace(/\s+/g, '').length;
      // 600 字以内算精简
      if (len > 600) return `回答太长（${len} 字），课中应该精简`;
      return null;
    },
    mustNotContainAny: IN_CLASS_BAN,
  },

  // ─── IC3：Skill chip → inline app marker ───
  {
    name: 'IC3/Skill chip/整张速查表',
    description: '用户说"整一张速查表"，AI 应输出 <open_app:cheatsheet/>',
    body: makeBody([{ role: 'user', content: '整一张速查表' }]),
    mustContainAny: ['<open_app:cheatsheet/>'],
    mustNotContainAny: IN_CLASS_BAN,
  },

  // ─── IC4：bio 注入 ───
  {
    name: 'IC4/bio 注入/认识用户',
    description: '注入 bio 后 AI 在课堂中也能"认识"用户的考研背景',
    body: makeBody(
      [{ role: 'user', content: '老师讲的这个考研要考吗？' }],
      { learnerProfile: BIO_PROFILE },
    ),
    mustContainAny: ['考', '高频', '重点', '研', '常考', '可能'],
    mustNotContainAny: IN_CLASS_BAN,
  },

  // ─── IC5：身份问题 ───
  {
    name: 'IC5/身份/你是谁',
    description: '问"你是谁"必须自报 Octo / 同学，不列功能清单',
    body: makeBody([{ role: 'user', content: '你是谁' }]),
    mustContainAny: ['Octo', 'octo', '章鱼', '同学', '同桌'],
    mustNotContainAny: IN_CLASS_BAN,
    mustNotMatch: [/\n\s*1[\.、]\s*\S/m],
  },
];

(async () => {
  const { failed } = await runSmokeSuite('smoke-in-class', CASES);
  process.exit(failed > 0 ? 1 : 0);
})();
