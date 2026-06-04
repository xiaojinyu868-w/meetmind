# 模型注册表架构清洗方案（Model Registry Refactor）

> 目标：把分散在 4 套真相源里的模型 id 收敛成「**环境变量驱动的单一注册表**」。
> 以后阿里云/各平台上新模型，只改 `app.config.ts` 的模型定义 + `.env`，不再改散落的字符串。
> 彻底消除 "未知模型: xxx" / 前后端模型列表不一致 / fallback 空壳。

---

## 1. 病根（清洗前）

模型 id 真相源分裂成 4 套，互不同步：

| 源 | 位置 | 问题 |
|----|------|------|
| A 注册表 | `app.config.ts` `LLMConfig.models` | 由 server-only `process.env.*_API_KEY` 决定启用项；**浏览器 bundle 里这些 env 是 undefined**，前端 `AVAILABLE_MODELS` 永远只剩 stepfun fallback，和服务端不一致 |
| B workshop 默认 | `llm-service.ts` `WORKSHOP_PREFERRED_MODEL_ID='DeepSeek-V4-Flash'` 硬编码 | 与 A 脱节；DeepSeek 没 key 时仍可能被前端旧缓存选中 |
| C tutor provider | `tutor-agent-provider.ts` `DEFAULT_STEPFUN/DEEPSEEK/QWEN_MODEL` 各一份硬编码 | 第三套真相 |
| D 散落字面量 | settings 页 / 翻译 / 思维导图 / 预判 / 转录增强 route / localStorage 历史值 | 谁都能塞名字，且无校验 |

失败链：前端 localStorage 存了服务端当下不认识的 model（`qwen3.6-plus` / 没 key 的 `DeepSeek-V4-Flash`）→ 后端 `getModelConfig` 返回 undefined → `chat()` throw `未知模型` → plugin catch → 500 / fallback 空壳。

---

## 2. 目标架构（清洗后）

### 2.1 单一注册表：`src/lib/config/app.config.ts`

- 仍是**唯一**模型定义处（`ModelConfig[]`）。
- 「启用哪些 provider」由 `*_API_KEY` 决定（保持现状）。
- 「每个用途默认用哪个模型」**全部由环境变量声明**，未配则回落到注册表里 `recommended` 的模型：

| 用途 | 环境变量 | 回落 |
|------|----------|------|
| 主默认（同桌/复习/学习应用通用） | `LLM_MODEL` | 注册表 recommended |
| 课堂工坊（workshop apps） | `WORKSHOP_MODEL` | 主默认 |
| Tutor agent | `TUTOR_MODEL` | 主默认 |
| 视觉/多模态 | `VISION_MODEL` | 注册表第一个 multimodal |

新增导出 `ModelDefaults = { primary, workshop, tutor, vision }`，全部经过「是否在 enabledModels 里」校验，不在则回落。**这是唯一计算默认模型的地方。**

### 2.2 后端容错：`src/lib/services/llm-service.ts`

- `chat()` / `chatStreamRaw()`：拿到不在注册表的 modelId 时，**不再 throw `未知模型`**，回落 `DEFAULT_MODEL_ID` 并 `log.warn`。兜底，不是主路径。
- 删除 `WORKSHOP_PREFERRED_MODEL_ID` 硬编码；`DEFAULT_WORKSHOP_MODEL_ID = LLMConfig.modelDefaults.workshop`。

### 2.3 前端不再自判可用性

- 前端**不再** import `DEFAULT_WORKSHOP_MODEL_ID` 当默认值（那是用 server env 算的，前端拿不到准）。
- 统一通过 `GET /api/llm/models`（已存在，force-static + revalidate）拿 `{ models, defaultModel, workshopModel }`（本次给 response 增补 `workshopModel`）。
- WorkshopYellowPage / WorkshopWindowManager / matrix 页：初始用 `''`，挂载后 fetch 一次 `/api/llm/models` 填默认；用户偏好仍存 localStorage，但**只在服务端返回的 models 列表里取值**，不在列表里就用服务端 defaultModel。

### 2.4 DeepSeek 官方域名小写适配（已落地，保留）

`llm-service.ts` `resolveDeepSeekApiModelName(baseUrl, modelId)`：仅 `api.deepseek.com` 时把 model 名转小写。属于 provider 适配，保留。

---

## 3. 影响文件清单

**核心：**
- `src/lib/config/app.config.ts` — 加 `ModelDefaults`，各用途 env
- `src/lib/services/llm-service.ts` — 容错回落 + `DEFAULT_WORKSHOP_MODEL_ID` 改引用
- `src/app/api/llm/models/route.ts` — response 增补 `workshopModel`

**前端去硬编码：**
- `src/components/apps/WorkshopYellowPage.tsx`
- `src/components/apps/windows/WorkshopWindowManager.tsx`
- `src/app/(main)/app/matrix/[appKey]/page.tsx`
- `src/app/(auth)/settings/page.tsx`（`'DeepSeek-V4-Flash'` → 用 fetch 的 defaultModel）
- `src/components/tutor/tutor-types.ts`（`FIXED_TUTOR_MODEL_LABEL='QWEN 3.6'` 误导，改为动态/中性）

**provider 收口：**
- `src/lib/utils/tutor-agent-provider.ts` — `DEFAULT_*_MODEL` 引用注册表

**文档/配置：**
- `.env.example` — 新增 `WORKSHOP_MODEL` / `TUTOR_MODEL` / `VISION_MODEL` 说明
- `src/lib/config/DOMAIN.md` — 更新模型真相源说明

> ASR / 图像 / 翻译 / 转录增强等「用途模型」本轮也统一改读 env + 注册表回落，但其专用模型（`qwen3-asr-*` / `qwen-image-max` / `gemini-*`）不进 LLM 对话注册表（它们不是 chat 模型），仅保证「默认值经 env，可回落」。

---

## 4. 验证

- `make check`（tsc）
- `make test`（含 `tutor-agent-provider.test.ts` / `ai-model-preference.test.ts`，必须保持绿）
- 真实请求：`/api/apps/execute`（study-report + cheatsheet）→ `llm=enabled/ok`，非 fallback
- `make eval-tutor`（dry-run，数字不回归）

---

## 5. 回滚

改动集中在 config + service + 少量前端取值，git 可整体 revert。DeepSeek 小写适配是独立函数，互不影响。
