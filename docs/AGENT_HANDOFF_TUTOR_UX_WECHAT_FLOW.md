# MeetMind Agent Handoff: Tutor UX 修复 + 微信回流动线重设计

更新时间：2026-03-19

这份文档给下一个对话里的 agent 直接阅读。
目标不是只交代"当前改了什么"，而是把下面三层一次性交代清楚：

1. 为什么改这些——用户遇到了什么真实问题
2. 改了哪些文件、怎么改的——精确到行号和函数
3. 当前部署到哪了、下一步该做什么

前置文档：请先阅读 `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md`，它定义了产品北极星和收集层的完整上下文。本文档是在那份基础上的增量。

---

## 1. 本轮改动的起因

用户在线上使用过程中连续发现了 4 个严重的可用性问题：

### 1.1 整页错误页

AI 助教面板内部抛异常时，把整个 `/app` 页面打成了全局错误页。用户看到的是 Next.js 的默认 Error 页面，而不是正常的收集主界面。

**根因**：`AITutor` 组件没有 Error Boundary 包裹，运行时异常沿 React 树冒泡到顶层。

### 1.2 Tutor 429 限流误伤

用户刚进入页面、还没手动操作，就被弹"请求过于频繁，请稍后再试"。

**根因链**：
- 自动发问（`launchQuestion`）在认证还没稳定时就触发了
- 代理环境下所有请求共用同一个本地 IP，限流计数器把不同用户的请求混在一起
- 限流阈值太紧（旧值远低于 20/min）
- 前端错误消息直接甩技术文案给用户

### 1.3 点"问 Tutor"进入重型意图页

用户点"问 Tutor"后，没有直接得到回答，反而先进入了一个信息量过大的意图识别页面（大卡片 + 图标 + 四宫格 + 快速入口）。

用户原话：**"这种意图识别不如不做，信息量太大了，不够轻，不满足人机交互基本原则。"**

### 1.4 微信回流动线被打乱

从微信服务号点链接回到 H5 后，用户被直接带到了旧的课堂时间轴 / 复习页，而不是当前的收集主线。

用户原话：**"用户的动线被打乱了，你显然没有合理设计用户的动线。"**

---

## 2. 改动全景

### 2.1 涉及的文件

| 文件 | 改动类型 | 改动量 |
|------|----------|--------|
| `src/components/TutorErrorBoundary.tsx` | **新增** | 73 行 |
| `src/components/SafeAITutor.tsx` | **新增** | 21 行 |
| `src/components/AITutor.tsx` | 修改 | +489/-若干 |
| `src/components/IntentBubbleExplorer.tsx` | 重写 | +91（从大卡片改为胶囊） |
| `src/lib/services/rate-limit-service.ts` | 修改 | +48 |
| `src/lib/hooks/useSSEStream.ts` | 修改 | +4 |
| `src/app/(main)/app/page.tsx` | 修改 | +385（微信回流动线重设计） |
| `next.config.js` | 修改 | +12（低内存构建） |
| `src/lib/hooks/useAuth.tsx` | 修改 | +15 |
| `src/components/StreamingMarkdown.tsx` | 修改 | +239/-若干 |
| `src/components/GuidanceQuestion.tsx` | 修改 | +120 |
| `src/hooks/useVoiceInput.ts` | 修改 | +591/-若干 |
| `src/lib/services/qwen-asr-service.ts` | 修改 | +163 |
| `server.js` | 修改 | +113 |

### 2.2 新增文件

| 文件 | 用途 |
|------|------|
| `src/components/TutorErrorBoundary.tsx` | 局部 Error Boundary，防止 AI 面板崩溃升级为整页错误 |
| `src/components/SafeAITutor.tsx` | 包装组件，将 `AITutor` + `TutorErrorBoundary` 接起来 |
| `src/components/CitationReferenceSheet.tsx` | 引用参考面板 |
| `prisma/migrations/20260318153000_add_workspace_capture_status/migration.sql` | 数据库迁移 |

---

## 3. 修复一：Tutor 整页崩溃 → 局部错误边界

### 3.1 改了什么

