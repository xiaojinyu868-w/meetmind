# Config — 统一配置中心

> 所有配置集中在 `app.config.ts`，通过环境变量覆盖。
> 服务层、API 路由都通过 `import { config } from '@/lib/config'` 获取配置。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `app.config.ts` | 293 | 配置定义 + 环境变量映射 |
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
