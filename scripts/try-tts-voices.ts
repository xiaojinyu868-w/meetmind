/**
 * 临时试听脚本：候选 TTS 模型 × 音色 横向对比（2026-08 选型用，验收后可删）。
 *
 * 用法：npx tsx scripts/try-tts-voices.ts
 * 产出：out/tts-samples/<model>__<voice>.wav + 时间戳兼容性报告。
 * 文本取 demo 板书的真实 narration，确保试听场景一致。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const API_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();
if (!API_KEY) {
  console.error('需要 DASHSCOPE_API_KEY');
  process.exit(1);
}

// 从 demo 脚本取两段真实 narration
const script = JSON.parse(readFileSync('public/demo/board-script.json', 'utf8')) as {
  script: { pages: { segments: { narrationDisplay?: string; narration?: string }[] }[] };
};
const all = script.script.pages.flatMap((p) => p.segments);
const TEXT =
  all.map((s) => s.narrationDisplay ?? s.narration ?? '').find((t) => t.length > 40) ??
  '同学们看黑板，今天我们讲这一段的重点。';

// 候选：新模型教师感音色（名字来自官方音色列表示例）+ 当前线上基线
const CANDIDATES: { model: string; voice: string; instruction?: string }[] = [
  // A. 当前线上基线
  { model: 'cosyvoice-v2', voice: 'longanpei' },
  // B. 同一教师音色，新一代模型
  { model: 'cosyvoice-v3-plus', voice: 'longanpei' },
  // C. 课堂教学场景指令（v3-flash 官方支持的场景）
  {
    model: 'cosyvoice-v3-flash',
    voice: 'longanhuan',
    instruction: '你正在进行课堂教学，你说话的情感是neutral。',
  },
  // D. 同音色不带指令对照
  { model: 'cosyvoice-v3-flash', voice: 'longanhuan' },
  // E. 最新一代旗舰（实测有时间戳）
  { model: 'qwen-audio-3.0-tts-plus', voice: 'longanhuan_v3.6' },
  // F. 旗舰 + 自由指令
  {
    model: 'qwen-audio-3.0-tts-plus',
    voice: 'longanhuan_v3.6',
    instruction: '亲切自然的年轻女老师，在教室里给学生讲课，语速适中偏快，吐字清晰，讲解连贯流畅，不要播音腔',
  },
];

interface Word {
  text: string;
  begin_time: number;
  end_time: number;
}

async function run(c: { model: string; voice: string; instruction?: string }, label: string) {
  const name = `${label}__${c.model}__${c.voice}${c.instruction ? '__instruct' : ''}`;
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
        model: c.model,
        input: {
          text: TEXT,
          voice: c.voice,
          format: 'wav',
          sample_rate: 24000,
          word_timestamp_enabled: true,
          ...(c.instruction ? { instruction: c.instruction } : {}),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.log(`${name}: HTTP ${response.status} ${await response.text().then((t) => t.slice(0, 120))}`);
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
      console.log(`${name}: 引擎报错 ${error.slice(0, 160)}`);
      return;
    }
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) {
      console.log(`${name}: 无音频`);
      return;
    }
    mkdirSync('public/demo/tts-samples', { recursive: true });
    writeFileSync(`public/demo/tts-samples/${name}.wav`, audio);
    console.log(
      `${name}: OK ${(audio.length / 1024).toFixed(0)}KB ${Date.now() - started}ms ` +
        `字级时间戳=${words.length > 0 ? `有(${words.length}词)` : '无'}`,
    );
  } catch (cause) {
    console.log(`${name}: 异常 ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function main() {
  console.log(`试听文本: ${TEXT}\n`);
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 0; i < CANDIDATES.length; i += 1) {
    await run(CANDIDATES[i], labels[i] ?? String(i));
  }
}

void main();