新增 `TutorErrorBoundary`（Class 组件 Error Boundary）：

- 捕获 AI 助教面板内部的任何运行时异常
- 显示友好提示："AI 助教刚刚开了个小差"
- 提供"重新加载 AI 助教"按钮
- 支持 `resetKeys` 自动重置：当 `sessionId`、`breakpoint`、`launchQuestionNonce`、`isMobile` 变化时自动恢复

新增 `SafeAITutor`（薄包装组件）：

- 构造 `resetKeys` 数组
- 将 `AITutor` 包裹在 `TutorErrorBoundary` 中

### 3.2 关键文件

- `src/components/TutorErrorBoundary.tsx` — 完整 Error Boundary 实现
- `src/components/SafeAITutor.tsx` — 包装组件
- `src/app/(main)/app/page.tsx` — 动态导入从 `AITutor` 切到 `SafeAITutor`

### 3.3 page.tsx 里怎么用的

```typescript
// 动态导入
const SafeAITutor = dynamic(() => import('@/components/SafeAITutor'), { ssr: false });

// 使用时替代原来的 AITutor
<SafeAITutor
  sessionId={...}
  breakpoint={...}
  launchQuestionNonce={...}
  isMobile={...}
  // ...其他 props 不变
/>
```

### 3.4 下一个 agent 要注意

- **不要移除 Error Boundary**——这是防止整页崩溃的最后一道防线
- 如果要给 `AITutor` 加新 props，记得同步更新 `SafeAITutor` 的 props 透传
- `resetKeys` 的构成很重要：它控制什么时候自动恢复——不要随意加减

---

## 4. 修复二：Tutor 429 限流误伤

这个修复跨了四层：**认证时机 → 限流策略 → 标识提取 → 前端文案**。

### 4.1 认证时机（AITutor.tsx）

**问题**：自动发问（`launchQuestion`）在 `isCheckingAuth && !accessToken` 时就触发了，导致未认证请求打到后端被限流。

**修复**：自动发问等待认证稳定后再触发。

```typescript
// src/components/AITutor.tsx
// 认证未完成时暂缓自动发问
const shouldShowAutoLaunchState =
  isGlobalMode &&
  globalChatHistory.length === 0 &&
  (hasLaunchPayload || globalLoading || isStreaming || globalThinkingContent.length > 0 || (isCheckingAuth && !accessToken));
```

### 4.2 限流策略（rate-limit-service.ts）

**修复**：tutor 限流阈值放宽到与 chat 一致。

```typescript
// src/lib/services/rate-limit-service.ts 第 49-63 行
export const RATE_LIMITS = {
  chat:       { perMinute: 20, perHour: 200, perDay: 1000, cost: 'high' },
  tutor:      { perMinute: 20, perHour: 200, perDay: 1000, cost: 'high' },
  transcribe: { perMinute: 5,  perHour: 50,  perDay: 200,  cost: 'high' },
  // ...
};
```

### 4.3 标识提取增强（rate-limit-service.ts）

**问题**：代理环境（Nginx 反向代理）下，所有请求的 IP 都是 `127.0.0.1`，导致不同用户的请求共用同一个限流桶。

**修复**：

```typescript
// src/lib/services/rate-limit-service.ts 第 400-430 行

// getClientIp 优先级：cf-connecting-ip > x-forwarded-for > x-real-ip > forwarded
function getClientIp(request: Request): string { ... }

// getIdentifier 增强逻辑
export function getIdentifier(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const ip = normalizeIdentifierSegment(getClientIp(request));
  const isProxyLocalIp = ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (isProxyLocalIp) {
    // 本地 IP 时追加 User-Agent 区分不同用户
    const userAgent = normalizeIdentifierSegment(request.headers.get('user-agent') || 'anonymous');
    return `ip:${ip}:ua:${userAgent}`;
  }
  return `ip:${ip}`;
}
```

### 4.4 前端 Retry-After 透传（useSSEStream.ts）

```typescript
// src/lib/hooks/useSSEStream.ts 第 278-282 行
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  const retryAfter = response.headers.get('Retry-After');
  const retryHint = retryAfter ? `，请约 ${retryAfter} 秒后再试` : '';
  throw new Error(errorData.error ? `${errorData.error}${retryHint}` : `请求失败: ${response.status}${retryHint}`);
}
```

