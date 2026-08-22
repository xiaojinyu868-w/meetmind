/**
 * 临时试听脚本：cosyvoice-v3-flash 课堂教学情感指令横向对比（v27 选情感用）。
 *
 * 用法：DASHSCOPE_API_KEY 注入后 npx tsx scripts/try-tts-emotions.ts
 * 产出：public/demo/tts-samples/emo__<label>.wav + 字级时间戳兼容性报告。
 * 文本取 demo 板书真实 narration（一段讲解 + 一段提问），确保试听场景一致。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const API_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();
if (!API_KEY) {
  console.error('需要 DASHSCOPE_API_KEY');
  process.exit(1);
}

const script = JSON.parse(readFileSync('public/demo/board-script.json', 'utf8')) as {
  script: { pages: { segments: { narrationDisplay?: string; narration?: string }[] }[] };
};
const all = script.script.pages
  .flatMap((p) => p.segments)
  .map((s) => s.narrationDisplay ?? s.narration ?? '')
  .filter((t) => t.length > 15 && !t.startsWith('「'));
const TEXT = all[1] ?? all[0] ?? '同学们看黑板，今天我们讲这一段的重点，关键的地方我会停下来。';

const CANDIDATES: { label: string; instruction?: string }[] = [
  { label: 'neutral-基线', instruction: '你正在进行课堂教学，你说话的情感是neutral。' },
  { label: 'happy-枚举', instruction: '你正在进行课堂教学，你说话的情感是happy。' },
  { label: '热情-中文', instruction: '你正在进行课堂教学，你说话的情感是热情。' },
  {
    label: '自由指令',
    instruction:
      '你是一位亲切耐心的年轻女老师，正在教室里给学生讲课：重点处放慢加重，提问处语气上扬，句间自然换气，吐字清晰，不要播音腔。',
  },
];

interface Word {
  text: string;
  begin_time: number;
  end_time: number;
}

async function run(label: string, instruction?: string) {
  const started = Date.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: 'cosyvoice-v3-flash',
        input: {
          text: TEXT,
          voice: 'longanhuan',
          format: 'wav',
          sample_rate: 24000,
          word_timestamp_enabled: true,
          ...(instruction ? { instruction } : {}),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.log(`emo__${label}: HTTP ${response.status} ${(await response.text()).slice(0, 160)}`);
      return;
    }
    const raw = await response.text();
    const chunks: Buffer[] = [];
    let words: Word[] = [];
    let error: string | null = null;
    for (const block of raw.split('\n\n')) {
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let event: {
        code?: string;
        message?: string;
        output?: { audio?: { data?: string }; sentence?: { words?: Word[] } };
      };
      try {
        event = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (event.code) error = `${event.code}: ${event.message ?? ''}`;
      if (event.output?.audio?.data) chunks.push(Buffer.from(event.output.audio.data, 'base64'));
      const w = event.output?.sentence?.words;
      if (w && w.length > words.length) words = w;
    }
    if (error) {
      console.log(`emo__${label}: 引擎报错 ${error.slice(0, 160)}`);
      return;
    }
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) {
      console.log(`emo__${label}: 无音频`);
      return;
    }
    mkdirSync('public/demo/tts-samples', { recursive: true });
    writeFileSync(`public/demo/tts-samples/emo__${label}.wav`, audio);
    console.log(
      `emo__${label}: OK ${(audio.length / 1024).toFixed(0)}KB ${Date.now() - started}ms ` +
        `字级时间戳=${words.length > 0 ? `有(${words.length}词)` : '无'}`,
    );
  } catch (cause) {
    console.log(`emo__${label}: 异常 ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function main() {
  console.log(`试听文本: ${TEXT}\n`);
  for (const c of CANDIDATES) {
    await run(c.label, c.instruction);
  }
}

void main();
