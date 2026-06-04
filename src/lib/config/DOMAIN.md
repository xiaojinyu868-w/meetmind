# Config — 统一配置中心

> 所有配置集中在 `app.config.ts`，通过环境变量覆盖。
> 服务层、API 路由都通过 `import { config } from '@/lib/config'` 获取配置。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `app.config.ts` | ~360 | 配置定义 + 环境变量映射（含 StepFun / DeepSeek / DashScope / Ark / Relay 模型） |
| `index.ts` | 16 | barrel 导出 |

## 配置结构

```typescript
AppConfig {
  llm: LLMConfig          // 模型提供商/API Key/默认模型
  auth: AuthConfig         // JWT 密钥/Token 过期时间
  asr: ASRConfig           // DashScope API Key/模型/采样率
  features: FeatureConfig  // 功能开关
  ui: UIConfig             // 标题/描述
  dev: DevConfig           // 开发模式开关
}
```

## 环境变量约定

- 所有环境变量在 `.env` 中定义
- `app.config.ts` 统一读取，不要在其他地方直接 `process.env.XXX`
- 新增配置项必须在 `app.config.ts` 中注册

### 模型注册表（单一真相源，环境变量驱动）

> 详见 `docs/MODEL_REGISTRY_REFACTOR.md`。**模型 id 只有一个真相源：`app.config.ts` 的 `ModelConfig[]` + `ModelDefaults`。**

- **启用哪些 provider**：由各 `*_API_KEY` 是否配置决定（StepFun / DeepSeek / Qwen / Ark / Relay）。
- **每个用途默认用哪个模型**：集中在 `ModelDefaults`，由环境变量声明，未配则回落到注册表里 `recommended` 的模型：
  - `LLM_MODEL` → `ModelDefaults.primary`（主默认）
  - `WORKSHOP_MODEL` → `ModelDefaults.workshop`（学习应用，回落 `LLM_MODEL`）
  - `TUTOR_MODEL` → `ModelDefaults.tutor`（同桌/复习 agent，回落 `LLM_MODEL`）
  - `VISION_MODEL` → `ModelDefaults.vision`（多模态，回落注册表第一个多模态模型）
- **唯一计算默认模型的地方**是 `pickAvailableModelId()`，保证返回的 id 一定在已启用模型集合内。
- **前端不自行判断模型可用性**（`*_API_KEY` 是 server-only，浏览器拿不到）：统一通过 `GET /api/llm/models` 取 `{ models, defaultModel, workshopModel }`，再在该列表里选；偏好存储里的过期 model 名会被自动纠正。
- **后端容错**：`llm-service.ts` `chat()` / `chatStreamRaw()` 拿到不在注册表的 model 会回落 `DEFAULT_MODEL_ID` 并 warn，不再 throw `未知模型` 把链路打成 500。
- **DeepSeek 官方域名**（`api.deepseek.com`）只接受小写 model 名，`llm-service.resolveDeepSeekApiModelName` 在出网那一刻转小写；内部 id 仍用 `DeepSeek-V4-Flash/Pro`。
- 上新模型：在 `app.config.ts` 加一条 `ModelConfig` + 在 `.env` 指定对应用途 env，无需改任何散落字面量。
