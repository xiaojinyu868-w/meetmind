# Config — 统一配置中心

> 所有配置集中在 `app.config.ts`，通过环境变量覆盖。
> 服务层、API 路由都通过 `import { config } from '@/lib/config'` 获取配置。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `app.config.ts` | ~360 | 配置定义 + 环境变量映射（含 StepFun / DeepSeek / DashScope / Ark / Relay 模型） |
| `pricing.ts` | ~230 | 模型定价表（积分影子计量唯一数值真相源）：每模型输入/输出毫元每百万 token，估算值以控制台价目校准；未知模型 fallback 2000/4000 并 warn；Phase 2 价目（POINTS_CONFIG / Tutor / 应用执行 / RECHARGE_PACKS 充值包）与订阅会员档（MEMBERSHIP_PLANS：pro ¥39 / max ¥79，配额+deep 解锁+折扣；getPayableItem 统一解析积分包/会员档）也在此 |
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

- **启用哪些 provider**：由各 `*_API_KEY` 是否配置决定（StepFun / DeepSeek / Qwen / Ark / Relay / Moonshot）。Moonshot（`MOONSHOT_API_KEY`）注册 `MOONSHOT_MODEL`（默认 kimi-k3），当前用于板书导演 pass（节奏标注，见 services/board-director-service）。
- **每个用途默认用哪个模型**：集中在 `ModelDefaults`，由环境变量声明，未配则回落到注册表里 `recommended` 的模型：
  - `LLM_MODEL` → `ModelDefaults.primary`（主默认）
  - `WORKSHOP_MODEL` → `ModelDefaults.workshop`（学习应用，回落 `LLM_MODEL`）
  - `TUTOR_MODEL` → `ModelDefaults.tutor`（同桌/复习 agent，回落 `LLM_MODEL`）
  - `TUTOR_QUICK_MODEL` → `ModelDefaults.tutorQuick`（Ask MeetMind「直接问」，留空优先 `TUTOR_MODEL` 同 provider 的 Flash；显式请求模型仍优先）
  - `VISION_MODEL` → `ModelDefaults.vision`（多模态，回落注册表第一个多模态模型）
- **唯一计算默认模型的地方**是 `pickAvailableModelId()`，保证返回的 id 一定在已启用模型集合内。
- **前端不自行判断模型可用性**（`*_API_KEY` 是 server-only，浏览器拿不到）：统一通过 `GET /api/llm/models` 取 `{ models, defaultModel, workshopModel }`，再在该列表里选；偏好存储里的过期 model 名会被自动纠正。
- **后端容错**：`llm-service.ts` `chat()` / `chatStreamRaw()` 拿到不在注册表的 model 会回落 `DEFAULT_MODEL_ID` 并 warn，不再 throw `未知模型` 把链路打成 500。
- **DeepSeek 0731 快照**：百炼托管（`dashscope.aliyuncs.com` compatible-mode）锁定 `deepseek-v4-flash-0731` 快照，避免裸别名随平台升级静默漂移；DeepSeek 官方 API（`api.deepseek.com`）的 `deepseek-v4-flash` 同名即 0731。两边模型 id 均为小写，`llm-service.resolveDeepSeekApiModelName` 在出网那一刻转小写并按 baseUrl 决定是否追加 `-0731`；内部 id 仍用 `DeepSeek-V4-Flash/Pro`。
- 上新模型：在 `app.config.ts` 加一条 `ModelConfig` + 在 `.env` 指定对应用途 env，无需改任何散落字面量。
