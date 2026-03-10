import { randomBytes } from 'crypto';

interface WechatWebSessionRecord {
  accessToken: string;
  refreshToken?: string;
  nickname?: string;
  expiresAt: number;
}

const wechatWebSessions = new Map<string, WechatWebSessionRecord>();
const DEFAULT_WECHAT_WEB_SESSION_TTL = 2 * 60 * 1000;

function cleanExpiredWechatWebSessions() {
  const now = Date.now();
  for (const [token, session] of wechatWebSessions) {
    if (session.expiresAt < now) {
      wechatWebSessions.delete(token);
    }
  }
}

export function createWechatWebSession(
  payload: Omit<WechatWebSessionRecord, 'expiresAt'>,
  ttlMs: number = DEFAULT_WECHAT_WEB_SESSION_TTL
): string {
  cleanExpiredWechatWebSessions();

  const sessionToken = randomBytes(32).toString('hex');
  wechatWebSessions.set(sessionToken, {
    ...payload,
    expiresAt: Date.now() + ttlMs,
  });

  return sessionToken;
}

export function consumeWechatWebSession(sessionToken: string): Omit<WechatWebSessionRecord, 'expiresAt'> | null {
  cleanExpiredWechatWebSessions();

  const session = wechatWebSessions.get(sessionToken);
  if (!session || session.expiresAt < Date.now()) {
    if (session) {
      wechatWebSessions.delete(sessionToken);
    }
    return null;
  }

  wechatWebSessions.delete(sessionToken);
  const { expiresAt: _expiresAt, ...payload } = session;
  return payload;
}
