# Tool Panel · MeetMind Consult

> 3 个后端能力块以外，MeetMind 未来还会扩工具。本文是**现状**（2026-04 真实跑通）+
> **热更新流程**（你的 skill 想要新工具怎么办）。

## 现状

| 工具名 | 类型 | 性能 | 成本 | 落点 |
|---|---|---|---|---|
| `webSearch` | backend | 7-15s | ~1 次 qwen-max 调用 | `src/lib/services/consult-search-service.ts` |
| `readProfile` | backend | <50ms | SQLite 一次 query | `src/lib/services/consult-profile-service.ts` |
| `writeProfile` | backend | <50ms | SQLite 一次 update | 同上 |
| `askOptions` | frontend UI | 即时 | 0 | `src/components/consult/blocks.tsx` |
| `showConsultantMove` | frontend UI | 即时 | 0 | `src/components/consult/consultant-move.tsx` |
| `showAdvisorDiscovery` | frontend UI | 即时 | 0 | `src/components/consult/advisor-discovery.tsx` |
| `showServicePlan` | frontend UI | 即时 | 0 | `src/components/consult/service-plan.tsx` |
| `showOutreachWorkspace` | frontend UI | 即时 | 0 | `src/components/consult/outreach-workspace.tsx` |
| `showDraft` | frontend UI | 即时 | 0 | 同上 |
| `fileUpload` | frontend UI + backend | 2-8s 解析 | ~1 次 qwen-doc-turbo | `src/lib/services/document-parser-service.ts` |
| `ctaWechat` | frontend UI | 即时 | 0 | 同上 |

`fileUpload` 底层复用 MeetMind 已有的 document-parser-service（pdf / docx / ppt / pptx / txt / md / csv / json / html），**完全复用**，不重造。

## 热更新流程（需要新工具怎么办）

你的 scenario skill 需要一个平台目前没有的能力（比如"调取学生的标化成绩"、"给导师发邮件"、
"连 CRM 系统"），**不要瞎发明 block 类型**。按这个流程走：

### Step 1 在你的 skill 里声明依赖

在 scenario skill 目录下创建 `references/dependencies.md`：

```markdown
# Dependencies（本 skill 需要的平台新工具）

## 工具：`test-score-fetch`

**用途**：从学生关联的第三方系统拉取 TOEFL / GRE / GMAT 分数。

**输入**：
```json
{"source": "ets" | "gre-ets" | "student-input"}
```

**输出**：
```json
{"toefl": 108, "gre": {"verbal": 165, "quant": 170, "writing": 4.5}, "source": "ets", "asOf": "2025-11-01"}
```

**Fallback**（平台还没加这个工具时，skill 能做什么）：
在第 N 轮换用 askOptions 让学生手填三项分数，然后 writeProfile 到 test_scores.*。

**为什么现有工具不够**：webSearch 只能拿公开信息，test_scores 是学生私有数据，
readProfile 不能触发外部拉取。
```

### Step 2 提交 skill（`.skill` 包）

平台审核人看到 `dependencies.md`，有两种结果：

- **批准**：平台工程团队加这个工具到 `src/lib/consult/tools.ts`，加对应的 block 渲染器，
  你的 skill 自动在下次更新时可用。**无需你改 skill。**
- **拒绝**：审核员给理由（合规 / 安全 / 商业优先级）。你要么改 skill 用 fallback 绕开，
  要么放弃这个场景。

### Step 3 批准后使用

工具上线后，平台会 ping 你的 skill，你直接在 body 里调用即可。

## 什么情况绝对不能绕过

- **不要在 skill body 里写"让学生直接在聊天里粘贴他的银行卡号 / 身份证"** → 拒
- **不要发明"装作 webSearch 成功"的 mock** → 拒
- **不要在 skill 里硬编码 API key / 第三方服务 URL** → 拒，所有外部调用必须走平台工具面板

## 工具调用预算

单次 session 内，所有 backend tool 调用总和有个软约束：

- `webSearch`：每会话最多 5 次（一次 ~10 秒，超过学生会烦）
- `fileUpload` 解析：每会话最多 3 次
- `readProfile` / `writeProfile`：无限制（便宜）

超预算 runtime 会在 system prompt 后追加警告，你的剧本可以提前用"失败处理"段做降级。
