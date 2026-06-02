#!/usr/bin/env npx tsx
/**
 * smoke-intent-mode.ts —— Goal 模式（「聊聊你想要的」）真实端到端 smoke。
 *
 * 双路径模拟：
 *   - 路径 A：首次会面（无 existingBio / 无 existingGoals）→ 引导自我介绍 → ---我了解到的你---
 *   - 路径 B：回访（已有 bio + goals）→ 不重问身份，接上聊 → ---我想要的---
 */

import { runSmokeSuite, turnsToMessages, newSessionId, type SmokeCase, type SmokeTurn } from './smoke-helpers';

interface GoalBody {
  sessionId: string;
  mode: 'goal';
  transcript: never[];
  context: {
    goal?: {
      existingGoals?: Array<{ title: string; summary?: string; updatedAt?: string }>;
      existingBio?: { headline: string; detail?: string };
      sessionHint?: string;
    };
  };
  options: Record<string, never>;
  messages: ReturnType<typeof turnsToMessages>;
}

const COACH_BAN_GLOBAL: string[] = [
  '挥了挥触手',
  '(挥',
  '我不是很会寒暄',
  '我不会寒暄',
  '你想说啥说啥',
  '你想聊啥就聊啥',
  '我就在这儿等',
  '我就在这儿待着',
  '哪怕你不说话也行',
  '哪怕就是一句',
  '同班同学',
  '我是你的助教',
  '我是你的助理',
  '今天的课',
  '上节课',
  '复习一下',
  '听课',
];

function makeBody(
  turns: SmokeTurn[],
  contextGoal?: GoalBody['context']['goal'],
): GoalBody {
  return {
    sessionId: newSessionId('smoke-goal'),
    mode: 'goal',
    transcript: [],
    context: contextGoal ? { goal: contextGoal } : {},
    options: {},
    messages: turnsToMessages(turns),
  };
}

