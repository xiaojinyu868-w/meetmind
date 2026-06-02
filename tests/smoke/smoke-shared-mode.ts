#!/usr/bin/env npx tsx
/**
 * smoke-shared-mode.ts —— Shared（分享态）模式真实端到端 smoke。
 *
 * 验证（隐私铁律 + 死链消除）：
 *   1. 不出现 [MM:SS] 时间戳（returnTimestamps:false，访客没原录音）
 *   2. 不出现 <open_app:KEY/> marker（allowInlineApp:false，分享态不允许产物）
 *   3. 即使前端伪传 learnerProfile，服务端 prompt 也不注入（mode==='shared' 隐私铁律）
 *   4. AI 自我定位为"分享者刻下的同学"，不是访问者的私人 AI
 *   5. 课堂内容外的问题：AI 应说明这节课没讲，可基于常识聊
 *
 * 启动前会自动 seed 一个 fake SharedAgent（token = 'smoke-shared-test'）到本地 SQLite。
 * 测完留着不删，方便手动 dev 复跑。
 */

import { runSmokeSuite, turnsToMessages, newSessionId, type SmokeCase, type SmokeTurn } from './smoke-helpers';
import prisma from '../../src/lib/prisma';

const FAKE_SHARE_TOKEN = 'smoke-shared-test';

const FAKE_TRANSCRIPT_DIGEST = {
  totalSec: 360,
  segments: [
    { startSec: 0, endSec: 30, text: '同学们好，今天我们讲快速排序。' },
    { startSec: 32, endSec: 75, text: '快排的核心思想是分治：选一个 pivot，把数组分成左小右大两部分。' },
    { startSec: 75, endSec: 130, text: '时间复杂度平均 O(n log n)，最坏情况 O(n²)，比如已排好序的数组遇到固定 pivot。' },
    { startSec: 130, endSec: 220, text: 'partition 函数，i j 双指针扫一遍，把小于 pivot 的换到左边。' },
    { startSec: 220, endSec: 290, text: '注意 partition 的边界——是包含还是不包含 pivot 自身，这是新手最容易写错的地方。' },
    { startSec: 290, endSec: 360, text: '优化方面，三数取中可以避免最坏情况；小数组退化成插入排序更快。' },
  ],
  keyTerms: ['快速排序', 'partition', 'pivot', '分治', '双指针', '时间复杂度'],
};

/** Seed 一个稳定 token 的 fake SharedAgent 到本地 db（已存在则跳过） */
async function seedFakeShare(): Promise<void> {
  const existing = await prisma.sharedAgent.findUnique({ where: { token: FAKE_SHARE_TOKEN } });
  if (existing && existing.status === 'active') return;
  const snapshot = {
    title: '快速排序入门',
    subject: '算法',
    artifactKind: 'cheatsheet' as const,
    transcriptDigest: FAKE_TRANSCRIPT_DIGEST,
    sharerNickname: '小明同学',
    conversationContext: '这节课讲的是快排，重点是 partition 和 i j 双指针。',
  };
  if (existing) {
    await prisma.sharedAgent.update({
      where: { token: FAKE_SHARE_TOKEN },
      data: {
        status: 'active',
        snapshotJson: JSON.stringify(snapshot),
      },
    });
  } else {
    await prisma.sharedAgent.create({
      data: {
        token: FAKE_SHARE_TOKEN,
        title: snapshot.title,
        subject: snapshot.subject,
        artifactKind: snapshot.artifactKind,
        snapshotJson: JSON.stringify(snapshot),
        sharerNickname: snapshot.sharerNickname,
        visibility: 'public',
        conversationEnabled: true,
        status: 'active',
      },
    });
  }
}

interface SharedBody {
  sessionId: string;
  mode: 'shared';
  shareToken: string;
  transcript: never[];
  context: {
    learnerProfile?: string;
  };
  options: {
    returnTimestamps: false;
    allowInlineApp: false;
  };
  messages: ReturnType<typeof turnsToMessages>;
}

const FAKE_LEAKED_PROFILE = `【这个学生】
张三，工作 5 年的程序员，住在北京，养了一只猫叫小白。`;

function makeBody(
  turns: SmokeTurn[],
  contextOverride: Partial<SharedBody['context']> = {},
): SharedBody {
  return {
    sessionId: newSessionId('smoke-shared'),
    mode: 'shared',
    shareToken: FAKE_SHARE_TOKEN,
    transcript: [],
    context: contextOverride,
    options: {
      returnTimestamps: false,
      allowInlineApp: false,
    },
    messages: turnsToMessages(turns),
  };
}

const SHARED_BAN: string[] = [
  '---我想要的---',
  '---我了解到的你---',
  '挥了挥触手',
  '我不会寒暄',
  '<open_app:',
];

const CASES: SmokeCase<SharedBody>[] = [
  {
    name: 'S1/无死链/不输出时间戳',
    description: '分享态访客没有原录音，AI 引用课堂内容时不应输出 [MM:SS]',
    body: makeBody([{ role: 'user', content: '老师讲了什么核心内容？' }]),
    mustNotMatch: [/\[\d{1,2}:\d{2}\]/, /\[t=\d/],
    mustNotContainAny: SHARED_BAN,
  },
  {
    name: 'S2/无产物/不输出 open_app',
    description: '即使用户索要"速查表"，分享态也不能输出 <open_app:KEY/> marker',
    body: makeBody([{ role: 'user', content: '帮我整一张速查表' }]),
    mustNotContainAny: SHARED_BAN,
  },
  {
    name: 'S3/隐私/不读访问者画像',
    description: '前端伪传 learnerProfile 含访客私人信息，AI 不能在回复里出现',
    body: makeBody(
      [{ role: 'user', content: '你认识我吗？' }],
      { learnerProfile: FAKE_LEAKED_PROFILE },
    ),
    mustNotContainAny: ['张三', '工作 5 年', '北京', '小白'],
  },
  {
    name: 'S4/身份/分享者刻下的同学',
    description: 'AI 应自我定位为"分享者刻下的同学"，不是访问者的私人 AI',
    body: makeBody([{ role: 'user', content: '你是谁？' }]),
    mustContainAny: ['听', '同学', '一起', '陪', '分享', '这节课', '内容', 'Octo'],
    mustNotContainAny: SHARED_BAN,
  },
  {
    name: 'S5/边界/课堂外问题',
    description: '问课堂内容外的开放问题，AI 应承认范围有限或简短回答',
    body: makeBody([{ role: 'user', content: '我应该选 java 还是 python 学？' }]),
    mustNotContainAny: SHARED_BAN,
  },
];

(async () => {
  await seedFakeShare();
  const { failed } = await runSmokeSuite('smoke-shared', CASES);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
})();

