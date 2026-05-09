export function buildAsrWebSocketCandidates(pageHref: string): string[] {
  const pageUrl = new URL(pageHref);
  const protocol = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const primary = `${protocol}//${pageUrl.host}/api/asr-stream`;
  const candidates = [primary];

  if (protocol === 'wss:' && pageUrl.port !== '8443') {
    candidates.push(`${protocol}//${pageUrl.hostname}:8443/api/asr-stream`);
  }

  return Array.from(new Set(candidates));
}