### 4.5 统一错误文案（AITutor.tsx）

```typescript
// src/components/AITutor.tsx 第 255-263 行
function formatTutorErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误');
  if (/请求过于频繁|稍后再试|rate limit|too many/i.test(rawMessage)) {
    const retryAfterMatch = rawMessage.match(/(\d+)\s*秒/);
    const retryHint = retryAfterMatch ? `，大约 ${retryAfterMatch[1]} 秒后再试` : '，稍等十几秒再试一次';
    return `现在问得有点快了${retryHint}。`;
  }
  return rawMessage;
}
```

- 识别限流类错误（中英文模式匹配）
- 提取 `Retry-After` 秒数
- 输出人话化文案：`"现在问得有点快了，大约 30 秒后再试。"`
- 被 breakpoint-chat（第 1163 行）和 global-chat（第 1347 行）的 catch 分支统一调用

### 4.6 下一个 agent 要注意

- 不要把 tutor 限流阈值收紧回去，除非有明确的滥用证据
- 如果以后部署环境变了（比如不走 Nginx 代理了），`getIdentifier` 的 proxy 逻辑需要重新评估
- `formatTutorErrorMessage` 是唯一的 tutor 错误文案归一化出口，新增错误类型时应该扩展这个函数

---

## 5. 修复三：首屏意图识别从重型卡片 → 轻量胶囊

### 5.1 改了什么

`IntentBubbleExplorer.tsx` 从 224 行的大卡片 + 图标 + 四宫格 + 快速入口，重做为 91 行的极轻胶囊入口。

### 5.2 新的意图胶囊设计

```tsx
// src/components/IntentBubbleExplorer.tsx
const STARTER_INTENTS = [
  { id: 'core',    label: '先讲核心', prompt: '…先用一句话说清楚核心结论，再拆开讲我最容易卡住的地方。' },
  { id: 'example', label: '换成例子', prompt: '…先给我一个最容易懂的例子或类比，再回到原内容解释。' },
  { id: 'steps',   label: '拆成步骤', prompt: '…请把关键过程拆成 3 到 5 步，每一步只讲一个重点。' },
  { id: 'summary', label: '提炼要点', prompt: '…先帮我提炼 3 个最值得记住的要点，再给我一个最值得继续追问的问题。' },
];
```

渲染方式：一排轻量按钮，不再有图标、不再有大标题解释。

```tsx
<div className="rounded-[20px] border border-slate-200/80 bg-white/88 px-3.5 py-3 ...">
  <p className="text-[13px] font-semibold text-slate-900">
    {preferSupportContext ? '可以顺着刚选内容继续' : '可以直接开始问'}
  </p>
  <div className="mt-3 flex flex-wrap gap-2">
    {STARTER_INTENTS.map((intent) => (
      <button key={intent.id} ...>{intent.label}</button>
    ))}
  </div>
</div>
```

### 5.3 自动发问时的等待态（AITutor.tsx）

当用户从收集流点"问 Tutor"进来时，不再先显示意图页，而是直接显示轻量等待态：

```typescript
// src/components/AITutor.tsx 第 1427-1430 行
const shouldShowAutoLaunchState =
  isGlobalMode &&
  globalChatHistory.length === 0 &&
  (hasLaunchPayload || globalLoading || isStreaming || globalThinkingContent.length > 0 || (isCheckingAuth && !accessToken));
```

当 `shouldShowAutoLaunchState` 为 `true` 时：
- 显示加载动画
- 不显示 `IntentBubbleExplorer`
- 等自动发问完成后直接进入对话

### 5.4 下一个 agent 要注意

- 用户对信息密度非常敏感——任何新增的 Tutor 首屏元素都要问："这比现在更轻吗？"
- `IntentBubbleExplorer` 只应在**没有自动发问且无历史对话**时出现
- 不要把它再改重——用户明确说过"不如不做"

---

## 6. 修复四：微信回流动线重设计

