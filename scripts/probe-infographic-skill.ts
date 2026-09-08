/**
 * 一次性端到端探针(不进仓库长期维护,验证完可删):
 * 走线上真实服务 infographic-skill-service → llm chat → infographic-image-provider,
 * 用 lab 的示例课转录验证「单次 LLM + 预设 skill 风格 + 横版出图」全链路。
 * 用法: PATH=/usr/local/bin:$PATH npx tsx scripts/probe-infographic-skill.ts
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  INFOGRAPHIC_PRESET,
  assembleInfographicImagePrompt,
  buildInfographicSkillSystemPrompt,
  buildInfographicSkillUserPrompt,
} from '@/lib/services/infographic-skill-service';
import { chat } from '@/lib/services/llm-service';
import { generateInfographicImage } from '@/lib/services/infographic-image-provider';
import { parseJsonResponse } from '@/lib/utils/json-utils';

const transcript = readFileSync(
  'out/tutor-engine-spike/lab/fixtures/lesson.json',
  'utf8'
);
const transcriptText = JSON.parse(transcript).transcript as string;

async function main() {
  const t0 = Date.now();
  const system = buildInfographicSkillSystemPrompt();
  const user = buildInfographicSkillUserPrompt({
    goalIntent: '生成一张图带走这节课',
    transcriptContext: transcriptText,
  });
  console.log(`[prompt] system=${system.length} chars, user=${user.length} chars`);

  const response = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    undefined, // 缺省走默认模型    { temperature: 0.25, maxTokens: 6000, responseFormat: 'json_object' }
  );
  const llmMs = Date.now() - t0;
  type InfographicOutput = {
    title?: string;
    infographic?: {
      title?: string;
      subtitle?: string;
      keyPoints?: string[];
      contentOutline?: string;
      textLabels?: string[];
    };
  };
  const output = parseJsonResponse<InfographicOutput>(response.content);
  const info = output?.infographic;
  const imagePrompt = info
    ? assembleInfographicImagePrompt({
        title: info.title?.trim() || output?.title?.trim() || '课堂信息图',
        subtitle: info.subtitle?.trim() || '',
        keyPoints: Array.isArray(info.keyPoints) ? info.keyPoints : [],
        contentOutline: info.contentOutline?.trim() || (info.keyPoints || []).join('\n'),
        textLabels: Array.isArray(info.textLabels) ? info.textLabels : [],
      })
    : '';
  console.log(`[llm] ${llmMs}ms title=${info?.title || '(none)'} keyPoints=${info?.keyPoints?.length ?? 0} imagePrompt=${imagePrompt.length} chars`);
  if (!imagePrompt || imagePrompt.includes('{{')) {
    console.log('[llm] raw:', (response.content || '').slice(0, 400));
    process.exit(1);
  }
  writeFileSync('/tmp/skill-image-prompt.md', imagePrompt);

  const imgStart = Date.now();
  const img = await generateInfographicImage({
    prompt: imagePrompt,
    stylePreset: INFOGRAPHIC_PRESET.stylePresetLabel,
    orientation: INFOGRAPHIC_PRESET.orientation,
    detailLevel: 'standard',
    scenePreset: 'class-take-away',
  });
  const imgMs = Date.now() - imgStart;
  writeFileSync('/tmp/skill-infographic.png', Buffer.from(img.base64, 'base64'));
  console.log(`[image] ${imgMs}ms model=${img.model} saved=/tmp/skill-infographic.png`);
  console.log(`[total] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error('[failed]', error instanceof Error ? error.message : error);
  process.exit(1);
});
