# OpenBiliClaw 信息流集成计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把笔记总结 tab 升级为基于个人上下文（MeetMind 课堂收集 + 平台行为）的信息流推荐，由用户本地部署的 OpenBiliClaw 作为画像 + 推荐后端驱动。

**Architecture:** MeetMind 是云端 Web 应用，用户在浏览器里访问。OpenBiliClaw 是用户本地 Python 服务（localhost:8420）。MeetMind 前端检测本地 OpenBiliClaw 在线状态——在线时笔记总结 tab 升级为信息流 tab，前端直连 OpenBiliClaw HTTP API 获取推荐/画像/探针；离线时降级到现有笔记总结功能。两个数据源：来源 1（APP 课堂收集）通过 OpenBiliClaw 的 chat 命令注入画像；来源 2（平台行为）由 OpenBiliClaw 原生 sync-account 拉取。

**Tech Stack:** MeetMind（Next.js / TypeScript / Zustand）/ OpenBiliClaw（Python / FastAPI / SQLite / Docker）/ 浏览器扩展（OpenBiliClaw 自带 Manifest V3）

---

## 关键风险与前置验证

| 风险 | 影响 | 缓解 |
|------|------|------|
| OpenBiliClaw HTTP API 端点未知 | 不知道前端能调哪些 API | Task 1 先验证 app.py 路由 |
| CORS 不支持 | 前端无法跨域 fetch localhost:8420 | 改 OpenBiliClaw 源码加 CORS 中间件（FastAPI 一行） |
| CLI bridge 不能从浏览器调用 | chat / submit-feedback 无法前端直调 | 用 HTTP API 替代或扩展中转 |
| 端口冲突 | 8420 被占 | 可配置端口 |
| 用户门槛 | 装 Docker + 扩展 | 一键脚本 + 引导 UI |

---

## Task 1: 验证 OpenBiliClaw HTTP API 端点

**这是整个计划的可行性闸门——先做这个，确认 API 可用再继续。**

**Files:**
- Read: OpenBiliClaw 仓库 `src/openbiliclaw/api/app.py`（路由定义）
- Read: OpenBiliClaw 仓库 `docs/mobile-web-spec.md`（Mobile Web 用的 API）
- Read: OpenBiliClaw 仓库 `src/openbiliclaw/integrations/openclaw/operations.py`（CLI bridge 实际调什么）

**Step 1: 克隆 OpenBiliClaw 仓库到本地**

```bash
cd /tmp
git clone https://github.com/whiteguo233/OpenBiliClaw.git
```

**Step 2: 搜索 app.py 里的所有路由定义**

```bash
grep -n '@app\.\(get\|post\|put\|delete\|websocket\)' /tmp/OpenBiliClaw/src/openbiliclaw/api/app.py
```

目标：列出所有 HTTP 端点，确认有没有：
- `GET /api/recommendations` 或类似（拉推荐）
- `GET /api/profile` 或类似（读画像）
- `POST /api/events` 或类似（注入事件）
- `POST /api/chat` 或类似（苏格拉底对话）
- `POST /api/feedback` 或类似（反馈写回）

**Step 3: 确认 CORS 配置**

```bash
grep -n -i 'cors\|CORSMiddleware\|allow_origin' /tmp/OpenBiliClaw/src/openbiliclaw/api/app.py
```

如果没有 CORS 中间件，记录下来——Task 2 要加。

**Step 4: 看 operations.py 确认 CLI bridge 调的是 HTTP API 还是内部模块**

```bash
grep -n 'def \|http\|fetch\|request\|api/' /tmp/OpenBiliClaw/src/openbiliclaw/integrations/openclaw/operations.py
```

目标：确认 `get-profile` / `recommend` / `chat` 这些 CLI 命令背后是调 HTTP API 还是直接调 Python 模块。如果是调 HTTP API，MeetMind 前端可以直接调同样的 API。

**Step 5: 记录验证结果**

在 plan 文件末尾追加"API 验证结果"段落，列出：
- 可用的 HTTP 端点清单
- CORS 是否支持
- CLI bridge 是否走 HTTP API
- 需要改 OpenBiliClaw 源码的地方

**如果 API 不可用或 CORS 无法解决，暂停计划，回到架构讨论。**

---

## Task 2: 部署 OpenBiliClaw + 加 CORS 支持

**Files:**
- Deploy: OpenBiliClaw Docker（localhost:8420）
- Modify: OpenBiliClaw `src/openbiliclaw/api/app.py`（加 CORS 中间件，如果 Task 1 确认需要）