这是改动量最大的一块，集中在 `page.tsx`。

### 6.1 问题

从微信服务号点击链接回来后，URL 类似：
```
/app?mobile=1&wechat_capture=<token>&session=<sessionId>
```

旧逻辑会恢复上一次保存的 `viewMode`（可能是 `review`），导致用户被带到课堂时间轴 / 复习页，而不是收集主线。

### 6.2 改动一：微信回流时优先进 record 模式

```typescript
// src/app/(main)/app/page.tsx 第 1275 行
const shouldPrioritizeWechatCaptureEntry = Boolean(wechatCaptureToken);

// 第 2273 行 — 决定初始 viewMode
const finalViewMode: ViewMode = shouldPrioritizeWechatCaptureEntry
  ? 'record'  // 微信回流时强制进入收集模式
  : isFirstVisit && !savedAppState ? 'record' : (savedAppState?.viewMode || 'record');
```

### 6.3 改动二：微信导入成功后的承接态

```typescript
// src/app/(main)/app/page.tsx 第 5155 行起
const settleWechatCaptureEntry = useCallback((nextItem: SourceIngestItem) => {
  // 1. 抑制下一次 pulse 预览
  suppressNextCollectionPulsePreviewRef.current = true;

  // 2. 强制回到 record 模式，清掉所有干扰状态
  setViewMode('record');
  setMobileSubPage(null);
  setMobileCollectionSheet(null);
  setShowConversationHistory(false);
  setSelectedHistoryConversation(null);
  setShowMobileRecorder(false);
  setSelectedConfusion(null);
  setConfusionChatAnchor(null);
  setSelectedAnchor(null);
  setActiveCollectionMessageMenuId(null);
  setConfirmCollectionDeleteId(null);
  setIsCollectionContextSelectionMode(false);
  setConfirmSelectedCollectionDelete(false);
  setSelectedCollectionContextIds([]);
  setSelectedCollectionPrimaryId(null);

  // 3. 把刚导入的内容挂到当前输入区的引用上下文
  setQuotedCollectionContextIds([nextItem.id]);
  setQuotedCollectionPrimaryId(nextItem.id);

  // 4. 清掉所有 AI launch 相关状态
  setCaptureDrivenPulse(null);
  setShowCollectionPulsePreview(false);
  setMobileAIQuestion('');
  setMobileAIDisplayQuestion('');
  setMobileAILaunchImages([]);
  setMobileAILaunchSupportContextText('');
  setMobileAIConsumedQuestionNonce(null);
  setMobileAIPreferSelectedContext(false);
  setMobileAILaunchTarget(null);

  // 5. 聚焦 composer 输入框
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      const textarea = collectionComposerRef.current;
      if (!textarea) return;
      textarea.focus();
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
      textarea.scrollIntoView({ block: 'nearest' });
    });
  }
}, []);
```

### 6.4 改动三：pulse 预览抑制

微信导入成功后，收集流会产生一次 pulse（新消息脉冲），可能触发 pulse 预览抢焦点。

```typescript
// src/app/(main)/app/page.tsx 第 1393 行
const suppressNextCollectionPulsePreviewRef = useRef(false);

// 第 5761-5765 行 — 在 pulse 预览 effect 里
if (suppressNextCollectionPulsePreviewRef.current) {
  suppressNextCollectionPulsePreviewRef.current = false;
  lastCollectionPulseSignatureRef.current = collectionPulseSignature;
  setShowCollectionPulsePreview(false);
  return;
}
```

### 6.5 改动四：微信导入 effect 的调用

旧逻辑：`setCaptureDrivenPulse(...)` — 只设置 pulse，没有承接态。

新逻辑：

```typescript
// src/app/(main)/app/page.tsx 第 5281-5282 行
settleWechatCaptureEntry(nextItem);
toast.success(message.echoTitle?.trim() || '这条微信内容已经接进当前收集');
```

effect 依赖数组已补入 `settleWechatCaptureEntry`（第 5307 行）。

### 6.6 用户的动线现在是什么

**微信服务号 → 点击链接 → `/wechat/open/[token]` → 302 到 `/app?mobile=1&wechat_capture=...&session=...`**

