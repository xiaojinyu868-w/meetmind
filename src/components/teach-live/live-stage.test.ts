import { describe, expect, it } from 'vitest';
import type { TeachStreamEvent } from '@/lib/services/teach-codex/event-bus';
import { Director, SentenceCutter, cleanSpeechText, estimateSpeechMs, type Beat, type SpeechPort } from './director';
import { activePage, createLessonState, isSpeechKind, lessonReducer, resolveTarget, type LessonState } from './live-model';
import { LiveMarkupParser } from '@/lib/services/teach-live/live-markup-parser';

/** 用真解析器把一段老师输出变成服务端事件（与 teach-live-service 的映射一致） */
function eventsFromMarkup(markup: string): TeachStreamEvent[] {
  const parser = new LiveMarkupParser();
  const out: TeachStreamEvent[] = [];
  const openKinds = new Map<string, string>();
  const forward = (ev: ReturnType<LiveMarkupParser['push']>[number]) => {
    if (ev.type === 'block-open') openKinds.set(ev.id, ev.kind);
    if (ev.type === 'block-delta') {
      const kind = openKinds.get(ev.id);
      if (kind === 'say' || kind === 'ask') {
        out.push({ type: 'text-delta', text: ev.text });
        return;
      }
    }
    out.push(ev);
  };
  for (let i = 0; i < markup.length; i += 7) parser.push(markup.slice(i, i + 7)).forEach(forward);
  parser.finish().forEach(forward);
  out.push({ type: 'turn-complete' });
  return out;
}

const LESSON = `<say>今天不背公式。先看一个直角三角形。</say>
<scene title="勾股定理"/>
<svg id="tri" viewBox="0 0 800 450"><line x1="1" y1="1" x2="2" y2="2"/></svg>
<say>横着的叫 a，竖着的叫 b。</say>
<point at="tri"/>
<svg into="tri"><g id="hyp"><line x1="0" y1="0" x2="5" y2="5"/></g></svg>
<say>这条斜边叫 c。</say>
<scene title="拼图"/>
<math id="thm">a^2+b^2=c^2</math>
<highlight at="thm"/>
<ask>你猜平方在图上是什么？</ask>`;

