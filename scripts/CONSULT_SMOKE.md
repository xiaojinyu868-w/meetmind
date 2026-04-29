# Consult 产品线回归冒烟

快速验证 MeetMind 学生端 AI 顾问 (`/consult/[orgSlug]`) 的核心行为还在。
**每次改完 `src/app/api/consult/**` 或 `src/lib/consult/**` 或 skill 文件，都应该跑一次。**

## 用法

```bash
# 前置：dev server 必须在跑（默认读 :3002）
npm run dev &
# 等几秒让它起来，然后：
npm run smoke:consult
```

默认打 `http://localhost:3002`；如果 dev server 在别的端口：

```bash
BASE_URL=http://localhost:3001 npm run smoke:consult
```

## 它会跑什么

| # | Case | 断言 |
|---|------|------|
| C01 | 写套磁 | agent 必须调 `useSkill({name:"cold-email-draft"})` |
| C01b | Percy 旗舰场景 | `useSkill(cold-email-draft)` 后必须 `readProfile` + `webSearch` + `showOutreachWorkspace`，query 含 Percy Liang / Stanford |
| C02 | 看 CV | agent 必须调 `useSkill({name:"cv-diagnose"})` |
| C03 | 歧义寒暄 | **不该**调任何 skill，用自然语言回复 |
| C04 | 第一轮 | **不该**emit `ctaWechat`（违反"前 3 轮禁用"纪律）|
| C05 | 3 个要点 | 返回的文本应有 markdown 结构 |
| C06 | 语音升级 | 已有 draft + 学生要求语音 → emit `startVoiceCall`，含 openingLine + focus |
| C07 | 孤儿 tool | 前端残留未完成的 tool-call → 后端应 heal，不 500 |
| C08 | 切换剧本 | 对话中途换主题 → agent 应再 `useSkill` |
| C09 | Lead API | `POST /api/consult/lead` 能创建线索 |
| C10 | Voice API | `POST /api/consult/voice/context` 能出 instructions |

### 输出

全绿：`exit 0`  
有红：`exit 1`，打印每个失败 case 的 reason + 工具调用摘要 + 前 200 字文本采样

### 重试策略

只对 HTTP 5xx / 网络错误重试 2 次（LLM 偶尔抖），内容断言失败一次定死。单 case 超时 90s。

## 加 case

编辑 `scripts/consult-smoke.ts` 的 `CASES` 数组。每条：

```ts
{
  id: 'Cxx_short_name',
  description: '一句话说它在验什么',
  messages: [user('学生输入'), ...],  // 可带历史 assistant 消息
  body: { hintedSkill: 'xxx' },        // 可选：模拟前端点建议卡的 softHint
  assert: (summary) => {
    if (!hasTool(summary, 'xxx')) return { ok: false, reason: '没调 xxx' };
    return { ok: true };
  },
},
```

`summary` 里有：`httpStatus / toolCalls[] / textSample / finishReason / errors[]`。

## 什么时候不跑

- 你只改了 console/machine 端的 UI（这脚本管不到那部分）
- DASHSCOPE_API_KEY 没配：所有 case 都会 500 失败，没意义

## 未来

- 增加 `/console/leads/[id]/icebreaker` 的冒烟（需要先创个 lead）
- 增加对话回放（`/api/console/leads/[id]` GET）冒烟
- 打上 perf 基线：每个 case 的 LLM 延时 → 给 HEAD 的性能回归做警戒线