**Step 1: 用一键脚本部署 OpenBiliClaw**

```bash
curl -fsSL https://raw.githubusercontent.com/whiteguo233/OpenBiliClaw/main/scripts/install.sh | bash
```

用 Docker 模式：
```bash
MODE=docker curl -fsSL https://raw.githubusercontent.com/whiteguo233/OpenBiliClaw/main/scripts/install.sh | bash
```

**Step 2: 如果 CORS 不支持，加中间件**

在 `src/openbiliclaw/api/app.py` 的 FastAPI app 创建后加：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 或指定 MeetMind 域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Step 3: 验证健康检查**

```bash
curl -sS http://127.0.0.1:8420/api/health
# 期望: {"status":"ok","service":"openbiliclaw-api"}
```

**Step 4: 验证 CORS**

```bash
curl -sS -I -X OPTIONS http://127.0.0.1:8420/api/health \
  -H "Origin: https://app.meetmind.xxx" \
  -H "Access-Control-Request-Method: GET"
# 期望: 响应头含 Access-Control-Allow-Origin
```

**Step 5: 跑 init 拉取画像（需要 B站 Cookie + LLM API Key）**

```bash
uv run openbiliclaw init --no-xhs --no-douyin --no-youtube
```

---

## Task 3: MeetMind 前端 OpenBiliClaw 连接检测

**Files:**
- Create: `src/lib/services/openbilicaw-client.ts` — OpenBiliClaw API 客户端
- Create: `src/hooks/useOpenBiliClawConnection.ts` — 连接状态检测 hook
- Modify: `src/lib/config/app.config.ts` — 加 OpenBiliClaw 配置项
- Modify: `.env.example` — 加 `OPENBILICLAW_API_URL`

**Step 1: 加配置项**

`src/lib/config/app.config.ts` 加：
```typescript
openbiliclaw: {
  /** 用户本地 OpenBiliClaw 地址，默认 localhost:8420 */
  apiUrl: process.env.NEXT_PUBLIC_OPENBILICLAW_API_URL || 'http://127.0.0.1:8420',
  /** 连接超时 ms */
  healthCheckTimeout: 2000,
},
```

`.env.example` 加：
```
# ===== OpenBiliClaw 信息流后端（可选，技术性学生本地部署）=====
# 用户本地部署的 OpenBiliClaw 地址。在线时笔记总结 tab 升级为信息流 tab。
# 不配置则使用默认 localhost:8420；OpenBiliClaw 离线时降级到现有笔记总结。
# NEXT_PUBLIC_OPENBILICLAW_API_URL=http://127.0.0.1:8420
```

**Step 2: 写 OpenBiliClaw API 客户端**

`src/lib/services/openbiliclaw-client.ts`：

