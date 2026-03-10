# 微信服务号登录 — 开发交接文档

更新日期：2026-03-10
作者：Agent（与产品负责人结对开发）

---

## 背景

MeetMind 的 Capture V1 要做到像 flomo 一样的体验：用户关注微信服务号 → 发消息 → 内容自动进入收集流。这要求微信 openId 与 MeetMind 账号绑定。

服务号（AppID: `wxd6dcbe4b80089742`，主体：原点新途创新科技）目前**暂未认证**，预计一周内完成企业认证。认证前无法使用微信网页授权 API（`snsapi_userinfo`），因此微信一键登录暂时不可用。

---

## 已完成的工作

### 阶段一：基础消息推送与绑定（03-09 完成）

#### 1. 微信消息推送（已上线，可用）

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

#### 2. H5 Capture 页面（已上线，可用）

| 文件 | 说明 |
|------|------|
| `src/app/wechat/capture/[token]/page.tsx` | Server Component，查询消息详情，根据绑定状态显示不同 UI |
| `src/app/wechat/capture/[token]/WechatCaptureClient.tsx` | Client Component，处理绑定交互、OAuth session 回调检测 |

#### 3. 微信登录按钮 + OAuth 回调（代码已写好，等认证启用）

| 文件 | 说明 |
|------|------|
| `src/components/WechatBindForm.tsx` | 绑定表单组件，包含三种登录方式 |
| `src/app/api/wechat/bind/route.ts` | 绑定 API，支持密码模式和验证码模式 |
| `src/app/api/wechat/bind/callback/route.ts` | 微信 OAuth 回调专用路由 |

#### 4. 已有的微信 OAuth 基础设施

| 文件 | 说明 |
|------|------|
| `src/lib/services/wechat-auth-service.ts` | 微信 OAuth 核心：授权 URL 生成、code 换 token、获取用户信息、自动注册 |
| `src/app/api/auth/wechat/route.ts` | 通用微信登录 API（PC 扫码 + 微信内授权） |
| `src/app/api/auth/wechat/callback/route.ts` | 通用微信回调（重定向到 /login） |

---

### 阶段二：收集流连续性 + 直接打开（03-10 完成，分支 `feature/wechat-capture-stream-continuity`）

**产品意图**：用户在微信连续发多条消息后，打开 app/web 应该在主聊天流里按时间顺序看到所有消息，而不是一条在主流、一条在"历史收集"抽屉里。已绑定用户点微信回复链接应直接进入主流，不需要二级跳转。

#### 5. 收集流连续性改造

##### 5a. 微信消息角色统一（`wechat-inbox-service.ts`）

**改动**：`inferCollectionRole` 从"只有 voice 是 primary"改为"只有 event 是 support，其他都是 primary"

```typescript
function inferCollectionRole(message: NormalizedWechatMessage): CollectionRole {
  if (message.msgType === 'event') return 'support';
  return 'primary';
}
```

**影响**：所有微信发来的文字/图片/语音/链接消息都会作为主流消息（primary），不再被当作辅助材料。

##### 5b. 前端 sourceKey 去重 + 兜底同步（`app/page.tsx`）

**改动**：
- `SourceIngestItem` 增加 `sourceKey` 字段（格式 `wechat:{linkToken}`）
- `inferWechatCaptureRole` / `inferWorkspaceCaptureRole` 统一微信消息为 primary
- 新增 `resolveSourceItemSourceKey`、`buildWorkspaceCaptureSourceItem`、`mergeWechatWorkspaceCapturesIntoSourceItems` 辅助函数
- `wechat_capture` 单条导入时补齐 `sourceKey`、媒体信息、`origin`
- `workspaceContextRequestKeyRef` 改为 `${user.id}:${wechatCaptureToken}` 组合键（支持多次微信入口）
- 兜底 useEffect：把 `workspaceCaptures` 中的微信 capture 自动补回 `sourceItems`

#### 6. 共享微信 Web 会话服务（新建）

| 文件 | 说明 |
|------|------|
| `src/lib/services/wechat-web-session-service.ts` | **新建** — 统一的短期 session 创建/消费，替代各路由各自维护的 Map |

提供 `createWechatWebSession()` 和 `consumeWechatWebSession()` 两个函数，内部维护带 TTL（2分钟）的 Map。所有需要安全传递认证信息的微信入口统一使用。

