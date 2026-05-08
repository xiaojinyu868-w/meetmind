import { describe, it, expect } from 'vitest';
import {
  detectMode,
  resolveRenderMode,
  modeRole,
  modeContract,
  formatTimestamp,
  toTimestamp,
  toStringArray,
  toMatrix,
  toDialogue,
  pickEvidenceSegments,
} from './studio-workshop.types';

// ── detectMode ─────────────────────────────────────────────────────

describe('detectMode', () => {
  it('appKey 决定 mode（agent-native 姿态）', () => {
    expect(detectMode('随便什么', 'audio-overview')).toBe('podcast');
    expect(detectMode('随便什么', 'infographic')).toBe('infographic');
    expect(detectMode('随便什么', 'slides')).toBe('slides');
    expect(detectMode('随便什么', 'table')).toBe('table');
    expect(detectMode('随便什么', 'video')).toBe('video');
    expect(detectMode('随便什么', 'report')).toBe('report');
    expect(detectMode('随便什么', 'podcast')).toBe('podcast');
  });

  it('未识别 appKey 退化为 general', () => {
    expect(detectMode('随便什么', 'mindmap')).toBe('general');
    expect(detectMode('随便什么', 'quiz')).toBe('general');
    expect(detectMode('随便什么', 'flashcards')).toBe('general');
  });

  it('不再用 intent 关键词匹配——全部落到 general', () => {
    // Agent-native 原则：插件不 "猜" 用户意图，分派权完全在上游 agent
    expect(detectMode('帮我生成播客')).toBe('general');
    expect(detectMode('视频总览')).toBe('general');
    expect(detectMode('生成报告')).toBe('general');
    expect(detectMode('制作信息图')).toBe('general');
    expect(detectMode('做幻灯片')).toBe('general');
    expect(detectMode('数据表格')).toBe('general');
    expect(detectMode('create audio overview')).toBe('general');
    expect(detectMode('你好世界')).toBe('general');
  });
});

// ── resolveRenderMode ──────────────────────────────────────────────

describe('resolveRenderMode', () => {
  it('podcast → audio', () => expect(resolveRenderMode('podcast')).toBe('audio'));
  it('slides → slides', () => expect(resolveRenderMode('slides')).toBe('slides'));
  it('table → table', () => expect(resolveRenderMode('table')).toBe('table'));
  it('video → script', () => expect(resolveRenderMode('video')).toBe('script'));
  it('infographic → custom', () => expect(resolveRenderMode('infographic')).toBe('custom'));
  it('general → document', () => expect(resolveRenderMode('general')).toBe('document'));
  it('report → document', () => expect(resolveRenderMode('report')).toBe('document'));
});

// ── modeRole ───────────────────────────────────────────────────────

describe('modeRole', () => {
  it('每种 mode 返回非空角色', () => {
    const modes = ['podcast', 'video', 'report', 'infographic', 'slides', 'table', 'general'] as const;
    for (const mode of modes) {
      expect(modeRole(mode)).toBeTruthy();
      expect(typeof modeRole(mode)).toBe('string');
    }
  });

  it('podcast 角色包含播客', () => {
    expect(modeRole('podcast')).toContain('播客');
  });
});

// ── modeContract ───────────────────────────────────────────────────

describe('modeContract', () => {
  it('返回合法 JSON 结构（至少包含 title 字段描述）', () => {
    const modes = ['podcast', 'video', 'report', 'infographic', 'slides', 'table', 'general'] as const;
    for (const mode of modes) {
      const contract = modeContract(mode);
      expect(contract).toContain('title');
    }
  });

  it('infographic 包含 imagePrompt 字段', () => {
    expect(modeContract('infographic')).toContain('imagePrompt');
  });

  it('slides 包含 slides 字段', () => {
    expect(modeContract('slides')).toContain('slides');
  });
});

// ── formatTimestamp ─────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('0ms → 0:00', () => expect(formatTimestamp(0)).toBe('0:00'));
  it('60000ms → 1:00', () => expect(formatTimestamp(60000)).toBe('1:00'));
  it('90500ms → 1:30', () => expect(formatTimestamp(90000)).toBe('1:30'));
  it('负数 → 0:00', () => expect(formatTimestamp(-1000)).toBe('0:00'));
  it('5分30秒 → 5:30', () => expect(formatTimestamp(330000)).toBe('5:30'));
  it('秒数补零', () => expect(formatTimestamp(5000)).toBe('0:05'));
});

// ── toTimestamp ─────────────────────────────────────────────────────