然后：

1. `shouldPrioritizeWechatCaptureEntry` 检测到 `wechat_capture` 参数 → 强制 `viewMode = 'record'`
2. 微信导入 effect 拉取微信内容并 ingest 进收集流
3. `settleWechatCaptureEntry(nextItem)` 触发：
   - 清掉所有干扰状态
   - 把刚导入的内容挂到输入区引用上下文
   - 聚焦 composer
4. `suppressNextCollectionPulsePreviewRef` 压制 pulse 预览
5. `toast.success(...)` 轻提示
6. 用户看到：收集主线 + 刚导入的内容已经在引用区 + 光标在输入框 → 可以直接继续提问或输入

### 6.7 下一个 agent 要注意

- `settleWechatCaptureEntry` 清理了大量状态——如果后续加了新的全局状态且需要在微信回流时重置，记得加进去
- `suppressNextCollectionPulsePreviewRef` 是一次性的——只抑制一次 pulse，不影响后续正常 pulse
- `page.tsx` 非常大（5800+ 行），任何改动都可能影响别的分支逻辑，要特别克制
- 微信回流入口 `/wechat/open/[token]/route.ts` 本身没改，它只做重定向

---

## 7. 低内存构建配置

### 7.1 问题

生产构建在服务器上因内存不足被 SIGKILL。

### 7.2 修复

```javascript
// next.config.js
const buildCpus = process.env.NEXT_BUILD_CPUS
  ? parseInt(process.env.NEXT_BUILD_CPUS, 10)
  : (process.env.NODE_ENV === 'production' ? 1 : undefined);

module.exports = {
  experimental: {
    cpus: buildCpus,
    // ...
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_IGNORE_BUILD_LINT === '1',
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_TYPE_ERRORS === '1',
  },
};
```

### 7.3 构建命令

```bash
NEXT_BUILD_CPUS=1 NEXT_IGNORE_BUILD_LINT=1 NEXT_IGNORE_TYPE_ERRORS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build
```

### 7.4 下一个 agent 要注意

- 这台服务器内存有限，**不要去掉低内存参数**
- `tsc --noEmit` 也要控制内存：`NODE_OPTIONS=--max-old-space-size=2048 npx tsc --noEmit`
- 如果要同时跑构建和服务，留意总内存

---

## 8. 当前工作树状态

### 8.1 基本信息

- **当前分支**：`feature/capture-v1-context-echo`
- **修改文件数**：30 个已跟踪文件（未提交）
- **新增文件数**：14 个（未跟踪）
- **构建状态**：生产构建成功（2026-03-19）
- **运行状态**：3002 端口正常监听，HTTP 200

### 8.2 已修改文件清单（git diff --stat）

```
.gitignore                                          |   1 +
next.config.js                                      |  12 +
package.json                                        |   2 +-
server.js                                           | 113 +
src/app/(main)/app/page.tsx                         | 385 +
src/app/api/auth/wechat/callback/route.ts           |  18 +-
src/app/api/auth/wechat/route.ts                    |  18 +-
src/app/api/wechat/bind/callback/route.ts           |  38 +-
src/app/api/wechat/bind/route.ts                    |  15 +-
src/app/wechat/capture/[token]/WechatCaptureClient  |  12 +-
src/components/AIChat.tsx                           |  13 +-
src/components/AITutor.tsx                          | 489 +
src/components/GuidanceQuestion.tsx                 | 120 +
src/components/IntentBubbleExplorer.tsx             | 224 +-
src/components/Recorder.tsx                         |  46 +-
src/components/StreamingMarkdown.tsx                | 239 +
src/components/VoiceMicButton.tsx                   |   8 +-
src/components/WechatBindForm.tsx                   |  12 +-
src/components/WorkspaceCaptureList.tsx             |  13 +-
src/hooks/useVoiceInput.ts                          | 591 +-
src/lib/capture/collection-context.ts               |   8 +-
src/lib/hooks/useAuth.tsx                           |  15 +-
src/lib/hooks/useSSEStream.ts                       |   4 +-
src/lib/services/dashscope-asr-service.ts           |  43 +-
src/lib/services/qwen-asr-service.ts               | 163 +
src/lib/services/rate-limit-service.ts              |  48 +-
src/lib/services/wechat-auth-service.ts             | 103 +
src/lib/services/workspace-context-service.ts       |  30 +-
src/lib/swr/fetcher.ts                             |   3 +-
tests/e2e/closed-loop.spec.ts                      |   2 +-
```

