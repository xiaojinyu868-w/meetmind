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
- **StepFun 是当前默认 AI**：`STEPFUN_API_KEY` 配置后，所有 AI 调用（同桌 / 复习 / 学习应用 / 速查表 / Tutor agent）默认使用 `step-3.7-flash`，OpenAI 兼容，base URL `https://api.stepfun.com/v1`。文档：https://platform.stepfun.com/docs/zh/quickstart/overview
- DeepSeek（`DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL`）和 DashScope（`DASHSCOPE_API_KEY` + `LLM_BASE_URL`）保留为 fallback；当 StepFun 出现 5xx / 429 / 超时且尚未输出内容时，Tutor agent 会自动切到 DeepSeek，再切到 DashScope。
- 用户可在设置页（`/settings`）覆盖模型偏好；选择"自动"则使用 `LLMConfig.defaultModel`（即 `step-3.7-flash`）。