```typescript
import { appConfig } from '@/lib/config/app.config';

const API_URL = appConfig.openbiliclaw.apiUrl;
const TIMEOUT = appConfig.openbiliclaw.healthCheckTimeout;

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenBiliClawHealth {
  online: boolean;
  service?: string;
  error?: string;
}

/** 检测本地 OpenBiliClaw 是否在线 */
export async function checkOpenBiliClawHealth(): Promise<OpenBiliClawHealth> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/health`);
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { online: true, service: data.service };
  } catch (err) {
    return { online: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 以下端点需要 Task 1 验证后确认实际路径
// 占位名基于 CLI 命令名推断

export interface OpenBiliClawProfile {
  // 画像结构待 Task 1 确认后补全
  [key: string]: unknown;
}

export async function getProfile(): Promise<OpenBiliClawProfile | null> {
  // TODO: Task 1 确认端点后实现
  return null;
}

export interface OpenBiliClawRecommendation {
  // 推荐结构待 Task 1 确认后补全
  [key: string]: unknown;
}

export async function getRecommendations(limit = 5): Promise<OpenBiliClawRecommendation[]> {
  // TODO: Task 1 确认端点后实现
  return [];
}
```

**Step 3: 写连接检测 hook**

`src/hooks/useOpenBiliClawConnection.ts`：

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { checkOpenBiliClawHealth, type OpenBiliClawHealth } from '@/lib/services/openbiliclaw-client';

export function useOpenBiliClawConnection() {
  const [health, setHealth] = useState<OpenBiliClawHealth>({ online: false });
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const result = await checkOpenBiliClawHealth();
    setHealth(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    // 每 30 秒重检一次（OpenBiliClaw 可能随时启停）
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [check]);

  return { online: health.online, health, checking, recheck: check };
}
```

**Step 4: 类型检查**

```bash
make check
```

**Step 5: Commit**

```bash
git add src/lib/services/openbiliclaw-client.ts \
        src/hooks/useOpenBiliClawConnection.ts \
        src/lib/config/app.config.ts \
        .env.example
git commit -m "feat: add OpenBiliClaw connection detection (M15- feed integration step 1)"
```

---

## Task 4: 笔记总结 tab → 信息流 tab（在线时切换）

**Files:**
- Modify: `src/types/page-types.ts` — 加 `feed` tab 类型
- Modify: `src/hooks/useCollectionPulse.ts` — 在线时用 OpenBiliClaw 推荐替代规则 pulse
- Create: `src/components/FeedStream.tsx` — 信息流渲染组件
- Modify: `src/app/(main)/app/page.tsx` — tab 切换逻辑
- Modify: `src/lib/ui/copy.ts` — 信息流文案

**Step 1: 加 tab 类型**

`src/types/page-types.ts`：

```typescript
// 现有：
// export type WorkspaceTab = 'timeline' | 'anchor-detail' | 'chat' | 'confusion' | 'transcript' | SharedWorkspaceTab;
// 改为：
export type WorkspaceTab = 'timeline' | 'anchor-detail' | 'chat' | 'confusion' | 'transcript' | 'feed' | SharedWorkspaceTab;
```

**Step 2: 写信息流文案**

`src/lib/ui/copy.ts` 加 `feed` 段：

```typescript
feed: {
  tabLabel: '信息流',
  tabLabelOffline: '笔记总结',
  emptyOnline: '同学还在理解你收集的内容，稍等一下就有了',
  emptyOffline: '这节课还没有整理。结束录音后同学会自动整理',
  probeNear: '同主题',
  probeLateral: '相关方向',
  probeBridge: '跨界',
  probeWildcard: '意外惊喜',
  feedbackLike: '有用',
  feedbackDislike: '跳过',
  notConnected: '本地同学没在线——装上 OpenBiliClaw 可以获得基于你完整画像的信息流推荐',
  connectGuide: '如何连接',
},
```

**Step 3: 写 FeedStream 组件**

`src/components/FeedStream.tsx`（骨架，具体渲染待 API 确认后补全）：

```tsx
'use client';

import { COPY } from '@/lib/ui/copy';
import type { OpenBiliClawRecommendation } from '@/lib/services/openbiliclaw-client';

interface FeedStreamProps {
  online: boolean;
  recommendations: OpenBiliClawRecommendation[];
  loading: boolean;
}

export function FeedStream({ online, recommendations, loading }: FeedStreamProps) {
  if (!online) {
    // 降级：渲染现有笔记总结
    return null; // 由父组件渲染现有 SummaryView
  }

  if (loading) {
    return <div className="text-sm text-foreground/50">{COPY.feed.emptyOnline}</div>;
  }

  if (recommendations.length === 0) {
    return <div className="text-sm text-foreground/50">{COPY.feed.emptyOnline}</div>;
  }

  return (
    <div className="space-y-4">
      {recommendations.map((rec, i) => (
        <FeedCard key={i} recommendation={rec} />
      ))}
    </div>
  );
}

function FeedCard({ recommendation }: { recommendation: OpenBiliClawRecommendation }) {
  // 具体卡片结构待 API 确认后补全
  return (
    <div className="rounded-lg border border-surface-ai p-4">
      {/* TODO: 渲染推荐内容 */}
    </div>
  );
}
```

**Step 4: page.tsx tab 切换**

在 `src/app/(main)/app/page.tsx` 的 tab 渲染逻辑里：
- OpenBiliClaw 在线时：`apps` tab 旁边加 `feed` tab（或替换 `apps` tab 的内容）
- 离线时：不显示 `feed` tab，保持现有 `apps` tab

**Step 5: 类型检查 + commit**

```bash
make check
git add src/types/page-types.ts src/components/FeedStream.tsx src/lib/ui/copy.ts src/app/(main)/app/page.tsx
git commit -m "feat: add feed tab with OpenBiliClaw online/offline switch (M15- step 2)"
```

---

## Task 5: 信息流数据拉取——前端调 OpenBiliClaw recommend API

**前置：Task 1 已确认 recommend 的 HTTP API 端点**

**Files:**
- Modify: `src/lib/services/openbiliclaw-client.ts` — 实现 getRecommendations
- Create: `src/hooks/useFeedStream.ts` — 信息流数据 hook
- Modify: `src/components/FeedStream.tsx` — 渲染真实推荐数据

**Step 1: 实现 getRecommendations**

`src/lib/services/openbiliclaw-client.ts`（端点路径待 Task 1 确认）：

```typescript
export async function getRecommendations(limit = 5): Promise<OpenBiliClawRecommendation[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_URL}/api/recommendations?limit=${limit}`  // 路径待 Task 1 确认
    );
    if (!res.ok) return [];
    const data = await res.json();
    // 结构待 Task 1 确认后调整
    return Array.isArray(data) ? data : (data.items ?? data.recommendations ?? []);
  } catch {
    return [];
  }
}
```

**Step 2: 写 useFeedStream hook**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { getRecommendations, type OpenBiliClawRecommendation } from '@/lib/services/openbiliclaw-client';

export function useFeedStream(online: boolean) {
  const [items, setItems] = useState<OpenBiliClawRecommendation[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!online) {
      setItems([]);
      return;
    }
    setLoading(true);
    const recs = await getRecommendations(5);
    setItems(recs);
    setLoading(false);
  }, [online]);

  useEffect(() => {
    if (online) refresh();
  }, [online, refresh]);

  return { items, loading, refresh };
}
```

