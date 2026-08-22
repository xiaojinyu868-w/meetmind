#!/usr/bin/env npx tsx
/**
 * try-explainer-joint-design.ts —— v20 嘴手一体 prompt 的真实生成验证
 *
 * 用一小段合成课堂转录跑一遍板书精讲生成（explainer prompt），
 * 把产出脚本的"联合设计"质量打印出来人工审：
 * - 每个 write 的 cue 锚点上下文（锚点前后各 12 字）vs 它写的内容——
 *   嘴上讲的和手上写的是不是同一个东西；
 * - 长 narration 无动作的段（纯讲不动笔）与动作密集段的分布；
 * - 每个 segment 的两条轨一览（语言轨 + 板面状态轨）。
 *
 * 用法：npx tsx scripts/try-explainer-joint-design.ts [modelId]
 */
import 'dotenv/config';
import { chat } from '@/lib/services/llm-service';
import { buildExplainerSystemPrompt, buildExplainerUserPrompt } from '@/lib/ai-native/plugins/explainer-prompts';
import { sanitizeBoardScript } from '@/lib/ai-native/plugins/board-script';
import { parseJsonResponse } from '@/lib/utils/json-utils';

const MODEL = process.argv[2] || 'qwen3.7-plus';

const TRANSCRIPT = `[1] [0:00-0:18] 好，同学们，今天我们讲 relocate 这个词。它的意思是搬迁、迁移，re 表示再次，locate 是定位，合起来就是换地方。
[2] [0:18-0:40] 注意它和 move 的区别：move 是泛指移动，relocate 通常指因为工作或生活原因的长距离搬迁，比较正式。比如 The company relocated to Shanghai，公司迁到了上海。
[3] [0:40-1:05] 考试里常考它的名词形式 relocation，以及搭配 relocate to someplace。记住，介词用 to，不要用 into。这是易错点。
[4] [1:05-1:20] 好，那我们再写一个例句：She relocated to Beijing for her new job. 注意时态，一般过去时。`;

async function main() {
  console.log(`model=${MODEL}，生成中…`);
  const started = Date.now();
  const response = await chat(
    [
      { role: 'system', content: buildExplainerSystemPrompt() },
      {
        role: 'user',
        content: buildExplainerUserPrompt({
          goalIntent: '搞懂 relocate 的用法和易错点',
          transcriptContext: TRANSCRIPT,
        }),
      },
    ],
    MODEL,
    { temperature: 0.5, maxTokens: 32000, responseFormat: 'json_object', thinking: false },
  );
  console.log(`生成耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const raw = parseJsonResponse<unknown>(response.content);
  if (!raw) {
    console.error('JSON 解析失败');
    process.exit(1);
  }
  const { script, dropped } = sanitizeBoardScript(raw);
  if (dropped > 0) console.log(`（sanitize 丢弃了 ${dropped} 个非法 cue）`);

  // ── 联合设计审查 ──
  script.pages.forEach((page, pageIndex) => {
    console.log(`\n════ 第 ${pageIndex + 1} 页 ════`);
    page.segments.forEach((segment, segIndex) => {
      const display = 'narrationDisplay' in segment && segment.narrationDisplay
        ? segment.narrationDisplay
        : segment.narration;
      const cues = 'cues' in segment ? (segment.cues ?? []) : [];
      const actions = 'actions' in segment ? segment.actions : [];
      console.log(`\n─ 段 ${segIndex}（${segment.type === 'checkpoint' ? 'checkpoint' : 'narration'}，${display.replace(/\s+/g, '').length} 字，${actions.length} 动作）─`);
      console.log(`讲: ${display}`);
      actions.forEach((action, actionIndex) => {
        const cue = cues.find((c) => c.actionIndex === actionIndex);
        let line = `  [a${actionIndex}] ${action.type}`;
        if (action.type === 'write') line += ` "${action.text}" (${action.role})`;
        if ('target' in action && action.target) line += ` → ${JSON.stringify(action.target)}`;
        if (cue) {
          const at = cue.charIndex;
          const before = display.slice(Math.max(0, at - 12), at);
          const after = display.slice(at, at + 12);
          line += `\n        cue@${at}: …${before}【锚】${after}…`;
        } else {
          line += '\n        （无 cue，播放器兜底）';
        }
        console.log(line);
      });
      if (actions.length === 0 && display.replace(/\s+/g, '').length > 40) {
        console.log('  （纯讲段：手应停着）');
      }
    });
  });
}

main().catch((error) => {
  console.error('failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
