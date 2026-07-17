import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from './rate-limit-service';

describe('WeChat QR rate limit', () => {
  it('keeps public QR creation below normal login traffic volume', () => {
    expect(RATE_LIMITS.wechatQr).toEqual({
      perMinute: 5,
      perHour: 30,
      perDay: 100,
      cost: 'medium',
    });
    expect(RATE_LIMITS.wechatQrPoll.perMinute).toBeGreaterThanOrEqual(60);
    expect(RATE_LIMITS.wechatQrPoll.perMinute).toBeLessThanOrEqual(90);
  });
});