describe('toTimestamp', () => {
  it('数字直接返回（取整）', () => {
    expect(toTimestamp(12345.6, 0)).toBe(12345);
  });

  it('负数返回 0', () => {
    expect(toTimestamp(-100, 0)).toBe(0);
  });

  it('字符串数字转换', () => {
    expect(toTimestamp('5000', 0)).toBe(5000);
  });

  it('非法值返回 fallback', () => {
    expect(toTimestamp('not-a-number', 42)).toBe(42);
    expect(toTimestamp(null, 42)).toBe(42);
    expect(toTimestamp(undefined, 42)).toBe(42);
    expect(toTimestamp(NaN, 42)).toBe(42);
    expect(toTimestamp(Infinity, 42)).toBe(42);
  });
});

// ── toStringArray ──────────────────────────────────────────────────

describe('toStringArray', () => {
  it('正常数组', () => {
    expect(toStringArray(['a', 'b', 'c'], 10)).toEqual(['a', 'b', 'c']);
  });

  it('截断到 maxLength', () => {
    expect(toStringArray(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('过滤空字符串', () => {
    expect(toStringArray(['a', '', '  ', 'b'], 10)).toEqual(['a', 'b']);
  });

  it('非数组返回空', () => {
    expect(toStringArray('not array', 10)).toEqual([]);
    expect(toStringArray(null, 10)).toEqual([]);
  });

  it('非字符串元素转为空字符串并过滤', () => {
    expect(toStringArray([1, true, null], 10)).toEqual([]);
  });
});

// ── toMatrix ───────────────────────────────────────────────────────

describe('toMatrix', () => {
  it('正常二维数组', () => {
    const input = [['a', 'b'], ['c', 'd']];
    expect(toMatrix(input, 2, 10)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('列数截断', () => {
    const input = [['a', 'b', 'c']];
    expect(toMatrix(input, 2, 10)).toEqual([['a', 'b']]);
  });

  it('行数截断', () => {
    const input = [['a'], ['b'], ['c']];
    expect(toMatrix(input, 5, 2)).toEqual([['a'], ['b']]);
  });

  it('非数组返回空', () => {
    expect(toMatrix('not array', 2, 10)).toEqual([]);
  });

  it('空行被过滤', () => {
    const input = [['a'], [], ['b']];
    expect(toMatrix(input, 5, 10)).toEqual([['a'], ['b']]);
  });
});

// ── toDialogue ─────────────────────────────────────────────────────

describe('toDialogue', () => {
  it('正常对话数组', () => {
    const input = [{ speaker: '老师', line: '大家好' }, { speaker: '学生', line: '好' }];
    expect(toDialogue(input)).toEqual([
      { speaker: '老师', line: '大家好' },
      { speaker: '学生', line: '好' },
    ]);
  });

  it('过滤缺少 speaker 或 line 的项', () => {
    const input = [{ speaker: '', line: '好' }, { speaker: '老师', line: '' }, { speaker: '老师', line: '好' }];
    expect(toDialogue(input)).toEqual([{ speaker: '老师', line: '好' }]);
  });

  it('最多 28 条', () => {
    const input = Array.from({ length: 50 }, (_, i) => ({ speaker: `S${i}`, line: `L${i}` }));
    expect(toDialogue(input)).toHaveLength(28);
  });

  it('非数组返回空', () => {
    expect(toDialogue('not array')).toEqual([]);
    expect(toDialogue(null)).toEqual([]);
  });
});

// ── pickEvidenceSegments ───────────────────────────────────────────

describe('pickEvidenceSegments', () => {
  const segments = Array.from({ length: 10 }, (_, i) => ({
    id: `seg-${i}`,
    text: `Segment ${i}`,
    startMs: i * 10000,
    endMs: (i + 1) * 10000,
    confidence: 1.0,
    isFinal: true,
  }));

  it('count >= 总数时返回全部', () => {
    expect(pickEvidenceSegments(segments as any, 20)).toHaveLength(10);
  });

  it('均匀采样', () => {
    const picked = pickEvidenceSegments(segments as any, 3);
    expect(picked).toHaveLength(3);
    // 应包含首尾
    expect(picked[0]).toBe(segments[0]);
    expect(picked[picked.length - 1]).toBe(segments[9]);
  });

  it('count 为 1 时只取第一个', () => {
    const picked = pickEvidenceSegments(segments as any, 1);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toBe(segments[0]);
  });

  it('空数组', () => {
    expect(pickEvidenceSegments([], 5)).toHaveLength(0);
  });
});
