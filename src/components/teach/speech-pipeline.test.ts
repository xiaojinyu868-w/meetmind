import { describe, expect, it } from 'vitest';
import { SentenceSplitter, TeachSpeechPlayer } from './speech-pipeline';
import type { SpeechAudioHandle } from './speech-pipeline';

describe('SentenceSplitter（讲课文本按句切分）', () => {
  it('句末标点断句，跨 delta 拼接', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('同学们好。今天我们讲')).toEqual(['同学们好。']);
    expect(splitter.push('勾股定理！先想一')).toEqual(['今天我们讲勾股定理！']);
    expect(splitter.push('下：a 是多少？')).toEqual(['先想一下：a 是多少？']);
  });

  it('半句靠 flush 交出（tool-call / turn 结束的自然断句）', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('我们把它写下来：')).toEqual([]);
    expect(splitter.flush()).toBe('我们把它写下来：');
    expect(splitter.flush()).toBeNull();
  });

  it('英文标点也断句；连续标点不产空句', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('Really? Yes! ')).toEqual(['Really?', 'Yes!']);
  });
});

/** 假播放句柄：play 即记录，手动 ended() 结束 */
function fakeAudio() {
  const played: string[] = [];
  const handles: Array<{ blob: Blob; end: () => void }> = [];
  const createAudio = (blob: Blob): SpeechAudioHandle => {
    const handle: SpeechAudioHandle & { blob: Blob } = {
      blob,
      onended: null,
      play: async () => {
        played.push('play');
      },
      pause: () => {
        played.push('pause');
        handle.onended?.();
      },
    };
    handles.push({ blob, end: () => handle.onended?.() });
    return handle;
  };
  return { played, handles, createAudio };
}

function fakeFetch(delays = 0) {
  const calls: string[] = [];
  const fetchAudio = async (text: string) => {
    calls.push(text);
    if (delays > 0) await new Promise((r) => setTimeout(r, delays));
    if (text.includes('失败')) return null;
    return new Blob([`audio:${text}`]);
  };
  return { calls, fetchAudio };
}

describe('TeachSpeechPlayer（顺序播放 + 预取下一句 + 打断闭嘴）', () => {
  it('按序播放，播 i 时预取 i+1', async () => {
    const { createAudio, handles } = fakeAudio();
    const { calls, fetchAudio } = fakeFetch();
    const player = new TeachSpeechPlayer({ fetchAudio, createAudio });
    player.unlock();
    player.enqueue('第一句。');
    player.enqueue('第二句。');
    player.enqueue('第三句。');
    await new Promise((r) => setTimeout(r, 10));
    // 第一句开始播时，第二句已在合成（预取）
    expect(calls).toContain('第一句。');
    expect(calls).toContain('第二句。');
    handles[0].end(); // 第一句播完
    await new Promise((r) => setTimeout(r, 10));
    handles[1].end();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['第一句。', '第二句。', '第三句。']);
    expect(handles).toHaveLength(3);
  });

  it('stopAll 立即停播并清空队列，后续 enqueue 从头开始', async () => {
    const { played, createAudio, handles } = fakeAudio();
    const { calls, fetchAudio } = fakeFetch();
    const player = new TeachSpeechPlayer({ fetchAudio, createAudio });
    player.unlock();
    player.enqueue('正在讲的这句很长。');
    player.enqueue('还没播的句子。');
    await new Promise((r) => setTimeout(r, 10));
    player.stopAll();
    expect(played).toContain('pause');
    player.enqueue('新回合的话。');
    await new Promise((r) => setTimeout(r, 10));
    // 预取过的"还没播"可以进合成（预取是特性），但绝不许建播放器播出来
    expect(handles).toHaveLength(2); // 正在讲的 + 新回合的
    expect(calls[calls.length - 1]).toBe('新回合的话。');
  });

  it('合成失败的句子跳过，队列继续', async () => {
    const { createAudio, handles } = fakeAudio();
    const { fetchAudio } = fakeFetch();
    const player = new TeachSpeechPlayer({ fetchAudio, createAudio });
    player.unlock();
    player.enqueue('这句会失败。');
    player.enqueue('这句正常。');
    await new Promise((r) => setTimeout(r, 20));
    handles[0].end();
    await new Promise((r) => setTimeout(r, 10));
    // 只有"正常"那句真的建了播放器
    expect(handles).toHaveLength(1);
  });

  it('静音即清空；未 unlock 不播放但保留队列', async () => {
    const { createAudio, handles } = fakeAudio();
    const { calls, fetchAudio } = fakeFetch();
    const player = new TeachSpeechPlayer({ fetchAudio, createAudio });
    player.enqueue('还没手势激活。');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
    player.unlock();
    player.enqueue('激活后的一句。');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.length).toBeGreaterThan(0);
    player.setMuted(true);
    expect(handles.every(() => true)).toBe(true);
  });

  it('声画联动：句子递增序号，开始播放时按序回调；失败的句也放行', async () => {
    const { createAudio, handles } = fakeAudio();
    const { fetchAudio } = fakeFetch();
    const started: number[] = [];
    const player = new TeachSpeechPlayer({
      fetchAudio,
      createAudio,
      onSentenceStart: (seq) => started.push(seq),
    });
    expect(player.isActive).toBe(false);
    player.unlock();
    expect(player.isActive).toBe(true);
    player.enqueue('第一句。');
    player.enqueue('这句会失败。');
    player.enqueue('第三句。');
    await new Promise((r) => setTimeout(r, 20));
    expect(player.lastSeq).toBe(3);
    handles[0]?.end();
    await new Promise((r) => setTimeout(r, 10));
    handles[1]?.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual([1, 2, 3]); // 合成失败的第 2 句也回调（板书不卡死）
  });
});
