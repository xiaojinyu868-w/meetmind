import { describe, expect, it } from 'vitest';
import { LiveMarkupParser, collectBlockBodies, parseLiveAttrs } from '../live-markup-parser';
import type { LiveEvent } from '@/types/teach-live';

function parseAll(text: string, chunkSizes?: number[]): LiveEvent[] {
  const parser = new LiveMarkupParser();
  const out: LiveEvent[] = [];
  if (!chunkSizes) {
    out.push(...parser.push(text));
  } else {
    let i = 0;
    let k = 0;
    while (i < text.length) {
      const size = chunkSizes[k++ % chunkSizes.length];
      out.push(...parser.push(text.slice(i, i + size)));
      i += size;
    }
  }
  out.push(...parser.finish());
  return out;
}

/** 去掉 delta，只留结构（open/close/cue），并把正文合并回 open 上便于断言 */
function structure(events: LiveEvent[]) {
  const bodies = collectBlockBodies(events);
  return events
    .filter((e) => e.type !== 'block-delta')
    .map((e) => {
      if (e.type === 'block-open') return { open: e.kind, attrs: e.attrs, body: bodies.get(e.id) };
      if (e.type === 'block-close') return { close: e.complete };
      return { cue: e.name, args: e.args };
    });
}

const SAMPLE = `<say>我们先看一个直角三角形。</say>
<scene title="勾股定理"/>
<svg viewBox="0 0 400 300">
  <line x1="50" y1="250" x2="350" y2="250" stroke="#20312A" stroke-width="3"/>
  <text x="200" y="280" font-size="18">a</text>
</svg>
<say>注意这条边，我们叫它斜边。</say>
<point at="hyp"/>
<math label="勾股定理">a^2 + b^2 = c^2</math>
<note title="要点">- 直角边 a、b
- 斜边 c，对着直角</note>
<image prompt="埃及金字塔的测量场景，水彩" alt="金字塔"/>
<ask>如果 a 变大，c 会怎样？</ask>`;

describe('LiveMarkupParser', () => {
  it('parses a full sample into blocks and cues in order', () => {
    const s = structure(parseAll(SAMPLE));
    expect(s).toEqual([
      { open: 'say', attrs: {}, body: '我们先看一个直角三角形。' },
      { close: true },
      { cue: 'scene', args: { title: '勾股定理' } },
      {
        open: 'svg',
        attrs: { viewbox: '0 0 400 300' },
        body: expect.stringContaining('<line x1="50"'),
      },
      { close: true },
      { open: 'say', attrs: {}, body: '注意这条边，我们叫它斜边。' },
      { close: true },
      { cue: 'point', args: { at: 'hyp' } },
      { open: 'math', attrs: { label: '勾股定理' }, body: 'a^2 + b^2 = c^2' },
      { close: true },
      { open: 'note', attrs: { title: '要点' }, body: '- 直角边 a、b\n- 斜边 c，对着直角' },
      { close: true },
      { open: 'image', attrs: { prompt: '埃及金字塔的测量场景，水彩', alt: '金字塔' }, body: '' },
      { close: true },
      { open: 'ask', attrs: {}, body: '如果 a 变大，c 会怎样？' },
      { close: true },
    ]);
  });

  it('is chunk-boundary invariant (1..7 char chunks reproduce the same structure)', () => {
    const reference = structure(parseAll(SAMPLE));
    for (const sizes of [[1], [2], [3], [5, 1, 7], [7], [4, 11, 2]]) {
      expect(structure(parseAll(SAMPLE, sizes))).toEqual(reference);
    }
  });

  it('turns bare text into an implicit say and keeps "<" comparisons as speech', () => {
    const events = parseAll('当 a<b 时，a 的平方也更小。<math>a^2 < b^2</math>');
    expect(structure(events)).toEqual([
      { open: 'say', attrs: {}, body: '当 a<b 时，a 的平方也更小。' },
      { close: true },
      { open: 'math', attrs: {}, body: 'a^2 < b^2' },
      { close: true },
    ]);
  });

  it('holds back a possible tag prefix at a chunk boundary but not arbitrary "<x"', () => {
    const parser = new LiveMarkupParser();
    const a = parser.push('先说一句<sv');
    // "<sv" 可能是 <svg，此时不应作为口播吐出
    const aText = a.filter((e) => e.type === 'block-delta').map((e) => (e as { text: string }).text).join('');
    expect(aText).toBe('先说一句');
    const b = parser.push('g viewBox="0 0 1 1"><rect/></svg>');
    expect(structure([...a, ...b, ...parser.finish()])).toEqual([
      { open: 'say', attrs: {}, body: '先说一句' },
      { close: true },
      { open: 'svg', attrs: { viewbox: '0 0 1 1' }, body: '<rect/>' },
      { close: true },
    ]);

    const p2 = new LiveMarkupParser();
    const c = p2.push('x<y 就');
    const cText = c.filter((e) => e.type === 'block-delta').map((e) => (e as { text: string }).text).join('');
    expect(cText).toBe('x<y 就');
  });

  it('keeps raw mode inside explicit blocks (inner tags never close the block)', () => {
    const events = parseAll(
      '<note>有 <b>加粗</b> 和 </svg> 也没事</note><widget><svg><circle/></svg><script>1</script></widget>',
    );
    expect(structure(events)).toEqual([
      { open: 'note', attrs: {}, body: '有 <b>加粗</b> 和 </svg> 也没事' },
      { close: true },
      { open: 'widget', attrs: {}, body: '<svg><circle/></svg><script>1</script>' },
      { close: true },
    ]);
  });

  it('marks a truncated explicit block as incomplete on finish', () => {
    const events = parseAll('<say>开始了。</say><svg viewBox="0 0 10 10"><circle r="1"/>');
    expect(structure(events)).toEqual([
      { open: 'say', attrs: {}, body: '开始了。' },
      { close: true },
      { open: 'svg', attrs: { viewbox: '0 0 10 10' }, body: '<circle r="1"/>' },
      { close: false },
    ]);
  });

  it('strips markdown fences and drops stray closing tags', () => {
    const events = parseAll('```xml\n<say>你好。</say></say>\n<pause s="1"/>\n```');
    expect(structure(events)).toEqual([
      { open: 'say', attrs: {}, body: '你好。' },
      { close: true },
      { cue: 'pause', args: { s: '1' } },
    ]);
  });

  it('matches closing tags case-insensitively and treats unknown top-level tags as speech', () => {
    const events = parseAll('<SVG viewBox="0 0 1 1"><g/></SVG>好<br>继续');
    expect(structure(events)).toEqual([
      { open: 'svg', attrs: { viewbox: '0 0 1 1' }, body: '<g/>' },
      { close: true },
      { open: 'say', attrs: {}, body: '好<br>继续' },
      { close: true },
    ]);
  });

  it('parses attributes with single/double/no quotes and lowercases keys', () => {
    expect(parseLiveAttrs(`Title="勾股 > 定理" w=half id='fig1' viewBox="0 0 800 450"`)).toEqual({
      title: '勾股 > 定理',
      w: 'half',
      id: 'fig1',
      viewbox: '0 0 800 450',
    });
  });

  it('streams svg body deltas progressively (elements can render before close)', () => {
    const parser = new LiveMarkupParser();
    const out = [...parser.push('<svg viewBox="0 0 1 1"><rect x="0"/>'), ...parser.push('<circle r="1"/>')];
    const deltas = out.filter((e) => e.type === 'block-delta').map((e) => (e as { text: string }).text);
    expect(deltas.join('')).toBe('<rect x="0"/><circle r="1"/>');
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });
});
