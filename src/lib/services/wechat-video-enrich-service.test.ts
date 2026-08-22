import { describe, expect, it } from 'vitest';
import {
  buildDuplicatePushText,
  buildImportDonePushText,
  buildImportFailedPushText,
  buildXiaoyuzhouDisplayTitle,
  hasImportedVideo,
  pickDuplicateImport,
  resolveImportPlatform,
} from './wechat-video-enrich-service';
import { normalizeWechatMpMessage } from './wechat-mp-service';
import { COPY } from '@/lib/ui/copy';

describe('resolveImportPlatform（导入平台标签泛化映射）', () => {
  it('bilibili：provider 或 sourceMode 都映射到哔哩哔哩', () => {
    expect(resolveImportPlatform({ sourceMode: 'bili-native', source: { provider: 'bilibili' } }))
      .toEqual({ platformId: 'bilibili', platformLabel: '哔哩哔哩' });
    expect(resolveImportPlatform({ sourceMode: 'bili-subtitle', source: {} }))
      .toEqual({ platformId: 'bili-subtitle', platformLabel: '哔哩哔哩' });
  });

  it('xiaoyuzhou 映射到小宇宙播客（不再硬编码哔哩哔哩）', () => {
    expect(resolveImportPlatform({ sourceMode: 'xiaoyuzhou', source: { provider: 'xiaoyuzhou' } }))
      .toEqual({ platformId: 'xiaoyuzhou', platformLabel: '小宇宙播客' });
  });

  it('未映射的平台兜底 providerLabel，最后兜底「视频」', () => {
    expect(resolveImportPlatform({ sourceMode: 'yt-dlp', source: { provider: 'youtube', providerLabel: 'YouTube' } }))
      .toEqual({ platformId: 'youtube', platformLabel: 'YouTube' });
    expect(resolveImportPlatform({ sourceMode: 'direct', source: { providerLabel: 'Web Video' } }))
      .toEqual({ platformId: 'direct', platformLabel: 'Web Video' });
    expect(resolveImportPlatform({})).toEqual({ platformId: 'video', platformLabel: '视频' });
  });
});

describe('buildXiaoyuzhouDisplayTitle', () => {
  it('有播客名时拼「播客名 - 单集名」', () => {
    expect(buildXiaoyuzhouDisplayTitle({ title: 'E12 聊聊拖延', podcastTitle: '自习室' }))
      .toBe('自习室 - E12 聊聊拖延');
  });

  it('没有播客名时只用单集名', () => {
    expect(buildXiaoyuzhouDisplayTitle({ title: 'E12 聊聊拖延' })).toBe('E12 聊聊拖延');
  });
});

describe('小宇宙去重判断', () => {
  it('hasImportedVideo 只看 videoImported === true', () => {
    expect(hasImportedVideo('{"videoImported":true}')).toBe(true);
    expect(hasImportedVideo('{"videoImported":false}')).toBe(false);
    expect(hasImportedVideo('{}')).toBe(false);
    expect(hasImportedVideo('not-json')).toBe(false);
    expect(hasImportedVideo(null)).toBe(false);
  });

  it('pickDuplicateImport 挑出「别的消息收过且已转写」的那条', () => {
    const candidates = [
      { sourceKey: 'wechat:current-token', metadataJson: '{"videoImported":true}' },
      { sourceKey: 'wechat:older-token', metadataJson: '{"videoImported":true}' },
      { sourceKey: 'wechat:link-only', metadataJson: null },
    ];
    const picked = pickDuplicateImport(candidates, 'wechat:current-token');
    expect(picked?.sourceKey).toBe('wechat:older-token');
  });

  it('本次消息自己的收集不算重复；没有已转写记录时返回 null', () => {
    expect(pickDuplicateImport(
      [{ sourceKey: 'wechat:current-token', metadataJson: '{"videoImported":true}' }],
      'wechat:current-token',
    )).toBeNull();
    expect(pickDuplicateImport(
      [{ sourceKey: 'wechat:older-token', metadataJson: '{"videoImported":false}' }],
      'wechat:current-token',
    )).toBeNull();
  });
});

describe('客服推送文案组装', () => {
  it('完成推送：标题 + 约 N 分钟 + 打开链接', () => {
    const text = buildImportDonePushText('自习室 - E12 聊聊拖延', 5987, 'https://mm.example/wechat/open/tok');
    expect(text).toContain('《自习室 - E12 聊聊拖延》转写好了');
    expect(text).toContain('约 100 分钟');
    expect(text).toContain(COPY.wechatPodcast.importDoneCta);
    expect(text).toContain('https://mm.example/wechat/open/tok');
  });

  it('时长不足一分钟按一分钟算', () => {
    expect(buildImportDonePushText('短集', 20, 'https://x/')).toContain('约 1 分钟');
  });

  it('失败推送：带原因（过长截断）与不带原因', () => {
    expect(buildImportFailedPushText('音频下载失败')).toBe('这集转写没成功（音频下载失败），可以再发一次试试。');
    const longReason = 'x'.repeat(80);
    const clipped = buildImportFailedPushText(longReason);
    expect(clipped.length).toBeLessThan(80);
    expect(clipped).toContain('可以再发一次试试');
    expect(buildImportFailedPushText()).toBe('这集转写没成功，可以再发一次试试。');
  });

  it('重复推送：「这集之前收过了」+ 原收集链接', () => {
    const text = buildDuplicatePushText('https://mm.example/wechat/open/orig');
    expect(text).toContain(COPY.wechatPodcast.duplicate);
    expect(text).toContain('https://mm.example/wechat/open/orig');
  });
});

describe('小宇宙链接的即时回执', () => {
  it('文字消息里的小宇宙链接用播客专属回执', () => {
    const normalized = normalizeWechatMpMessage({
      MsgType: 'text',
      Content: '这集不错 https://www.xiaoyuzhoufm.com/episode/6a69b07eb581962ce2bd4d97',
    });
    expect(normalized.reach?.channel).toBe('video-link');
    expect(normalized.replyText).toBe(COPY.wechatPodcast.receipt);
  });

  it('其他视频链接维持泛回执', () => {
    const normalized = normalizeWechatMpMessage({
      MsgType: 'text',
      Content: 'https://www.bilibili.com/video/BV1xx411c7mD',
    });
    expect(normalized.reach?.channel).toBe('video-link');
    expect(normalized.replyText).not.toBe(COPY.wechatPodcast.receipt);
  });
});
