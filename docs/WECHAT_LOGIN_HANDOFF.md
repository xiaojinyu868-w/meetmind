# 微信服务号登录 — 开发交接文档

更新日期：2026-03-09
作者：Agent（与产品负责人结对开发）

---

## 背景

MeetMind 的 Capture V1 要做到像 flomo 一样的体验：用户关注微信服务号 → 发消息 → 内容自动进入收集流。这要求微信 openId 与 MeetMind 账号绑定。

服务号（AppID: `wxd6dcbe4b80089742`，主体：原点新途创新科技）目前**暂未认证**，预计一周内完成企业认证。认证前无法使用微信网页授权 API（`snsapi_userinfo`），因此微信一键登录暂时不可用。

---

## 已完成的工作

### 1. 微信消息推送（已上线，可用）

| 文件 | 说明 |
|------|------|
| `src/app/api/wechat/mp/route.ts` | 服务号消息接收入口。GET 处理签名验证 + echostr；POST 解析 XML 消息 → 写 DB → 被动回复含 capture 链接 |
| `src/lib/services/wechat-mp-service.ts` | SHA1 签名验证、XML 解析、消息类型归一化、XML 被动回复构建 |
| `src/lib/services/wechat-inbox-service.ts` | 消息智能处理：workspace 绑定解析、echo 标题/正文生成 |

**微信后台配置已完成：**
- URL: `https://capture.meetmind.online/api/wechat/mp`
- Token: `meetmindwechat2026`
- 消息加密方式: 明文模式
- 已通过验证并启用

### 2. H5 Capture 页面（已上线，可用）

| 文件 | 说明 |
|------|------|
| `src/app/wechat/capture/[token]/page.tsx` | Server Component，查询消息详情，根据绑定状态显示不同 UI |
| `src/app/wechat/capture/[token]/WechatCaptureClient.tsx` | Client Component，处理绑定交互、OAuth session 回调检测 |

页面逻辑：
- **未绑定**：标题"先绑定 MeetMind 账号"，显示绑定表单
- **已绑定**：标题"这条内容已经进入你的收集流"，显示"打开收集流"按钮

### 3. 微信登录按钮 + OAuth 回调（代码已写好，等认证启用）

| 文件 | 说明 |
|------|------|
| `src/components/WechatBindForm.tsx` | 绑定表单组件，包含三种登录方式 |
| `src/app/api/wechat/bind/route.ts` | 绑定 API，支持密码模式和验证码模式 |
| `src/app/api/wechat/bind/callback/route.ts` | **新建** — 微信 OAuth 回调专用路由 |

**WechatBindForm 的三种登录方式（优先级从高到低）：**

1. **使用微信登录**（绿色大按钮） — 调用 `/api/wechat/bind/callback?action=authorize&linkToken=xxx` 获取授权 URL → 跳转微信授权 → 回调自动注册+绑定。**需要认证后才可用。**
2. **邮箱验证码**（折叠在"其他登录方式"里） — 没有账号自动注册，已可用。
3. **密码登录**（可切换） — 已有账号的老用户，已可用。

### 4. OAuth 回调完整流程（`/api/wechat/bind/callback`）

```
用户点"使用微信登录"
  ↓
GET /api/wechat/bind/callback?action=authorize&linkToken=xxx
  → 生成微信授权 URL（snsapi_userinfo）
  → 存储 state → linkToken 映射
  → 返回 { authUrl }
  ↓
前端跳转 authUrl（微信授权页）
  ↓
用户同意授权，微信回调
GET /api/wechat/bind/callback?code=xxx&state=xxx
  → 用 code 换 access_token + openId
  → 获取微信用户信息（nickname, headimgurl）
  → 查找 AuthProvider 是否已绑定
  → 已绑定 → 直接登录
  → 未绑定 → 自动注册新用户（wx_xxx_xxx）+ 绑定 openId
  → 同步 workspace + 收集流
  → 生成临时 session token
  → 重定向回 /wechat/capture/[linkToken]?session=xxx
  ↓
前端检测 ?session=xxx
  → POST /api/wechat/bind/callback { sessionToken }
  → 换取 accessToken + refreshToken
  → 存入 localStorage
  → 显示"绑定成功"
```

### 5. 已有的微信 OAuth 基础设施（之前就存在）

| 文件 | 说明 |
|------|------|
| `src/lib/services/wechat-auth-service.ts` | 微信 OAuth 核心：授权 URL 生成、code 换 token、获取用户信息、自动注册 |
| `src/app/api/auth/wechat/route.ts` | 通用微信登录 API（PC 扫码 + 微信内授权） |
| `src/app/api/auth/wechat/callback/route.ts` | 通用微信回调（重定向到 /login） |

### 6. Middleware 公开路由