**Step 3: 接入 FeedStream**

**Step 4: 类型检查 + commit**

---

## Task 6: 数据源 1 桥接——MeetMind 课堂行为注入 OpenBiliClaw 画像

**核心：把 MeetMind 收集的课堂内容（录音/转录/笔记/困惑）通过 OpenBiliClaw 的 chat API 注入画像。**

**前置：Task 1 已确认 chat 的 HTTP API 端点（或确认需要走 CLI/扩展中转）**

**Files:**
- Modify: `src/lib/services/openbiliclaw-client.ts` — 加 sendChatEvent
- Create: `src/lib/services/feed-bridge-service.ts` — MeetMind → OpenBiliClaw 数据桥接
- Modify: `src/hooks/useCollectionComposer.ts` 或相关 hook — 收集行为时触发注入

**Step 1: 实现 sendChatEvent**

```typescript
export async function sendChatEvent(message: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/chat`, {  // 路径待确认
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

**Step 2: 写桥接 service**

`src/lib/services/feed-bridge-service.ts`：

```typescript
import { sendChatEvent } from './openbiliclaw-client';

/**
 * 把 MeetMind 课堂收集行为格式化为 OpenBiliClaw 可理解的对话事件。
 * 不发原始转录全文——只发结构化摘要（主题 + 困惑标记 + 笔记）。
 */
export function formatCollectionEvent(input: {
  type: 'recording' | 'note' | 'confusion' | 'flashcard';
  subject?: string;
  topic?: string;
  summary?: string;
  confusionCount?: number;
}): string {
  switch (input.type) {
    case 'recording':
      return `我刚录了一节${input.subject ?? '课'}${input.topic ? `，主题是${input.topic}` : ''}。${
        input.confusionCount ? `标记了${input.confusionCount}处没懂的地方。` : ''
      }`;
    case 'note':
      return `我在课上记了一条笔记：${input.summary ?? ''}`;
    case 'confusion':
      return `我在课上标记了一个困惑点：${input.summary ?? ''}`;
    case 'flashcard':
      return `我把这节课的内容做成了闪卡练习`;
    default:
      return '';
  }
}

/** 异步注入，失败静默（不阻塞 MeetMind 主流程） */
export async function bridgeCollectionEvent(input: Parameters<typeof formatCollectionEvent>[0]): Promise<void> {
  const message = formatCollectionEvent(input);
  if (!message) return;
  await sendChatEvent(message).catch(() => undefined);
}
```

**Step 3: 在收集行为时触发注入**

在录音结束 / 笔记创建 / 困惑标记时调 `bridgeCollectionEvent`。要异步、不阻塞、失败静默。

**Step 4: 类型检查 + commit**

---

## Task 7: 用户反馈写回——like/dislike 更新画像

**Files:**
- Modify: `src/lib/services/openbiliclaw-client.ts` — 加 submitFeedback
- Modify: `src/components/FeedStream.tsx` — FeedCard 加反馈按钮

**Step 1: 实现 submitFeedback**

```typescript
export async function submitFeedback(
  recommendationId: string,
  feedbackType: 'like' | 'dislike' | 'comment',
  note?: string,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/feedback`, {  // 路径待确认
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recommendation_id: recommendationId,
        feedback_type: feedbackType,
        note,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

**Step 2: FeedCard 加反馈 UI**

**Step 3: 类型检查 + commit**

---

## Task 8: 主动推送——监听 OpenBiliClaw delight/probe 事件

**Files:**
- Create: `src/hooks/useOpenBiliClawEvents.ts` — WebSocket 事件监听
- Modify: `src/components/FeedStream.tsx` — 插入推送的推荐/探针

**Step 1: 写事件监听 hook**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { appConfig } from '@/lib/config/app.config';

export interface OpenBiliClawEvent {
  type: 'delight.candidate' | 'interest.probe';
  data: unknown;
}

export function useOpenBiliClawEvents(online: boolean) {
  const [events, setEvents] = useState<OpenBiliClawEvent[]>([]);

  useEffect(() => {
    if (!online) return;
    const wsUrl = appConfig.openbiliclaw.apiUrl.replace('http', 'ws') + '/api/runtime-stream';
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'delight.candidate' || msg.type === 'interest.probe') {
            setEvents((prev) => [...prev, msg].slice(-10));
          }
        } catch { /* ignore */ }
      };
    } catch { /* ignore */ }

    return () => ws?.close();
  }, [online]);

  return { events, clearEvents: () => setEvents([]) };
}
```

**Step 2: 接入 FeedStream**

**Step 3: 类型检查 + commit**

---

## Task 9: 离线降级——OpenBiliClaw 不在线时回到现有笔记总结

**Files:**
- Modify: `src/app/(main)/app/page.tsx` — 离线时渲染现有 SummaryView
- Modify: `src/components/FeedStream.tsx` — 离线时返回 null 让父组件降级
- Modify: `src/lib/ui/copy.ts` — 离线提示文案

**Step 1: 降级逻辑**

在 page.tsx 的 tab 渲染里：
```tsx
{activeTab === 'feed' && (
  openBiliClawOnline ? <FeedStream ... /> : <SummaryView ... />  // 现有笔记总结
)}
```

**Step 2: tab label 动态切换**

在线时显示"信息流"，离线时显示"笔记总结"。

**Step 3: 类型检查 + commit**

---

## Task 10: 连接引导 UI——帮助技术性学生一键连接

**Files:**
- Create: `src/components/OpenBiliClawConnectGuide.tsx` — 连接引导弹窗
- Modify: `src/lib/ui/copy.ts` — 引导文案

**Step 1: 写引导组件**

内容：
1. "什么是 OpenBiliClaw"——一句话解释（基于你完整画像的信息流推荐，数据 100% 本地）
2. "如何连接"——三步引导（装 Docker → 一键脚本 → 装浏览器扩展）
3. "连接状态"——检测 localhost:8420 在线/离线
4. "断开连接"——回到现有笔记总结

**Step 2: 入口**

在设置页或 feed tab 空态里放入口。

**Step 3: 类型检查 + commit**

---

## Task 11: 文档同步

**Files:**
- Create: `src/lib/services/DOMAIN.md` — 补 openbilicaw-client.ts / feed-bridge-service.ts
- Modify: `src/app/api/DOMAIN.md` 或相关 — 补 feed tab 说明
- Modify: `AGENTS.md` — 第 0 节阅读路径加 feed 集成说明
- Modify: `.env.example` — 已在 Task 3 完成
- Create: `docs/OPENBILICLAW_INTEGRATION.md` — 完整集成文档

**Step 1: 写集成文档**

`docs/OPENBILICLAW_INTEGRATION.md`：
- 架构图
- 部署步骤
- API 端点清单（Task 1 验证结果）
- 数据流说明
- 降级策略
- FAQ

**Step 2: 更新 DOMAIN.md**

**Step 3: 更新 AGENTS.md**

**Step 4: Commit**

---

## 执行顺序

```
Task 1 (验证 API) ──→ 可行性闸门
  │
  ├─ 不可行 → 暂停，回到架构讨论
  │
  └─ 可行 → Task 2 (部署 + CORS)
              → Task 3 (连接检测)
              → Task 4 (tab 切换骨架)
              → Task 5 (信息流数据) ──并行──→ Task 6 (数据源1桥接)
              → Task 7 (反馈写回)
              → Task 8 (主动推送)
              → Task 9 (离线降级)
              → Task 10 (连接引导)
              → Task 11 (文档)
```

Task 1 是闸门——先做，确认 API 可用再继续其余任务。

---

## API 验证结果

（Task 1 完成后在此记录）