**消费方**：
- `src/app/api/auth/wechat/callback/route.ts` — 已改用共享服务
- `src/app/api/wechat/bind/callback/route.ts` — 已改用共享服务
- `src/app/wechat/open/[token]/route.ts` — 新路由直接使用

#### 7. 已绑定用户直接打开入口（新建）

| 文件 | 说明 |
|------|------|
| `src/app/wechat/open/[token]/route.ts` | **新建** — 已绑定用户的微信直接打开入口，跳过 H5 承接页 |

**流程**：
```
微信回复链接（已绑定用户）
  → GET /wechat/open/{linkToken}
  → 查询消息绑定状态
  → 绑定 → authService.createSessionForUserId() 签发 JWT
  → createWechatWebSession() 创建临时会话
  → 302 重定向到 /app?mobile=1&wechat_capture={token}&session={sessionToken}
  → 未绑定 → fallback 到 /wechat/capture/{token}（H5 承接页）
```

**注意**：重定向 URL 使用 `x-forwarded-host` + `x-forwarded-proto` 构建，因为 nginx 反代后 `request.url` 的 host 是 `localhost:3002`。

#### 8. auth-service 新增方法

`src/lib/services/auth-service.ts` 新增 `createSessionForUserId(userId)` 方法：按 userId 直接签发 JWT + refreshToken，无需密码或验证码。供 `/wechat/open/[token]` 路由使用。

#### 9. 微信回复链接按绑定状态分流

`src/app/api/wechat/mp/route.ts` 新增 `buildWechatEntryUrl()` 函数：
- **已绑定**用户 → 链接指向 `/wechat/open/{token}`（直接进主流）
- **未绑定**用户 → 链接指向 `/wechat/capture/{token}`（H5 承接页）

#### 10. 绑定回调完成后直接跳主流

`src/app/api/wechat/bind/callback/route.ts` 改动：
- 移除旧的 `bindSessions` Map，改用共享 `wechat-web-session-service`
- 绑定完成后重定向目标从 `/wechat/capture/{token}` 改为 `/app?mobile=1&wechat_capture={token}&session={sessionToken}`

#### 11. Middleware 公开路由更新

`src/middleware.ts` 的 `PUBLIC_ROUTES` 新增：
- `/wechat/open/*` — 已绑定用户直接打开入口

完整公开路由列表：
- `/api/wechat/mp` — 消息推送
- `/api/wechat/bind` — 绑定 API
- `/api/wechat/bind/callback` — OAuth 回调
- `/api/wechat/capture/*` — capture 数据 API
- `/wechat/open/*` — **新增** 直接打开入口
- `/api/auth/send-code` — 发送验证码

---

## 当前状态

- **分支**：`feature/wechat-capture-stream-continuity`
- **构建**：`npm run build` 通过（52 个页面全部编译成功）
- **服务器**：需要重启以加载新构建（见下方部署步骤）

---

## 待完成 / 后续需要做的事

### 立即需要做的

#### 1. 重启服务器（加载新构建）

```bash
cd /mnt/meetmind-capture-v1-server-handoff
pkill -f 'node server.js'
sleep 2
NODE_ENV=production nohup node server.js > /tmp/meetmind-server.log 2>&1 &
```

#### 2. 端到端验证（微信连续消息 → 直接进入主流）

测试步骤：
1. 在微信服务号连续发 2-3 条消息
2. 点击**最后一条**消息的回复链接
3. 预期：已绑定用户 → 直接跳到 `/app` 主流（不经过 H5 承接页）
4. 预期：主流中按时间顺序显示所有连续发的消息
5. 检查"历史收集"抽屉中也能看到这些消息（双写）

#### 3. `useAuth` 兼容性确认

当前 `useAuth` 的 `handleWechatSession` 调用 `POST /api/auth/wechat/callback` 交换 session token。新的 `/wechat/open/[token]` 创建的 session 存在共享服务中，需要确认：
- `POST /api/auth/wechat/callback` 的 `consumeWechatWebSession` 能正确消费这些 session ✅（已验证代码逻辑兼容）
- URL 中的 `session` 参数能被 `useAuth` 正确检测和消费 ✅（已验证 initAuth 逻辑）

### 认证完成后需要做的

#### 4. 配置环境变量

编辑 `.env`，取消注释并填写：

```env
NEXT_PUBLIC_ENABLE_WECHAT_LOGIN=true
WECHAT_APP_ID=wxd6dcbe4b80089742
WECHAT_APP_SECRET=<从微信公众平台获取的 AppSecret>
```

