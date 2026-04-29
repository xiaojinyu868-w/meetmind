/**
 * GET /api/console/dashboard
 *
 * 为 /console 总览页返回"任务引导 + 数据快览"：
 *   - org：当前机构基本信息 + onboardingStep
 *   - counts：场景数 / 已发布场景数 / assets / playbook / sources(ready) / members / practices(last7d)
 *   - todos：有优先级的"下一步该做什么"列表（未完成 onboarding / 未关联视频的已发布场景 / 老师视频未分析等）
 *   - recentPractices：最近 5 条练习，用于总览最下方
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { academicRoute, AcademicError, resolveConsoleContext } from '@/lib/academic';

interface TodoItem {
  id: string;
  priority: 'high' | 'medium' | 'low';
  headline: string;
  description?: string;
  href: string;
  ctaLabel?: string;
}

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const orgId = ctx.orgId;

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [
    org,
    scenarios,
    assetsCount,
    playbookCount,
    sourcesAll,
    membersCount,
    practicesLast7d,
    recentPractices,
  ] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.orgScenario.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        status: true,
        coachingSourceRefs: true,
        playbookSectionRefs: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.orgAsset.count({ where: { orgId } }),
    prisma.orgPlaybookSection.count({ where: { orgId } }),
    prisma.coachingSource.findMany({
      where: { orgId },
      select: { id: true, title: true, status: true },
    }),
    prisma.orgMember.count({ where: { orgId } }),
    prisma.practiceSession.count({ where: { orgId, startedAt: { gte: since } } }),
    prisma.practiceSession.findMany({
      where: { orgId },
      take: 5,
      orderBy: { startedAt: 'desc' },
      include: {
        scenario: { select: { id: true, name: true } },
        user: { select: { id: true, nickname: true, username: true } },
      },
    }),
  ]);

  if (!org) throw new AcademicError('NOT_FOUND', '机构不存在');

  const sourcesReady = sourcesAll.filter((s) => s.status === 'ready').length;
  const sourcesPending = sourcesAll.filter((s) => s.status !== 'ready');

  const publishedScenarios = scenarios.filter((s) => s.status === 'published');
  const draftScenarios = scenarios.filter((s) => s.status === 'draft');

  // 生成 todos
  const todos: TodoItem[] = [];

  // 1. onboarding 未完成
  if (org.status === 'onboarding' || org.onboardingStep < 5) {
    todos.push({
      id: 'onboarding',
      priority: 'high',
      headline: `继续完成机构接入（第 ${org.onboardingStep}/5 步）`,
      description: '完成接入后，学生就可以开始使用你发布的场景了。',
      href: '/console/onboarding',
      ctaLabel: '继续接入',
    });
  }

  // 2. 没有任何场景
  if (scenarios.length === 0) {
    todos.push({
      id: 'no-scenario',
      priority: 'high',
      headline: '创建你的第一个陪练场景',
      description: '场景是机构真正交付给学生的产品——决定 AI 陪练做什么、怎么做。',
      href: '/console/scenarios',
      ctaLabel: '去创建',
    });
  } else if (publishedScenarios.length === 0) {
    todos.push({
      id: 'no-published',
      priority: 'high',
      headline: `你有 ${draftScenarios.length} 个草稿场景未发布`,
      description: '发布后学生端才能看到这个场景。',
      href: '/console/scenarios',
      ctaLabel: '去查看',
    });
  }

  // 3. 已发布场景但没关联老师视频
  const publishedWithoutSource = publishedScenarios.filter((s) => {
    try {
      const refs = JSON.parse(s.coachingSourceRefs) as string[];
      return refs.length === 0;
    } catch {
      return true;
    }
  });
  if (publishedWithoutSource.length > 0) {
    todos.push({
      id: 'scenario-without-source',
      priority: 'medium',
      headline: `${publishedWithoutSource.length} 个已发布场景未关联老师视频`,
      description: '关联老师视频后，AI 陪练会以这位老师的风格提问、反馈、评价。',
      href: `/console/scenarios/${publishedWithoutSource[0].id}`,
      ctaLabel: '去关联',
    });
  }

  // 4. 有上传但未分析的老师视频
  if (sourcesPending.length > 0) {
    todos.push({
      id: 'unanalyzed-source',
      priority: 'medium',
      headline: `你有 ${sourcesPending.length} 段老师视频待分析`,
      description: '分析一次需 30-120 秒，完成后就能在场景里引用。',
      href: '/console/knowledge?kind=source',
      ctaLabel: '去分析',
    });
  }

  // 5. 没有成员
  if (membersCount <= 1) {
    todos.push({
      id: 'no-members',
      priority: 'low',
      headline: '邀请老师或学生加入你的机构',
      description: '学生需要通过邀请链接进入机构才能练习。',
      href: '/console/settings',
      ctaLabel: '去邀请',
    });
  }

  return {
    data: {
      org: {
        id: org.id,
        name: org.name,
        industry: org.industry,
        status: org.status,
        onboardingStep: org.onboardingStep,
      },
      counts: {
        scenariosTotal: scenarios.length,
        scenariosPublished: publishedScenarios.length,
        scenariosDraft: draftScenarios.length,
        assets: assetsCount,
        playbook: playbookCount,
        sources: sourcesAll.length,
        sourcesReady,
        members: membersCount,
        practicesLast7d,
      },
      todos,
      recentPractices: recentPractices.map((p) => ({
        id: p.id,
        scenario: p.scenario,
        user: p.user,
        status: p.status,
        startedAt: p.startedAt,
        mode: p.mode,
      })),
    },
  };
});
