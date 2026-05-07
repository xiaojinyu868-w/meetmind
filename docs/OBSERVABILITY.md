# Observability Domain

> 产品的"看得见"底座。M1 交付。
> 原则：**没这一层，所有后续改动都是玄学**。

---

## 三件套

### 1. 结构化日志 (`src/lib/logger.ts`)

- **Backend**: pino（Node 事实标准，30k stars，比 console/winston 快 5x）
- **浏览器侧自动降级**：`require('pino')` 不可用时回退到 console + tag 前缀（保持旧 API 兼容）
- **字段**：`level / time (ISO) / service / tag / data / msg`
- **AsyncLocalStorage**：`withLogContext({requestId, userId}, () => ...)` 自动注入到所有嵌套 log
- **开发态**：pino-pretty 自动着色；`LOG_JSON=true` 强制 JSON

### 2. Sentry AI（自动 LLM trace）

- **`vercelAIIntegration()`**：AI SDK v6 的 `streamText/generateText` 每步自动产生 span
  - `Invoke Agent` span 包含 token usage / cost / prompt version
  - `Execute Tool` span 记录每个 tool call 的输入输出（默认不记录原始内容，`SENTRY_AI_RECORD_INPUTS=true` 可开启）
- **`pinoIntegration()`**：warn/error 级别的 pino log 自动映射为 Sentry breadcrumbs + logs

### 3. `track(event)` 四路径埋点

```ts
import { track } from '@/lib/logger';

track({ kind: 'asr.start',    mode: 'realtime', sessionId, language });
track({ kind: 'asr.success',  mode: 'fast',     sessionId, durationMs, segments, chars });
track({ kind: 'asr.fail',     mode: 'fast',     sessionId, durationMs, errorCode, errorMsg });

track({ kind: 'tutor.step',   sessionId, step: 0, stepType: 'tool-call', toolCalls, usage });
track({ kind: 'tutor.fail',   sessionId, errorCode });

track({ kind: 'echo.start',   sessionId, sourceType });
track({ kind: 'echo.success', sessionId, durationMs, bodyChars });
track({ kind: 'echo.fail',    sessionId, durationMs, errorCode });

track({ kind: 'sync.batch.start',   batchId, size });
track({ kind: 'sync.batch.success', batchId, size, durationMs });
track({ kind: 'sync.batch.fail',    batchId, size, durationMs, errorCode });
track({ kind: 'sync.conflict',      batchId, detail });
```

四类事件定义在 `TrackEvent` union type，编译期检查 schema。

---

## 配置（`.env.example`）

```bash
# Sentry（不设也能跑；pino 照常输出到 stdout）
SENTRY_DSN=
SENTRY_ENV=development
SENTRY_TRACES_SAMPLE_RATE=0.2        # prod 0.2 / dev 1.0
SENTRY_AI_RECORD_INPUTS=false        # 合规审计时打开
SENTRY_AI_RECORD_OUTPUTS=false

# 结构化日志
LOG_LEVEL=info        # debug / info / warn / error
LOG_JSON=true         # 强制 JSON（默认 dev 下 pretty）
```

---

## 为什么选这一套（业界对照）

| 维度 | 我们选 | 不选 | 理由 |
|---|---|---|---|
| 日志库 | pino | winston / bunyan | 30k stars，Node 事实标准 |
| 错误追踪 | Sentry AI | OTel GenAI raw | semconv 还在 dev 状态，Sentry 已经对齐 |
| LLM trace | `vercelAIIntegration` | LangSmith / Langfuse / Braintrust | 已装 ai@6，零额外后端 |
| 日志→错误桥 | `pinoIntegration` | `pino-sentry-transport` | 官方 integration，非 worker thread |

---

## 常用姿势

**Next.js API route 里**：
```ts
import { createLogger, track, withLogContext } from '@/lib/logger';
const log = createLogger('tutor');

export async function POST(req) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  return withLogContext({ requestId }, async () => {
    log.info('incoming request');
    track({ kind: 'tutor.step', sessionId, step: 0, stepType: 'start' });
    // ...
  });
}
```

**客户端组件里**：
```ts
import { createLogger } from '@/lib/logger';
const log = createLogger('recorder-ui');
log.info('mic permission granted');
// 浏览器下 pino 不会加载，降级到 console.log("[recorder-ui]", "mic permission granted")
```

---

## 下一步

- [ ] M4.5: 让 `track()` 除了发到 pino，也 async 写入 `AnalyticsEvent` 表（现有 `analytics-service.ts`）
- [ ] M5: 加 `/api/_health` endpoint 暴露 ASR / Tutor 最近 1min 成功率给 Prometheus
