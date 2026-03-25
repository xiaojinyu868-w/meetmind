import { describe, it, expect } from 'vitest';
import {
  compactText,
  parseJsonArray,
  parseJsonObject,
  normalizeCaptureStatus,
  normalizeOptionalCaptureText,
  inferWechatContentType,
  buildWechatCaptureTitle,
  mimeTypeFromFilePath,
} from './workspace-context-types';

// ── compactText ────────────────────────────────────────────────────

describe('compactText', () => {
  it('短文本原样返回', () => {
    expect(compactText('hello', 10)).toBe('hello');
  });

  it('超长文本截断并加省略号', () => {
    expect(compactText('一二三四五六七八九十', 5)).toBe('一二...');
  });

  it('空白合并', () => {
    expect(compactText('  hello   world  ', 20)).toBe('hello world');
  });

  it('空字符串', () => {
    expect(compactText('', 10)).toBe('');
  });

  it('全空白字符串', () => {
    expect(compactText('   ', 10)).toBe('');
  });
});

// ── parseJsonArray ─────────────────────────────────────────────────

describe('parseJsonArray', () => {
  it('正常 JSON 数组', () => {
    expect(parseJsonArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  it('空值返回空数组', () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
    expect(parseJsonArray('')).toEqual([]);
  });

  it('非数组 JSON 返回空数组', () => {
    expect(parseJsonArray('{"a":1}')).toEqual([]);
  });

  it('无效 JSON 返回空数组', () => {
    expect(parseJsonArray('not json')).toEqual([]);
  });

  it('数组中的数字会转为字符串', () => {
    expect(parseJsonArray('[1, 2, 3]')).toEqual(['1', '2', '3']);
  });

  it('过滤空字符串元素', () => {
    expect(parseJsonArray('["a", "", "c"]')).toEqual(['a', 'c']);
  });
});

// ── parseJsonObject ────────────────────────────────────────────────

describe('parseJsonObject', () => {
  it('正常 JSON 对象', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('空值返回 null', () => {
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject(undefined)).toBeNull();
  });

  it('数组返回 null', () => {
    expect(parseJsonObject('[1,2]')).toBeNull();
  });

  it('无效 JSON 返回 null', () => {
    expect(parseJsonObject('not json')).toBeNull();
  });
});

// ── normalizeCaptureStatus ─────────────────────────────────────────

describe('normalizeCaptureStatus', () => {
  it('archived 保持不变', () => {
    expect(normalizeCaptureStatus('archived')).toBe('archived');
  });

  it('deleted 保持不变', () => {
    expect(normalizeCaptureStatus('deleted')).toBe('deleted');
  });

  it('其他值默认 active', () => {
    expect(normalizeCaptureStatus('unknown')).toBe('active');
    expect(normalizeCaptureStatus(null)).toBe('active');
    expect(normalizeCaptureStatus(undefined)).toBe('active');
  });
});

// ── normalizeOptionalCaptureText ───────────────────────────────────

describe('normalizeOptionalCaptureText', () => {
  it('undefined 保持 undefined', () => {
    expect(normalizeOptionalCaptureText(undefined)).toBeUndefined();
  });

  it('null 返回 null', () => {
    expect(normalizeOptionalCaptureText(null)).toBeNull();
  });

  it('空白字符串返回 null', () => {
    expect(normalizeOptionalCaptureText('   ')).toBeNull();
  });

  it('正常文本合并空白', () => {
    expect(normalizeOptionalCaptureText('  hello   world  ')).toBe('hello world');
  });
});

// ── inferWechatContentType ─────────────────────────────────────────

describe('inferWechatContentType', () => {
  it('voice → audio', () => {
    expect(inferWechatContentType({ msgType: 'voice' })).toBe('audio');
  });

  it('image → image', () => {
    expect(inferWechatContentType({ msgType: 'image' })).toBe('image');
  });

  it('video-link channel → video', () => {
    expect(inferWechatContentType({ msgType: 'link', reachChannel: 'video-link' })).toBe('video');
  });

  it('link → link', () => {
    expect(inferWechatContentType({ msgType: 'link' })).toBe('link');
  });

  it('text → text', () => {
    expect(inferWechatContentType({ msgType: 'text' })).toBe('text');
  });
});

// ── buildWechatCaptureTitle ────────────────────────────────────────

describe('buildWechatCaptureTitle', () => {
  it('有 title 时使用 title', () => {
    expect(buildWechatCaptureTitle({ title: '测试标题', msgType: 'text' })).toBe('测试标题');
  });

  it('voice 无 title → 微信语音', () => {
    expect(buildWechatCaptureTitle({ msgType: 'voice' })).toBe('微信语音');
  });

  it('image 无 title → 微信图片', () => {
    expect(buildWechatCaptureTitle({ msgType: 'image' })).toBe('微信图片');
  });

  it('link 无 title → 微信链接', () => {
    expect(buildWechatCaptureTitle({ msgType: 'link' })).toBe('微信链接');
  });

  it('event 无 title → 微信服务号消息', () => {
    expect(buildWechatCaptureTitle({ msgType: 'event' })).toBe('微信服务号消息');
  });

  it('其他 → 微信随手记', () => {
    expect(buildWechatCaptureTitle({ msgType: 'unknown' })).toBe('微信随手记');
  });
});

// ── mimeTypeFromFilePath ───────────────────────────────────────────

describe('mimeTypeFromFilePath', () => {
  it('.mp3 → audio/mpeg', () => {
    expect(mimeTypeFromFilePath('/tmp/recording.mp3')).toBe('audio/mpeg');
  });

  it('.m4a → audio/mp4', () => {
    expect(mimeTypeFromFilePath('/tmp/audio.m4a')).toBe('audio/mp4');
  });

  it('.wav → audio/wav', () => {
    expect(mimeTypeFromFilePath('/tmp/audio.wav')).toBe('audio/wav');
  });

  it('.flac → audio/flac', () => {
    expect(mimeTypeFromFilePath('/tmp/audio.flac')).toBe('audio/flac');
  });

  it('未知扩展名 → application/octet-stream', () => {
    expect(mimeTypeFromFilePath('/tmp/file.xyz')).toBe('application/octet-stream');
  });
});
