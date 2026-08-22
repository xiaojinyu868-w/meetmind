/**
 * ab-vision-homework.ts —— 拍题审题 VLM A/B 实测（临时评估脚本）
 *
 * 对样例作业图分别调 qwen3.7-plus / qwen3-vl-plus（DashScope 兼容模式直连，
 * 绕过模型注册表），用与 photo-problem-service 相同的审题 prompt，
 * 打印解析结果、耗时与 token 用量，供定稿主力模型。
 *
 * 用法：npx tsx scripts/ab-vision-homework.ts [imagePath...]
 * 缺省跑 out/audit/sample-problem-1.png 和 sample-problem-2.png。
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';

const MODELS = ['qwen3.7-plus', 'qwen3-vl-plus'] as const;
const ENDPOINT =
  process.env.DASHSCOPE_VL_ENDPOINT?.trim() ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const EXTRACT_PROMPT = [
  '你是一位老师，学生拍了一张照片向你请教。请看清照片内容，只输出一个 JSON 对象（不要 markdown 代码围栏）：',
  '{"isProblem":true|false,"subject":"数学|物理|化学|英语|语文|其他","statement":"题目完整文本","figureDesc":"图形或图表的一句话描述","studentAttempt":"照片里学生已经写下的解答尝试"}',
  '要求：',
  '1. statement 必须逐字忠实于照片（数学公式用 LaTeX，行内 $...$）；印刷体与手写体都要认；看不清的字符用 ? 标出，绝不编造。',
  '2. 照片里有图形（几何图、函数图、图表）时，figureDesc 用一句话说清图形内容（点的位置、坐标轴、标注的量）；没有就留空字符串。',
  '3. 照片里除了题目还有学生手写的解题过程/草稿/答案时，逐字转录到 studentAttempt（公式同样 LaTeX）；没有就留空字符串。',
  '4. 照片里根本没有题目（风景、人物、纯笔记页等），只输出 {"isProblem":false}。',
].join('\n');

async function runModel(model: string, dataUrl: string) {
  const startedAt = Date.now();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: EXTRACT_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });
  const ms = Date.now() - startedAt;
  const payload = await response.json();
  if (!response.ok) {
    return { model, ms, error: `${response.status} ${JSON.stringify(payload).slice(0, 300)}` };
  }
  return {
    model,
    ms,
    content: payload.choices?.[0]?.message?.content ?? '',
    usage: payload.usage,
  };
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('DASHSCOPE_API_KEY 未配置');
    process.exit(1);
  }
  const images = process.argv.slice(2);
  const targets = images.length > 0 ? images : ['out/audit/sample-problem-1.png', 'out/audit/sample-problem-2.png'];

  for (const path of targets) {
    const dataUrl = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    console.log(`\n===== ${path} =====`);
    for (const model of MODELS) {
      const result = await runModel(model, dataUrl);
      console.log(`\n--- ${result.model} (${result.ms}ms) ---`);
      if ('error' in result && result.error) {
        console.log(`ERROR: ${result.error}`);
        continue;
      }
      console.log(`usage: ${JSON.stringify(result.usage)}`);
      console.log('content' in result ? result.content : '');
    }
  }
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