#### 5. 配置微信公众平台

- **网页授权域名**：设置与开发 → 公众号设置 → 功能设置 → `capture.meetmind.online`
- **JS 安全域名**：同上 → `capture.meetmind.online`
- 需要下载验证文件放到 `public/` 目录下

#### 6. 重新构建部署

```bash
cd /mnt/meetmind-capture-v1-server-handoff
pkill -f 'node server.js'
NODE_OPTIONS="--max-old-space-size=1024" npm run build
NODE_ENV=production nohup node server.js > /tmp/meetmind-server.log 2>&1 &
```

---

## 已知问题和注意事项

1. **session 存在内存 Map 中**：`wechat-web-session-service.ts` 使用内存 Map + TTL 清理。单进程部署没问题，多实例需要迁移到 Redis。

2. **wechat-auth-service.ts 的潜在 bug**：已绑定用户重新登录时调用 `authService.login({ password: '' })`，密码验证会失败。新的 `/api/wechat/bind/callback` 和 `/wechat/open/[token]` 已用 `loginWithCode` / `createSessionForUserId` 方式绕过此问题，但原来的 `/api/auth/wechat/callback` 仍有此 bug。

3. **UserAnalytics 表缺失**：日志中会出现 `P2025` 错误（analytics 表缺记录），不影响核心功能。如需修复：`npx prisma db push --accept-data-loss`。

4. **构建内存限制**：服务器只有 3.5GB 内存，构建时需要加 `NODE_OPTIONS="--max-old-space-size=1024"`。

5. **nginx 反代下的 URL 构建**：所有服务端路由中构建重定向 URL 时，必须使用 `x-forwarded-host` + `x-forwarded-proto` 头，不能用 `request.url`（会变成 `localhost:3002`）。

---

## 关键文件清单

```
src/
├── app/
│   ├── (main)/app/page.tsx               # ★ 主应用页面（收集流渲染，~7300行）
│   ├── api/
│   │   ├── auth/
│   │   │   ├── wechat/
│   │   │   │   ├── route.ts              # 通用微信登录 API
│   │   │   │   └── callback/route.ts     # 通用微信回调（已改用共享 session）
│   │   │   ├── login-with-code/route.ts  # 验证码登录（自动注册）
│   │   │   └── send-code/route.ts        # 发送验证码
│   │   └── wechat/
│   │       ├── mp/route.ts               # ★ 服务号消息推送入口（含链接分流）
│   │       ├── capture/[token]/route.ts  # capture 数据 API
│   │       └── bind/
│   │           ├── route.ts              # 绑定 API（密码/验证码模式）
│   │           └── callback/route.ts     # ★ OAuth 回调（已改用共享 session + 直跳主流）
│   └── wechat/
│       ├── capture/[token]/
│       │   ├── page.tsx                  # H5 承接页 Server Component
│       │   └── WechatCaptureClient.tsx   # H5 承接页 Client Component
│       └── open/[token]/
│           └── route.ts                  # ★ 新建 — 已绑定用户直接打开入口
├── components/
│   └── WechatBindForm.tsx                # 绑定表单（微信登录 + 验证码 + 密码）
├── lib/
│   ├── hooks/
│   │   └── useAuth.tsx                   # 前端认证（handleWechatSession 消费 session 参数）
│   └── services/
│       ├── auth-service.ts               # ★ 认证核心（新增 createSessionForUserId）
│       ├── wechat-auth-service.ts        # 微信 OAuth 核心
│       ├── wechat-mp-service.ts          # 服务号消息处理
│       ├── wechat-inbox-service.ts       # ★ 收集流智能处理（角色统一为 primary）
│       ├── wechat-web-session-service.ts # ★ 新建 — 共享 Web 会话服务
│       ├── workspace-service.ts          # workspace 绑定/同步
│       └── workspace-context-service.ts  # capture/echo 同步
└── middleware.ts                         # ★ 路由鉴权（新增 /wechat/open/*）
```

---

## 数据库关键表

- `User` — 用户账户
- `AuthProvider` — 第三方登录绑定（provider='wechat', providerId=openId）
- `Workspace` / `WorkspaceMembership` — 用户工作区
- `WorkspaceCapture` — 收集流条目（sourceType='wechat' 标识微信来源）
- `WorkspaceEcho` — echo 卡片
- `WechatInboxMessage` — 微信收到的原始消息（含 bindingStatus, linkToken, userId）
