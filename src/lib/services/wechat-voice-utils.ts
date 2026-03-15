function compactText(value: string, limit: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

export function buildWechatVoicePreviewText(transcript?: string | null): string {
  const text = compactText((transcript || '').trim(), 72);
  return text ? `语音：${text}` : '一条语音消息';
}

export function buildWechatVoiceTutorContext(transcript?: string | null): string {
  const text = compactText((transcript || '').trim(), 1800);

  if (!text) {
    return [
      '以下内容来自微信里的语音消息，请把它当作用户刚发进来的课堂原话。',
      '这条语音还没有可用转写，请先围绕它的上下文接住用户，不要脱离当前学习现场。',
    ].join('\n');
  }

  return [
    '以下内容来自微信里的语音消息，请把它当作用户刚发进来的课堂原话。',
    `语音转写：${text}`,
    '回答时优先顺着这段原话继续，不要脱离当前课堂场景。',
  ].join('\n');
}

export function normalizeWechatMediaPublicPath(value?: string | null): string | null {
  const input = (value || '').trim();
  if (!input) return null;

  if (input.startsWith('/wechat-media/')) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.pathname.startsWith('/wechat-media/')) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    const markerIndex = input.indexOf('/wechat-media/');
    if (markerIndex >= 0) {
      return input.slice(markerIndex);
    }
  }

  return null;
}

export function isWechatPlayableAudioUrl(value?: string | null): boolean {
  const normalized = normalizeWechatMediaPublicPath(value) || (value || '').trim();
  if (!normalized) return false;
  return /\.(mp3|m4a|aac|wav|ogg|webm|flac)(\?.*)?$/i.test(normalized);
}
