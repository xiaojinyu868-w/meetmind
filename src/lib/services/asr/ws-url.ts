export function buildAsrWebSocketCandidates(pageHref: string, speakerDiarization = false): string[] {
  const pageUrl = new URL(pageHref);
  const protocol = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = speakerDiarization ? '/api/asr-stream-speaker' : '/api/asr-stream';
  const primary = `${protocol}//${pageUrl.host}${path}`;
  const candidates = [primary];

  if (protocol === 'wss:' && pageUrl.port !== '8443') {
    candidates.push(`${protocol}//${pageUrl.hostname}:8443${path}`);
  }

  return Array.from(new Set(candidates));
}
