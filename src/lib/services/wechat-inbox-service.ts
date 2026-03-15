import prisma from '@/lib/prisma';
import type { NormalizedWechatMessage } from '@/lib/services/wechat-mp-service';
import workspaceService from '@/lib/services/workspace-service';
import workspaceContextService from '@/lib/services/workspace-context-service';

type CollectionRole = 'primary' | 'support';

export interface WechatInboxIntelligence {
  collectionRole: CollectionRole;
  bindingStatus: 'bound' | 'unresolved';
  userId?: string;
  workspaceId?: string;
  workspaceName?: string;
  echoTitle: string;
  echoBody: string;
  echoChips: string[];
  tutorContext: string;
}

function compactText(value: string, limit: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function inferCollectionRole(message: NormalizedWechatMessage): CollectionRole {
  if (message.msgType === 'event') return 'support';
  return 'primary';
}

function buildEchoTitle(message: NormalizedWechatMessage): string {
  if (message.msgType === 'voice') return '微信里的原话已经接进来了';
  if (message.msgType === 'link') return '这条链接已经变成上下文线索';
  if (message.msgType === 'image') return '这张图已经记进你的上下文里';
  if (message.msgType === 'event') return '这次触达已经留下痕迹了';
  return '这条收集已经长进你的上下文里';
}

function buildEchoBody(message: NormalizedWechatMessage): string {
  const text = compactText(message.normalizedText || message.previewText || '', 72);

  if (message.msgType === 'voice') {
    return text
      ? `这段语音不只是被记下来了，里面的原始表达也能继续驱动后面的回声和 Tutor。`
      : '这段语音已经留下来了。后面再补一句你当时为什么要发它，会更有抓手。';
  }

  if (message.msgType === 'link') {
    return '这条链接现在是一条外部材料线索。后面补一句你为什么发它，系统会更容易看出它和你当前学习线索的关系。';
  }

  if (message.msgType === 'image') {
    return '这张图片已经进入收集流。后面加一句当时没懂的点，系统会更容易把它和别的内容连起来。';
  }

  if (text) {
    return `你刚刚记下的不只是内容，也是此刻的学习状态。后面 Tutor 会优先沿着这条线继续。`;
  }

  return '这条内容已经进入收集流了。你不用一次说完整，后面继续轻轻往里加就行。';
}

function buildEchoChips(message: NormalizedWechatMessage): string[] {
  const chips: string[] = [];

  if (message.msgType === 'voice') chips.push('课堂原话');
  if (message.msgType === 'text') chips.push('随手记录');
  if (message.msgType === 'image') chips.push('图片线索');
  if (message.msgType === 'link') chips.push('外部链接');
  if (message.reach?.channel === 'video-link') chips.push('视频材料');
  if (message.reach?.channel === 'web-link') chips.push('网页材料');
  if (message.normalizedText && /(\?|？|为什么|怎么|不会|困惑|卡住|不懂)/.test(message.normalizedText)) {
    chips.push('带着问题来的');
  }

  return chips.slice(0, 3);
}

function buildTutorContext(message: NormalizedWechatMessage): string {
  const parts: string[] = ['以下内容来自微信服务号的轻收集入口，请把它当作用户主动发进来的真实学习上下文。'];

  const providerLabel = message.reach?.providerLabel;
  const isKnownPlatform = providerLabel && providerLabel !== '网页';

  const typeLabel =
    message.msgType === 'voice'
      ? '语音'
      : message.msgType === 'link'
        ? isKnownPlatform
          ? `${providerLabel}内容`
          : '链接'
        : message.msgType === 'image'
          ? '图片'
          : message.msgType === 'event'
            ? '服务号事件'
            : '文字';

  parts.push(`输入类型：${typeLabel}`);

  if (isKnownPlatform) {
    parts.push(`来源平台：${providerLabel}`);
  }

  if (message.title) {
    parts.push(`标题：${compactText(message.title, 120)}`);
  }

  if (message.description) {
    parts.push(`摘要：${compactText(message.description, 300)}`);
  }

  if (message.sourceUrl) {
    parts.push(`来源链接：${message.sourceUrl}`);
  }

  if (message.normalizedText) {
    parts.push(`用户原始内容：${compactText(message.normalizedText, 1800)}`);
  } else if (message.previewText) {
    parts.push(`内容预览：${compactText(message.previewText, 300)}`);
  }

  if (message.msgType === 'voice') {
    parts.push('回答时请优先保留口语化上下文，先帮用户接住，再决定是否展开解释。');
  } else if (message.msgType === 'link') {
    const platformHint = isKnownPlatform
      ? `这是一条来自${providerLabel}的内容。`
      : '';
    parts.push(`${platformHint}回答时请先解释这条链接为什么值得看，再把它和当前学习主题连接起来。`);
  } else {
    parts.push('回答时请优先沿着这条收集背后的困惑、意图或线索继续，而不是给泛泛总结。');
  }

  return parts.join('\n');
}

export async function deriveWechatInboxIntelligence(
  openId: string,
  message: NormalizedWechatMessage
): Promise<WechatInboxIntelligence> {
  const binding = await workspaceService.resolveWechatWorkspace(openId);
  const echoChips = buildEchoChips(message);

  return {
    collectionRole: inferCollectionRole(message),
    bindingStatus: binding ? 'bound' : 'unresolved',
    userId: binding?.userId,
    workspaceId: binding?.workspace.id,
    workspaceName: binding?.workspace.name,
    echoTitle: buildEchoTitle(message),
    echoBody: buildEchoBody(message),
    echoChips,
    tutorContext: buildTutorContext(message),
  };
}

export async function ensureWechatInboxMessageHydrated(linkToken: string) {
  const existing = await prisma.wechatInboxMessage.findUnique({
    where: { linkToken },
  });

  if (!existing) return null;

  if ((!existing.userId || !existing.workspaceId || existing.bindingStatus !== 'bound') && existing.openId) {
    const binding = await workspaceService.resolveWechatWorkspace(existing.openId);
    if (binding) {
      await prisma.wechatInboxMessage.update({
        where: { id: existing.id },
        data: {
          userId: binding.userId,
          workspaceId: binding.workspace.id,
          bindingStatus: 'bound',
        },
      });
    }
  }

  await workspaceContextService.hydrateWechatVoiceMessage(linkToken);
  await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken, { hydrateVoice: true });

  return prisma.wechatInboxMessage.findUnique({
    where: { linkToken },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          kind: true,
          status: true,
        },
      },
    },
  });
}
