# Auth API Routes — 认证接口

> 认证相关 API，必须走 HTTPS，请求体/响应体类型参考 `@/types/index.ts` 中的 Auth 相关类型。

## 依赖规则

```
auth route.ts → lib/services/auth-service.ts + lib/services/llm-service.ts
auth route.ts → lib/utils/rate-limit（限流）
auth route.ts ❌ 不能 import api/ 下其他 routes
```

## 路由清单

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/login` | POST | 密码登录 |
| `/api/auth/login-with-code` | POST | 验证码登录 |
| `/api/auth/logout` | POST | 登出（清除 JWT + RefreshToken） |
| `/api/auth/me` | GET | 获取当前登录用户信息 |
| `/api/auth/refresh` | POST | 刷新 JWT AccessToken |
| `/api/auth/password` | PUT | 修改密码（需验证旧密码） |
| `/api/auth/password/set` | POST | 设置密码（注册后首次设置/无密码用户） |
| `/api/auth/reset-password` | POST | 邮箱验证码重置密码 |
| `/api/auth/send-code` | POST | 发送邮箱验证码 |
| `/api/auth/wechat` | GET | 获取微信 OAuth 跳转 URL |
| `/api/auth/wechat/callback` | GET | 微信 OAuth 回调（换取 code） |

## 文件清单

```
src/app/api/auth/
├── register/route.ts         # 53行
├── login/route.ts            # 53行
├── login-with-code/route.ts  # 97行
├── logout/route.ts           # 34行
├── me/route.ts              # 160行
├── refresh/route.ts          # 46行
├── password/route.ts         # 65行
├── password/set/route.ts     # 87行
├── reset-password/route.ts   # 68行
├── send-code/route.ts        # 80行
├── wechat/route.ts           # 147行
└── wechat/callback/route.ts  # 114行
```

## 限流配置

| 路由 | 限流 key | 默认值 |
|------|---------|-------|
| `/api/auth/login` | `authLogin` | 5次/10分钟 |
| `/api/auth/send-code` | `sendCode` | 3次/分钟 |
| `/api/auth/register` | `authRegister` | 3次/10分钟 |

## JWT 结构

- AccessToken：2小时有效期，存储在内存
- RefreshToken：7天有效期，存储在 HTTP Only Cookie

## 依赖服务

- `auth-service.ts` — JWT 签发/验证、密码哈希、验证码生成
- `llm-service.ts` — 发送验证码邮件（若有 LLM 介入内容审核）
