export function buildAsrWebSocketCandidates(pageHref: string): string[] {
  const pageUrl = new URL(pageHref);
  const protocol = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  // 2026-08：腾讯云 /api/asr-stream-speaker 实验链路已下线，实时转录只有单一路径。
  const path = '/api/asr-stream';
  const primary = `${protocol}//${pageUrl.host}${path}`;
  const candidates = [primary];

  if (protocol === 'wss:' && pageUrl.port !== '8443') {
    candidates.push(`${protocol}//${pageUrl.hostname}:8443${path}`);
  }

  return Array.from(new Set(candidates));
}
