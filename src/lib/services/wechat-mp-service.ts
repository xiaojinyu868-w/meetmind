import { createHash } from 'crypto';
import { detectReachFromText, type ContextReachDetection } from '@/lib/context-reach';

const WECHAT_MP_TOKEN = process.env.WECHAT_MP_TOKEN || '';

type WechatMessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'shortvideo'
  | 'location'
  | 'link'
  | 'event'
  | 'unknown';

export interface WechatMpPayload {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string;
  MsgType?: string;
  MsgId?: string;
  Event?: string;
  EventKey?: string;
  Content?: string;
  PicUrl?: string;
  MediaId?: string;
  Format?: string;
  Recognition?: string;
  Title?: string;
  Description?: string;
  Url?: string;
  Location_X?: string;
  Location_Y?: string;
  Label?: string;
  [key: string]: string | undefined;
}

export interface NormalizedWechatMessage {
  msgType: WechatMessageType;
  eventType?: string;
  messageId?: string;
  messageAt?: Date;
  normalizedText?: string;
  previewText: string;
  sourceUrl?: string;
  mediaId?: string;
  mediaUrl?: string;
  title?: string;
  /** 微信卡片转发时自带的 Description 摘要，仅 link 类型有值 */
  description?: string;
  reach?: ContextReachDetection;
  replyText: string;
}

function cleanXmlValue(value: string): string {
  return value
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim();
}

function sanitizeCdata(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function compactText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function toWechatMessageType(value?: string): WechatMessageType {
  const normalized = (value || '').toLowerCase();

  switch (normalized) {
    case 'text':
    case 'image':
    case 'voice':
    case 'video':
    case 'shortvideo':
    case 'location':
    case 'link':
    case 'event':
      return normalized as WechatMessageType;
    default:
      return 'unknown';
  }
}

export function isWechatMpConfigured(): boolean {
  return Boolean(WECHAT_MP_TOKEN);
}

export function verifyWechatMpSignature(signature: string, timestamp: string, nonce: string): boolean {
  if (!WECHAT_MP_TOKEN || !signature || !timestamp || !nonce) return false;

  const computed = createHash('sha1')
    .update([WECHAT_MP_TOKEN, timestamp, nonce].sort().join(''))
    .digest('hex');

  return computed === signature;
}

export function parseWechatMpXml(xml: string): WechatMpPayload {
  const payload: WechatMpPayload = {};
  const body = xml
    .replace(/^\s*<xml>/i, '')
    .replace(/<\/xml>\s*$/i, '');
  const pattern = /<([A-Za-z0-9_]+)>(<!\[CDATA\[[\s\S]*?\]\]>|[\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const [, key, rawValue] = match;
    payload[key] = cleanXmlValue(rawValue);
  }

  return payload;
}

function normalizeTextMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  const content = (payload.Content || '').trim();
  const reach = detectReachFromText(content);

  return {
    msgType: 'text',
    messageId: payload.MsgId,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    normalizedText: content,
    previewText: compactText(content || '一条文字消息', 90),
    sourceUrl: reach.url,
    reach,
    replyText:
      reach.channel === 'video-link'
        ? '这条链接我已经接住了，稍后会把它接进你的收集流。'
        : '收到，这条内容已经先记进你的收集流了。',
  };
}

function normalizeVoiceMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  const transcript = (payload.Recognition || payload.Content || '').trim();
  const normalizedText = transcript || undefined;
  const reach = normalizedText ? detectReachFromText(normalizedText) : undefined;

  return {
    msgType: 'voice',
    messageId: payload.MsgId,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    normalizedText,
    previewText: normalizedText ? `语音：${compactText(normalizedText, 72)}` : '一条语音消息',
    mediaId: payload.MediaId,
    reach,
    replyText: normalizedText
      ? '语音收到，这段原话和识别结果都先替你留住了。'
      : '语音收到，我先把它记进收集流里。',
  };
}

function normalizeImageMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  return {
    msgType: 'image',
    messageId: payload.MsgId,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    previewText: payload.PicUrl ? '一张图片已经加入收集流' : '一张图片消息',
    mediaId: payload.MediaId,
    mediaUrl: payload.PicUrl,
    replyText: '图片收到，我先替你放进这次收集里。',
  };
}

function normalizeLinkMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  const url = (payload.Url || '').trim();
  const title = (payload.Title || '').trim();
  const rawDescription = (payload.Description || '').trim();
  const description = [title, rawDescription, url].filter(Boolean).join('\n');
  const reach = detectReachFromText(description);

  return {
    msgType: 'link',
    messageId: payload.MsgId,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    normalizedText: description,
    previewText: title ? `链接：${compactText(title, 72)}` : '一条链接消息',
    sourceUrl: url || undefined,
    title: title || undefined,
    description: rawDescription || undefined,
    reach,
    replyText: url
      ? '链接收到，我会把它当作这次学习的外部线索记下来。'
      : '这条链接消息我已经接住了。',
  };
}

function normalizeEventMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  const eventType = (payload.Event || '').toLowerCase();
  const eventKey = payload.EventKey?.trim();

  if (eventType === 'subscribe') {
    return {
      msgType: 'event',
      eventType,
      messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
      previewText: '关注了服务号',
      replyText: '欢迎来到 MeetMind。以后你可以像发微信一样，把语音、文字和链接直接丢给我。',
    };
  }

  return {
    msgType: 'event',
    eventType: eventType || undefined,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    normalizedText: eventKey || undefined,
    previewText: eventKey ? `事件：${compactText(eventKey, 72)}` : '一条服务号事件',
    replyText: '收到，我先替你记下来了。',
  };
}

export function normalizeWechatMpMessage(payload: WechatMpPayload): NormalizedWechatMessage {
  const msgType = toWechatMessageType(payload.MsgType);

  if (msgType === 'text') return normalizeTextMessage(payload);
  if (msgType === 'voice') return normalizeVoiceMessage(payload);
  if (msgType === 'image') return normalizeImageMessage(payload);
  if (msgType === 'link') return normalizeLinkMessage(payload);
  if (msgType === 'event') return normalizeEventMessage(payload);

  return {
    msgType,
    messageId: payload.MsgId,
    messageAt: payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : undefined,
    previewText: '一条暂未深度解析的微信消息',
    mediaId: payload.MediaId,
    replyText: '收到，这类消息后续版本会理解得更完整。',
  };
}

export function buildWechatTextReply(toUser: string, fromUser: string, text: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `<xml>
<ToUserName><![CDATA[${sanitizeCdata(toUser)}]]></ToUserName>
<FromUserName><![CDATA[${sanitizeCdata(fromUser)}]]></FromUserName>
<CreateTime>${now}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${sanitizeCdata(text)}]]></Content>
</xml>`;
}
