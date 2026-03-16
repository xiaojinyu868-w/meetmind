import { expect, test } from '@playwright/test';
import { shouldPreferBufferedVoiceInput } from '../../src/hooks/useVoiceInput';

test.describe('voice input mode selection', () => {
  test('prefers buffered fallback inside mobile and wechat environments', () => {
    expect(
      shouldPreferBufferedVoiceInput({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.54',
        maxTouchPoints: 5,
      })
    ).toBeTruthy();

    expect(
      shouldPreferBufferedVoiceInput({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36',
        maxTouchPoints: 5,
      })
    ).toBeTruthy();
  });

  test('keeps native recognition eligible on desktop browsers', () => {
    expect(
      shouldPreferBufferedVoiceInput({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
        maxTouchPoints: 0,
      })
    ).toBeFalsy();
  });
});
