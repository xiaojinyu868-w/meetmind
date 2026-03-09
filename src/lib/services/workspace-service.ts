import prisma from '@/lib/prisma';

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  role: string;
}

function toWorkspaceSummary(params: {
  id: string;
  name: string;
  kind: string;
  status: string;
  role: string;
}): WorkspaceSummary {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    status: params.status,
    role: params.role,
  };
}

function buildDefaultWorkspaceName(nickname?: string | null): string {
  const base = (nickname || '').trim();
  if (!base) return '我的学习空间';
  return `${base}的学习空间`;
}

export const workspaceService = {
  async ensureDefaultWorkspace(userId: string): Promise<WorkspaceSummary | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        defaultWorkspaceId: true,
      },
    });

    if (!user) return null;

    if (user.defaultWorkspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: user.defaultWorkspaceId },
      });

      if (workspace) {
        await prisma.workspaceMembership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: workspace.id,
              userId,
            },
          },
          update: {
            status: 'active',
          },
          create: {
            workspaceId: workspace.id,
            userId,
            role: workspace.ownerId === userId ? 'owner' : 'member',
            status: 'active',
          },
        });

        return toWorkspaceSummary({
          id: workspace.id,
          name: workspace.name,
          kind: workspace.kind,
          status: workspace.status,
          role: workspace.ownerId === userId ? 'owner' : 'member',
        });
      }
    }

    const ownedWorkspace = await prisma.workspace.findFirst({
      where: {
        ownerId: userId,
        kind: 'personal',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (ownedWorkspace) {
      await prisma.workspaceMembership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: ownedWorkspace.id,
            userId,
          },
        },
        update: {
          role: 'owner',
          status: 'active',
        },
        create: {
          workspaceId: ownedWorkspace.id,
          userId,
          role: 'owner',
          status: 'active',
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { defaultWorkspaceId: ownedWorkspace.id },
      });

      return toWorkspaceSummary({
        id: ownedWorkspace.id,
        name: ownedWorkspace.name,
        kind: ownedWorkspace.kind,
        status: ownedWorkspace.status,
        role: 'owner',
      });
    }

    const membership = await prisma.workspaceMembership.findFirst({
      where: {
        userId,
        status: 'active',
      },
      include: {
        workspace: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (membership?.workspace) {
      await prisma.user.update({
        where: { id: userId },
        data: { defaultWorkspaceId: membership.workspace.id },
      });

      return toWorkspaceSummary({
        id: membership.workspace.id,
        name: membership.workspace.name,
        kind: membership.workspace.kind,
        status: membership.workspace.status,
        role: membership.role,
      });
    }

    return prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: buildDefaultWorkspaceName(user.nickname),
          kind: 'personal',
          status: 'active',
          ownerId: userId,
        },
      });

      await tx.workspaceMembership.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: 'owner',
          status: 'active',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          defaultWorkspaceId: workspace.id,
        },
      });

      return toWorkspaceSummary({
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind,
        status: workspace.status,
        role: 'owner',
      });
    });
  },

  async getDefaultWorkspace(userId: string): Promise<WorkspaceSummary | null> {
    return this.ensureDefaultWorkspace(userId);
  },

  async resolveWechatWorkspace(
    openId: string
  ): Promise<{
    userId: string;
    workspace: WorkspaceSummary;
  } | null> {
    const authProvider = await prisma.authProvider.findUnique({
      where: {
        provider_providerId: {
          provider: 'wechat',
          providerId: openId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (!authProvider) return null;

    const workspace = await this.ensureDefaultWorkspace(authProvider.userId);
    if (!workspace) return null;

    await prisma.wechatInboxMessage.updateMany({
      where: {
        openId,
        OR: [
          { userId: null },
          { workspaceId: null },
          { bindingStatus: { not: 'bound' } },
        ],
      },
      data: {
        userId: authProvider.userId,
        workspaceId: workspace.id,
        bindingStatus: 'bound',
      },
    });

    return {
      userId: authProvider.userId,
      workspace,
    };
  },
};

export default workspaceService;