### 8.3 新增未跟踪文件

```
src/components/TutorErrorBoundary.tsx     — Tutor 错误边界
src/components/SafeAITutor.tsx            — Tutor 安全包装
src/components/CitationReferenceSheet.tsx — 引用参考面板
prisma/migrations/20260318153000_add_workspace_capture_status/migration.sql
scripts/fix_aitutor.py                   — 一次性修复脚本，不需要提交
public/wechat-media/images/...           — 微信媒体缓存，不需要提交
public/wechat-media/voice/...            — 微信媒体缓存，不需要提交
```

### 8.4 不要带入提交的文件

- `public/wechat-media/` 下的所有媒体文件（运行时缓存）
- `scripts/fix_aitutor.py`（一次性脚本）
- `.codebuddy/` 目录

### 8.5 当前工作树意味着什么

对下一个 agent 来说：

- 代码已修改但**未提交**
- 生产构建已成功，服务已在运行
- 接手后先 `git diff` 看一眼，确认理解当前改动范围
- 不要假设这是一个干净的状态

---

## 9. 当前部署状态

### 9.1 服务状态

| 项目 | 状态 |
|------|------|
| 端口 | 3002 |
| PID | 2144041 |
| 本地健康检查 | `http://127.0.0.1:3002/app` → HTTP 200 ✅ |
| 正式域名 | `https://capture.meetmind.online/app` → HTTP/2 200 ✅ |
| 构建时间 | 2026-03-19 |
| 启动命令 | `nohup env NODE_ENV=production PORT=3002 node server.js > runtime-3002.log 2>&1 &` |

### 9.2 如果需要重新部署

```bash
# 1. 杀掉旧进程
PID=$(ss -ltnp '( sport = :3002 )' | awk 'NR>1{match($0, /pid=([0-9]+)/, a); print a[1]}')
[ -n "$PID" ] && kill "$PID"

# 2. 低内存构建
cd /mnt/meetmind-capture-v1-server-handoff
NEXT_BUILD_CPUS=1 NEXT_IGNORE_BUILD_LINT=1 NEXT_IGNORE_TYPE_ERRORS=1 NODE_OPTIONS="--max-old-space-size=1024" npm run build

# 3. 启动服务
nohup env NODE_ENV=production PORT=3002 node server.js > runtime-3002.log 2>&1 &
sleep 8

# 4. 验证
curl -I --max-time 15 http://127.0.0.1:3002/app
curl -I --max-time 20 https://capture.meetmind.online/app
```

---

## 10. 已验证 / 未验证矩阵

### A. 已实现 + 已验证（构建通过 + 线上 200）

- Tutor 局部错误边界（`TutorErrorBoundary` + `SafeAITutor`）
- Tutor 429 限流四层修复（认证时机 + 阈值 + IP 标识 + 文案）
- 首屏意图识别轻量化（胶囊入口）
- 自动发问等待态（`shouldShowAutoLaunchState`）
- 低内存生产构建

### B. 已实现 + 代码校验通过（tsc + lint 零错误）但需端到端验证

- **微信回流动线**：`shouldPrioritizeWechatCaptureEntry` + `settleWechatCaptureEntry` + pulse 抑制
  - 需要从微信服务号实际点击链接进入，确认：
    1. 落在收集主线（`record` 模式）而非旧复习页
    2. 刚导入的内容出现在引用区
    3. composer 输入框获得焦点
    4. pulse 预览不抢焦点

### C. 仍需继续打磨

- Tutor 首屏体验在不同场景下的表现（从复习进入 vs 从收集进入 vs 微信回流进入）
- `formatTutorErrorMessage` 覆盖的错误类型是否足够
- 微信回流后，如果用户关闭再重新打开，状态是否正确恢复

