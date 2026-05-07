# Eval Harness

> 产品打磨的评测闭环。没有这套 harness，后续所有 ASR / Agent 改动都是玄学。

## 哲学

抄自业界共识：
- **目录结构抄 SWE-Bench Verified**（datasets / graders / runner / fixtures 分离）
- **工具链抄 Claude Code**（最小工具集 + 显式 prompt 版本号 + 结构化 trace）
- **ASR 评测抄 Whisper community**（CER + LLM-as-Judge 双栈）
- **Agent 评测抄 Anthropic / Vercel AI SDK telemetry**（tool-selection 断言 + rubric）

## 目录

```
tests/eval/
├── asr/
│   ├── datasets/            # JSONL，每行 { id, audio_path, reference, tags }
│   ├── graders/
│   │   ├── cer.ts           # 基础 CER（按字切的 Levenshtein）
│   │   ├── wer.ts           # 英文或分词后 WER
│   │   └── llm-judge.ts     # Qwen3-Max 对"语义等价但字面不同"兜底打分
│   ├── fixtures/            # 冻结的音频测试样本（生成脚本 + 元数据）
│   ├── runs/                # 每次 run 的 JSONL 结果（.gitignore，只存摘要）
│   └── runner.ts            # 跑全量或单条，输出 results.jsonl
├── tutor/
│   ├── datasets/            # JSONL，{ id, question, expectedTool?, expectedWindow?, rubric? }
│   ├── graders/
│   │   ├── tool-selection.ts  # toolCalls[0].toolName === expected
│   │   ├── timestamp-citation.ts  # 正则 [t=MM:SS] + 时间窗校验
│   │   └── learning-rubric.ts  # LLM rubric（回答抓没抓住概念）
│   ├── fixtures/
│   │   └── transcripts/     # 冻结的课堂转写片段 .json
│   ├── runs/
│   └── runner.ts
└── promptfooconfig.yaml     # CI 入口；上面的 graders 都通过 javascript: 断言接入
```

## 使用

### 跑全量
```bash
npm run eval:asr        # 跑 ASR 全量
npm run eval:tutor      # 跑 Tutor 全量
npm run eval            # 两个都跑
```

### 单条调试
```bash
npx tsx tests/eval/asr/runner.ts --id synth-classroom-001
npx tsx tests/eval/tutor/runner.ts --id tool-flashcards-01
```

### 产出
每次 run 都会写 `tests/eval/{asr,tutor}/runs/<timestamp>-<commit>.jsonl`（gitignore），
并在 stdout 打一份 summary，便于 CI grep：

```
[asr-eval] 23/30 passed  avg_cer=4.2%  95p_cer=8.1%  regressions=0
```

## 冻结 fixture

- **ASR fixture**：音频文件太大不入 git；提供生成脚本 `fixtures/generate.ts`（CosyVoice 合成 + MUSAN 混噪）+ 元数据 JSON
- **Tutor fixture**：课堂转写 JSON 直接入 git；作为"唯一事实"锚定 Tutor 引用的时间戳

## 添加新 case 的流程

1. 在 `datasets/` 追加一行 JSONL
2. 如果是新类型的断言，在 `graders/` 加一个 TS 文件
3. 跑 `npm run eval:<domain>` 本地验证
4. 提 PR —— CI 会重新跑全量，**回归红灯卡合并**

## 为什么不用 Ragas / DeepEval

它们是 Python 生态，跨语言跑 CI 成本高于收益。TS grader + Promptfoo 够用。

## 为什么不用 OpenAI Evals / Braintrust

- OpenAI Evals 锁死 OpenAI prompt 格式
- Braintrust 要付费账户 + 改造为其 SDK，早期不值得

以上任何一个在团队 > 5 人或数据集 > 1000 条时可以重新评估。
