/**
 * 孔子分身 seed（名人堂首发，只此一位）。
 *
 * 把 fenshen-spike 的蒸馏产物（out/fenshen-spike/work/skills/kongzi-perspective/）
 * 落为正式 hall 分身：建 FenshenEgo 行（status=ready）+ 复制 skill 到
 * data/fenshen-codex/<egoId>/work/skills/kongzi-perspective/，并镜像到 work/skill/
 * （对话线程的固定挂载点，与 distill-service 的 ready 检测同一布局）。
 *
 * 用法：npx tsx scripts/seed-confucius-ego.ts
 * 幂等：已存在同名 hall 分身则只同步文件、不重复建行。
 */

import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';

const SPIKE_SKILL_DIR = path.join(
  process.cwd(),
  'out/fenshen-spike/work/skills/kongzi-perspective',
);
const EGO_NAME = '孔子';
const SKILL_DIR_NAME = 'kongzi-perspective';
const MODEL = 'ZHIPU/GLM-5.3';

async function main() {
  await stat(path.join(SPIKE_SKILL_DIR, 'SKILL.md')).catch(() => {
    throw new Error(`找不到 spike 产物：${SPIKE_SKILL_DIR}/SKILL.md`);
  });

  let ego = await prisma.fenshenEgo.findFirst({
    where: { name: EGO_NAME, sourceType: 'hall' },
  });
  if (!ego) {
    ego = await prisma.fenshenEgo.create({
      data: {
        name: EGO_NAME,
        sourceType: 'hall',
        sourceRef: 'out/fenshen-spike（孔子蒸馏，REPORT.md）',
        status: 'ready',
        skillPath: `skills/${SKILL_DIR_NAME}`,
        model: MODEL,
      },
    });
    console.log('created ego:', ego.id);
  } else {
    await prisma.fenshenEgo.update({
      where: { id: ego.id },
      data: { status: 'ready', skillPath: `skills/${SKILL_DIR_NAME}`, failReason: null },
    });
    console.log('ego exists, refreshed:', ego.id);
  }

  const workDir = path.join(process.cwd(), 'data/fenshen-codex', ego.id, 'work');
  const skillsTarget = path.join(workDir, 'skills', SKILL_DIR_NAME);
  const chatSkillTarget = path.join(workDir, 'skill');
  await mkdir(path.dirname(skillsTarget), { recursive: true });
  await cp(SPIKE_SKILL_DIR, skillsTarget, { recursive: true });
  await cp(SPIKE_SKILL_DIR, chatSkillTarget, { recursive: true });
  console.log('skill synced ->', skillsTarget);
  console.log('chat mount  ->', chatSkillTarget);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