/** 假语音口：每句立刻“开始”，记录顺序 */
class FakeSpeech implements SpeechPort {
  spoken: string[] = [];
  stopped = 0;
  speak(text: string): Promise<boolean> {
    this.spoken.push(text);
    return Promise.resolve(true);
  }
  stop(): void {
    this.stopped++;
  }
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** 模拟 useLiveLesson 的接线：事件 → reducer + Director beats */
function wire(events: TeachStreamEvent[]) {
  let state: LessonState = createLessonState({ threadId: 't', title: '勾股定理为什么成立', topic: '勾股定理为什么成立' });
  const dispatch = (action: Parameters<typeof lessonReducer>[1]) => {
    state = lessonReducer(state, action);
  };
  const speech = new FakeSpeech();
  const timeline: string[] = [];
  const director = new Director(speech, {
    onReveal: (segmentId) => {
      timeline.push(`reveal:${segmentId}`);
      dispatch({ type: 'reveal', segmentId });
    },
    onCue: (name, args) => {
      timeline.push(`cue:${name}`);
      if (name === 'point') return;
      dispatch({ type: 'stage-cue', name, args });
    },
    onCaption: (text, meta) => {
      if (meta.phase === 'speaking' && text) timeline.push(`say:${text}`);
    },
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  const cutter = new SentenceCutter();
  let speechBlock: { id: string; ask: boolean } | null = null;
  dispatch({ type: 'student-message', text: '开始上课', silent: true });
  for (const ev of events) {
    dispatch({ type: 'server', event: ev });
    if (ev.type === 'block-open') {
      if (isSpeechKind(ev.kind)) {
        cutter.reset();
        speechBlock = { id: ev.id, ask: ev.kind === 'ask' };
      } else director.push({ kind: 'reveal', segmentId: ev.id, blockId: ev.id } as Beat);
    } else if (ev.type === 'text-delta' && speechBlock) {
      for (const s of cutter.push(ev.text)) director.push({ kind: 'speech', blockId: speechBlock.id, text: s, ask: speechBlock.ask });
    } else if (ev.type === 'block-close' && speechBlock?.id === ev.id) {
      const rest = cutter.flush();
      if (rest) director.push({ kind: 'speech', blockId: speechBlock.id, text: rest, ask: speechBlock.ask });
      if (speechBlock.ask) director.push({ kind: 'reveal', segmentId: ev.id, blockId: ev.id });
      speechBlock = null;
    } else if (ev.type === 'cue') {
      director.push({ kind: 'cue', name: ev.name, args: ev.args });
    }
  }
  return { get state() { return state; }, director, speech, timeline };
}

describe('live stage pipeline (reducer + director)', () => {
  it('arrival puts blocks on the right pages while the stage follows the director', async () => {
    const events = eventsFromMarkup(LESSON);
    const w = wire(events);
    // 到达完成：两页都建好了，但演出还没开始推进 → 舞台仍在首页
    expect(w.state.pages.map((p) => p.title)).toEqual(['勾股定理', '拼图']);
    expect(w.state.sceneQueue.length).toBe(2);
    expect(w.state.title).toBe('勾股定理');
    await flushMicrotasks(200);
    // 演出跑完：顺序 = 说 → 翻页 → 画 → 说 → 指 → 补画 → 说 → 翻页 → 公式 → 强调 → 问
    expect(w.timeline).toEqual([
      'say:今天不背公式。',
      'say:先看一个直角三角形。',
      'cue:scene',
      'reveal:lb_2',
      'say:横着的叫 a，竖着的叫 b。',
      'cue:point',
      'reveal:lb_4',
      'say:这条斜边叫 c。',
      'cue:scene',
      'reveal:lb_6',
      'cue:highlight',
      'say:你猜平方在图上是什么？',
      'reveal:lb_7',
    ]);
    expect(activePage(w.state).title).toBe('拼图');
    expect(w.state.sceneQueue).toEqual([]);
    // 追加的 into segment 挂在 tri 上，两段都已揭示
    const tri = w.state.blocks[resolveTarget(w.state, 'tri')!.blockId];
    expect(tri.segments.map((s) => s.revealed)).toEqual([true, true]);
    expect(tri.segments[1].text).toContain('id="hyp"');
    // 公式被强调，ask 卡在第二页且成为待回答
    expect(w.state.blocks[resolveTarget(w.state, 'thm')!.blockId].highlighted).toBe(true);
    expect(w.state.pendingAsk).toBe('你猜平方在图上是什么？');
    expect(w.state.pages[1].blockIds).toHaveLength(2);
    expect(w.state.transcript.filter((t) => t.role === 'teacher').map((t) => t.text)).toEqual([
      '今天不背公式。先看一个直角三角形。',
      '横着的叫 a，竖着的叫 b。',
      '这条斜边叫 c。',
      '你猜平方在图上是什么？',
    ]);
  });

  it('interrupt discards unrevealed content and empty pages', async () => {
    const events = eventsFromMarkup(LESSON);
    const w = wire(events);
    // 一个 beat 都没演：全部丢弃 → 板上无块、第二页撤掉、首页保留
    w.director.reset();
    let s = lessonReducer(w.state, { type: 'discard-unrevealed' });
    expect(Object.values(s.blocks).filter((b) => !isSpeechKind(b.kind))).toHaveLength(0);
    expect(s.pages).toHaveLength(1);
    expect(s.sceneQueue).toEqual([]);
    expect(w.speech.stopped).toBe(1);
    // 学生开口后 generating 重新为 true
    s = lessonReducer(s, { type: 'student-message', text: '等等，什么是斜边？' });
    expect(s.generating).toBe(true);
    expect(s.transcript[s.transcript.length - 1].text).toBe('等等，什么是斜边？');
  });

  it('replay reveals everything immediately and lands on the last page', () => {
    let state = createLessonState({ threadId: 't', title: 'x', topic: 'x' });
    for (const ev of eventsFromMarkup(LESSON)) state = lessonReducer(state, { type: 'server', event: ev, replay: true });
    expect(activePage(state).title).toBe('拼图');
    expect(Object.values(state.blocks).every((b) => b.segments.every((s) => s.revealed))).toBe(true);
    expect(state.pendingAsk).toBe('你猜平方在图上是什么？');
  });
});

describe('director helpers', () => {
  it('cuts sentences on CJK punctuation and flushes the tail', () => {
    const c = new SentenceCutter();
    expect(c.push('你好。我是')).toEqual(['你好。']);
    expect(c.push('老师！今天')).toEqual(['我是老师！']);
    expect(c.flush()).toBe('今天');
  });
  it('cleans tags and markdown from speech', () => {
    expect(cleanSpeechText('看<b>这里</b>，**重点** ==高亮==')).toBe('看这里，重点 高亮');
  });
  it('estimates speech length with floor and cap', () => {
    expect(estimateSpeechMs('好')).toBe(700);
    expect(estimateSpeechMs('一二三四五六七八九十')).toBe(1700);
  });
  it('a silent speech port paces by estimate instead of stalling', async () => {
    const slept: number[] = [];
    let now = 0;
    const d = new Director(
      { speak: () => Promise.resolve(false), stop: () => undefined },
      {
        onReveal: () => undefined,
        onCue: () => undefined,
        onCaption: () => undefined,
        sleep: (ms) => {
          slept.push(ms);
          now += ms;
          return Promise.resolve();
        },
        now: () => now,
      },
    );
    d.push({ kind: 'speech', blockId: 'a', text: '一二三四五六七八九十', ask: false });
    d.push({ kind: 'speech', blockId: 'a', text: '好', ask: false });
    await flushMicrotasks(50);
    // 第二句等了第一句的估时 1700ms
    expect(slept).toContain(1700);
  });
});

describe('draw-fix 事件（自愈脚本落日志后回看替换原段）', () => {
  it('replaces the broken segment text of a draw block; other kinds untouched', () => {
    let state: LessonState = createLessonState({ threadId: 't', title: '', topic: '' });
    for (const ev of eventsFromMarkup(`<draw id="fig">circle(O, 3);</draw><math id="eq">x</math>`)) state = lessonReducer(state, { type: 'server', event: ev, replay: true });
    const fig = Object.values(state.blocks).find((b) => b.kind === 'draw')!;
    const eq = Object.values(state.blocks).find((b) => b.kind === 'math')!;
    state = lessonReducer(state, { type: 'server', event: { type: 'draw-fix', segmentId: fig.segments[0].id, script: 'const O = point(0, 0, "O");\ncircle(O, 3);', error: 'ReferenceError: O' }, replay: true });
    expect(state.blocks[fig.id].segments[0].text).toContain('const O = point');
    state = lessonReducer(state, { type: 'server', event: { type: 'draw-fix', segmentId: eq.segments[0].id, script: 'nope', error: 'x' }, replay: true });
    expect(state.blocks[eq.id].segments[0].text).toBe('x');
  });
});