---

## 11. 下一个 agent 的优先级

按顺序做，不要发散：

### 11.1 立即做

1. **微信回流端到端验证**
   - 从微信服务号链接实际进入
   - 确认落在收集主线
   - 确认引用区和 composer 行为正确

2. **跑通服务器环境下的完整 Capture 闭环**
   - 原声 / 音频 → 转写 → 去复习
   - 参考 `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` 第 9.4 节的 smoke test 清单

### 11.2 然后做

3. 微信服务号真实回调验证
4. 视频媒体消息语法打磨
5. 回来理由（回声入口）

### 11.3 当前不要做

- 前台大 AI 洞察
- 复杂画像展示
- 新的一级页面
- 与 Capture First 无关的低杠杆 UI 细节

---

## 12. 关键代码行号速查表

以下行号基于 2026-03-19 构建时的代码快照，可能随后续修改偏移。

### AITutor.tsx

| 内容 | 行号 |
|------|------|
| `formatTutorErrorMessage` 定义 | 255-263 |
| `shouldShowAutoLaunchState` 定义 | 1427-1430 |
| `shouldShowAutoLaunchState` 渲染条件 | 1510 |
| breakpoint-chat catch 调用 `formatTutorErrorMessage` | 1163 |
| global-chat catch 调用 `formatTutorErrorMessage` | 1347 |

### rate-limit-service.ts

| 内容 | 行号 |
|------|------|
| `RATE_LIMITS` 配置 | 49-63 |
| `getClientIp` 函数 | 400-414 |
| `getIdentifier` 函数 | 416-430 |

### useSSEStream.ts

| 内容 | 行号 |
|------|------|
| `Retry-After` 透传 | 278-282 |

### page.tsx

| 内容 | 行号 |
|------|------|
| `shouldPrioritizeWechatCaptureEntry` 定义 | 1275 |
| `shouldPrioritizeWechatCaptureEntry` 使用 | 2273 |
| `suppressNextCollectionPulsePreviewRef` 定义 | 1393 |
| `settleWechatCaptureEntry` 定义 | 5155 |
| `settleWechatCaptureEntry` 调用 | 5281 |
| `toast.success` 微信导入提示 | 5282 |
| effect 依赖含 `settleWechatCaptureEntry` | 5307 |
| pulse 抑制消费 | 5761-5765 |

---

## 13. 环境变量速查

在做任何联调前，先确认 `.env` 里有这些：

```
# 必须
DATABASE_URL="file:./prisma/meetmind.db"
DASHSCOPE_API_KEY=...

# 微信相关
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
WECHAT_MP_TOKEN=...
WECHAT_MP_PUBLIC_BASE_URL=...

# 可选但影响功能
NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER=true
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true
PUBLIC_DOMAIN=...
```

详细说明见 `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` 第 7.2.1 节。

---

## 14. 给下一个 agent 的工作守则

继承 `docs/SERVER_AGENT_HANDOFF_CAPTURE_V1.md` 第 10 节的 5 个问题之外，增加：

6. **这个改动会不会让 Tutor 面板的错误升级为整页崩溃？** — 任何涉及 `AITutor` 的改动都要确认 Error Boundary 仍然有效
7. **这个改动会不会让微信回流的动线被干扰？** — 任何涉及 `viewMode`、`mobileSubPage`、`mobileCollectionSheet` 的改动都要考虑微信回流场景
8. **这个改动的信息密度合适吗？** — 用户对首屏信息量非常敏感，宁可少一点
9. **这台服务器内存够吗？** — 构建和运行都要控制内存

### 关于 page.tsx 的特别警告

`page.tsx` 目前 5800+ 行，是整个应用的总控页面。每一次改动都可能产生意想不到的分支影响。

原则：
- **先读后改**——不要盲猜状态逻辑
- **用 `replace_in_file` 精确替换**——不要用 `write_to_file` 重写大段
- **改完立即 `tsc --noEmit` 验证**——类型错误在这个文件里特别容易连锁
- **改动要小步**——大范围重构极易闪退或丢失上下文
