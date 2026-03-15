import { expect, test } from '@playwright/test';
import {
  buildWechatVoicePreviewText,
  buildWechatVoiceTutorContext,
  isWechatPlayableAudioUrl,
  normalizeWechatMediaPublicPath,
} from '../../src/lib/services/wechat-voice-utils';

test.describe('wechat voice utils', () => {
  test('normalizes public media paths from relative and absolute urls', async () => {
    expect(normalizeWechatMediaPublicPath('/wechat-media/voice/demo.mp3')).toBe('/wechat-media/voice/demo.mp3');
    expect(
      normalizeWechatMediaPublicPath('https://capture.meetmind.online/wechat-media/voice/demo.mp3?ts=1')
    ).toBe('/wechat-media/voice/demo.mp3?ts=1');
    expect(normalizeWechatMediaPublicPath('https://example.com/audio.mp3')).toBeNull();
  });

  test('detects browser-playable voice urls and rejects amr', async () => {
    expect(isWechatPlayableAudioUrl('/wechat-media/voice/demo.mp3')).toBeTruthy();
    expect(isWechatPlayableAudioUrl('/wechat-media/voice/demo.m4a')).toBeTruthy();
    expect(isWechatPlayableAudioUrl('/wechat-media/voice/demo.amr')).toBeFalsy();
    expect(isWechatPlayableAudioUrl(null)).toBeFalsy();
  });

  test('builds readable preview and tutor context from transcript', async () => {
    const transcript = '老师这里在讲为什么导数大于零可以推出函数单调递增，我卡在符号和变化趋势的连接上。';
    const preview = buildWechatVoicePreviewText(transcript);
    const tutorContext = buildWechatVoiceTutorContext(transcript);

    expect(preview).toContain('语音：');
    expect(preview).toContain('导数大于零');
    expect(tutorContext).toContain('语音转写：');
    expect(tutorContext).toContain('课堂场景');
  });
});