const CASES: SmokeCase<GoalBody>[] = [
  // ═══ 路径 A：首次会面 ═══
  {
    name: 'A1/首次见面/你好',
    description: '首次会面，用户打招呼。AI 必须自我介绍 + 邀请用户介绍自己',
    body: makeBody([{ role: 'user', content: '你好' }]),
    mustContainAny: [
      '介绍', '你自己', '认识', '说说你', '说一下你', '简单说',
      '学生', '工作', '什么状态', '你这个人', '了解一下', '了解你',
    ],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'A2/首次见面/我是大三学生',
    description: '用户给身份，AI 不能追"什么专业"，要问状态',
    body: makeBody([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我是 Octo，你以后想清楚事情、记下事情都可以来找我。我们刚认识，你想先简单说一下你自己吗——是学生、在工作、还是在做点别的？' },
      { role: 'user', content: '我是大三学生' },
    ]),
    mustContainAny: ['状态', '最近', '怎么样', '在想', '常想', '阶段', '反复', '什么样', '什么阶段'],
    mustNotMatch: [/学(什么|哪个)专业/, /什么专业\?/, /专业是/],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'A3/首次见面/聊完后给合理教练动作',
    description: '多轮聊完后，AI 应该提议记画像 / 复述聚焦 / 合理深挖之一',
    body: makeBody([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我是 Octo。我们刚认识，你想先告诉我一点你自己吗——是学生、在工作、还是在做点别的？' },
      { role: 'user', content: '我是大三计算机的学生' },
      { role: 'assistant', content: '大三这个阶段你脑子里最常转的事是什么？' },
      { role: 'user', content: '主要是在纠结要不要考研，但还没完全想好' },
      { role: 'assistant', content: '考研这件事让你卡住一阵子了。是身边人都在考、你也想先占个位，还是你自己想清楚要继续学这个方向？' },
      { role: 'user', content: '主要是觉得本科找工作不够，想继续在这个方向深一点' },
      { role: 'assistant', content: '想往这个方向再扎深一点——这是个挺扎实的动机。这件事最近有让你白天突然想起来吗？' },
      { role: 'user', content: '嗯有的，最近都在想这件事，但是数学有点跟不上让我有点慌' },
    ]),
    mustContainAny: [
      '记一下', '记下你', '记住你', '我了解到的你', '认识你', '画像', '了解你',
      '听起来', '其实', '感觉',
      '心里', '踏实', '卡', '担心', '慌',
      '数学', '具体', '哪一块', '哪个部分',
    ],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'A4/首次见面/输出 bio marker',
    description: '用户已聊清楚 + 同意记下，AI 必须输出 ---我了解到的你--- marker',
    body: makeBody([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我是 Octo。你想先告诉我一点你自己吗——是学生、在工作、还是别的？' },
      { role: 'user', content: '我是大三计算机的，准备考研' },
      { role: 'assistant', content: '大三这个阶段在准备考研——最近大概是什么状态？复习已经开始了吗？' },
      { role: 'user', content: '刚开始复习，但是数学有点跟不上' },
      { role: 'assistant', content: '了解。那大概就是：大三计算机学生、在准备考研，最近卡在数学上一阵子。要不要我先记一下你这个人，以后我们就接着这个聊？' },
      { role: 'user', content: '好啊，记一下吧' },
    ]),
    mustContainAny: ['---我了解到的你---'],
    assert: (text) => {
      const start = text.match(/-{2,}我了解到的你-{2,}/);
      const end = text.match(/-{2,}结束-{2,}/);
      if (!start) return '未输出 ---我了解到的你--- 起始 marker';
      if (!end) return '未输出 ---结束--- 结束 marker';
      const inner = text.slice((start.index ?? 0) + start[0].length, end.index ?? text.length).trim();
      if (!inner) return 'marker 内为空';
      if (!/(学生|大[一二三四五]|工作|考研|研究生|计算机|准备)/.test(inner)) {
        return 'bio 内容不够具体（应该至少提到身份/阶段/方向之一）';
      }
      return null;
    },
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'A5/首次见面/含糊回答',
    description: '用户回"嗯"，AI 不能追问"为什么"',
    body: makeBody([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我是 Octo。你想先告诉我一点你自己吗——是学生、在工作、还是别的？' },
      { role: 'user', content: '嗯' },
    ]),
    mustNotMatch: [/^(为什么|你为什么|为啥)/m],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },

  // ═══ 路径 B：回访 ═══
  {
    name: 'B1/回访/不重问身份',
    description: '已有 bio，用户打招呼。AI 必须接上画像，不能再问身份/阶段',
    body: makeBody(
      [{ role: 'user', content: '你好' }],
      {
        existingBio: { headline: '大三计算机学生，准备考研，最近在数学上卡了一阵' },
        existingGoals: [{ title: '把考研数学跟上', updatedAt: '2026-05-30' }],
      },
    ),
    mustContainAny: ['考研', '数学', '上次', '回来', '最近怎么样', '那件事', '这件事', '怎么样'],
    mustNotMatch: [/是学生.*还是.*工作/, /什么阶段/, /大几/, /学.*专业/, /做什么的/],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'B2/回访/帮我记下来',
    description: '已有 bio，多轮聊完后用户说"对就这样"，AI 输出 ---我想要的--- marker',
    body: makeBody(
      [
        { role: 'user', content: '我想转行做设计，主要是因为我现在的工作越做越没劲，但我对画画一直有兴趣' },
        { role: 'assistant', content: '听起来核心是这件事——你想找一个让自己愿意每天醒来去做的事，而画画一直在你心里。' },
        { role: 'user', content: '对就是这样，帮我记下来' },
      ],
      {
        existingBio: {
          headline: '在工作的产品经理，做了三年，最近在思考要不要转方向',
          detail: '喜欢慢慢想，不喜欢被催',
        },
      },
    ),
    mustContainAny: ['---我想要的---'],
    assert: (text) => {
      const start = text.match(/-{2,}我想要的-{2,}/);
      const end = text.match(/-{2,}结束-{2,}/);
      if (!start) return '未输出 ---我想要的--- 起始 marker';
      if (!end) return '未输出 ---结束--- 结束 marker';
      const inner = text.slice((start.index ?? 0) + start[0].length, end.index ?? text.length).trim();
      if (!inner) return 'marker 内为空';
      const meCount = (inner.match(/我/g) ?? []).length;
      if (meCount < 1) return 'marker 内未使用第一人称';
      return null;
    },
    mustNotContainAny: COACH_BAN_GLOBAL,
  },

  // ═══ 通用 ═══
  {
    name: 'G1/通用/你是谁',
    description: '问"你是谁"必须自报 Octo + 简短角色，不列功能清单',
    body: makeBody([{ role: 'user', content: '你是谁' }]),
    mustContainAny: ['Octo', 'octo', '章鱼'],
    mustNotContainAny: COACH_BAN_GLOBAL,
    mustNotMatch: [/\n\s*1[\.、]\s*\S/m],
  },
  {
    name: 'G2/通用/多目标聚焦',
    description: '用户列出 3 件事，AI 必须聚焦让用户挑一个',
    body: makeBody(
      [{ role: 'user', content: '我最近想换工作、想学英语、还想找个对象，但是都没动' }],
      { existingBio: { headline: '工作两年的程序员，最近状态有点散' } },
    ),
    mustContainAny: [
      '挑一个', '哪个', '哪一件', '哪一个', '先动', '最想', '最重要',
      '先聊', '先说', '先做', '三件事', '这几件', '其中一', '最多次',
      '最有感觉', '最常想', '哪一', '一件事',
    ],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
  {
    name: 'G3/通用/给一个不给三个',
    description: '用户明确要建议，AI 不能输出 1.2.3 并列清单',
    body: makeBody(
      [{ role: 'user', content: '我想读研，但还没想好考国内还是出国，你给我点建议吧' }],
      { existingBio: { headline: '大四计算机学生，在思考毕业去向' } },
    ),
    mustNotMatch: [/\n\s*1[\.、]\s*\S[\s\S]*\n\s*2[\.、]\s*\S[\s\S]*\n\s*3[\.、]\s*\S/m],
    mustNotContainAny: COACH_BAN_GLOBAL,
  },
];

(async () => {
  const { failed } = await runSmokeSuite('smoke-intent', CASES);
  process.exit(failed > 0 ? 1 : 0);
})();