以下路由已添加到 `src/middleware.ts` 的 `PUBLIC_ROUTES`，不需要 Bearer token：
- `/api/wechat/mp` — 消息推送
- `/api/wechat/bind` — 绑定 API
- `/api/wechat/bind/callback` — OAuth 回调
- `/api/wechat/capture/*` — capture 数据 API
- `/api/auth/send-code` — 发送验证码

---

## 认证完成后需要做的事

### 第一步：配置环境变量

编辑 `/mnt/meetmind-capture-v1-server-handoff/.env`，找到底部被注释的三行，取消注释并填写：

```env
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true
WECHAT_APP_ID=wxd6dcbe4b80089742
WECHAT_APP_SECRET=<从微信公众平台获取的 AppSecret>
```

获取 AppSecret 的路径：微信公众平台 → 设置与开发 → 基本配置 → AppSecret → 重置（首次需要扫码验证）

### 第二步：配置网页授权域名

在微信公众平台设置网页授权回调域名：
- 路径：设置与开发 → 公众号设置 → 功能设置 → 网页授权域名
- 填写：`capture.meetmind.online`
- 需要下载验证文件放到网站根目录（`public/` 目录下）

### 第三步：配置 JS 安全域名

- 路径：设置与开发 → 公众号设置 → 功能设置 → JS 接口安全域名
- 填写：`capture.meetmind.online`

### 第四步：重新构建部署

```bash
cd /mnt/meetmind-capture-v1-server-handoff
fuser -k 3002/tcp
NODE_OPTIONS="--max-old-space-size=1024" npm run build
NODE_ENV=production nohup node server.js > /tmp/meetmind-capture.log 2>&1 &
```

### 第五步：端到端测试

1. 用微信关注服务号"原点新途创新科技"
2. 发一条文字消息（如"测试微积分"）
3. 收到自动回复，包含 capture 链接
4. 点开链接，应看到绿色"使用微信登录"按钮
5. 点击 → 微信授权弹窗 → 同意
6. 自动跳回 capture 页面，显示"绑定成功"
7. 再发一条消息，直接收到"已进入收集流"的回复（不再要求绑定）

---

## 已知问题和注意事项

1. **state 和 session 存在内存 Map 中**：代码里有多处标注 `// 生产环境应使用 Redis`。当前单进程部署没问题，但如果未来多实例部署需要迁移到 Redis。

2. **wechat-auth-service.ts 第 297-299 行的潜在 bug**：已绑定用户重新登录时调用 `authService.login({ password: '' })`，密码验证会失败。新的 `/api/wechat/bind/callback` 路由已用 `loginWithCode` 方式绕过此问题，但原来的 `/api/auth/wechat/callback` 仍有此 bug。

3. **UserAnalytics 表缺失**：日志中会出现 `P2025` 错误（analytics 表缺记录），不影响核心功能。如需修复：`npx prisma db push --accept-data-loss`。

4. **构建内存限制**：服务器只有 3.5GB 内存，构建时需要加 `NODE_OPTIONS="--max-old-space-size=1024"`。

---

## 关键文件清单

```
src/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── wechat/
│   │   │   │   ├── route.ts              # 通用微信登录 API
│   │   │   │   └── callback/route.ts     # 通用微信回调
│   │   │   ├── login-with-code/route.ts  # 验证码登录（自动注册）
│   │   │   └── send-code/route.ts        # 发送验证码
│   │   └── wechat/
│   │       ├── mp/route.ts               # 服务号消息推送入口
│   │       └── bind/
│   │           ├── route.ts              # 绑定 API（密码/验证码模式）
│   │           └── callback/route.ts     # ★ OAuth 回调（capture 场景）
│   └── wechat/
│       └── capture/[token]/
│           ├── page.tsx                  # Server Component
│           └── WechatCaptureClient.tsx   # Client Component（含 session 检测）
├── components/
│   └── WechatBindForm.tsx                # ★ 绑定表单（微信登录 + 验证码 + 密码）
├── lib/
│   └── services/
│       ├── auth-service.ts               # 认证核心（注册/登录/JWT）
│       ├── wechat-auth-service.ts        # 微信 OAuth 核心
│       ├── wechat-mp-service.ts          # 服务号消息处理
│       ├── wechat-inbox-service.ts       # 收集流智能处理
│       ├── workspace-service.ts          # workspace 绑定/同步
│       └── workspace-context-service.ts  # capture/echo 同步
└── middleware.ts                         # 路由鉴权（PUBLIC_ROUTES）
```

---

## 数据库关键表

- `User` — 用户账户
- `AuthProvider` — 第三方登录绑定（provider='wechat', providerId=openId）
- `Workspace` / `WorkspaceMembership` — 用户工作区
- `WorkspaceCapture` — 收集流条目
- `WorkspaceEcho` — echo 卡片
- `WechatInboxMessage` — 微信收到的原始消息（含 bindingStatus, linkToken）
