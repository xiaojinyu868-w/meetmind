# Desktop — MeetMind 桌面采集壳 v2（Octo Buddy）

> v2 = 桌宠悬浮球（v1 保留）+ 内嵌主窗口（MeetMind 网页跑在壳内）+ 全局热键截图收集。
> Web 端仍由 Next.js / PM2 提供，桌面端只做壳：登录态承载、系统内录授权、截图进收集线。

## 依赖规则

```
desktop/ → Electron runtime + public/images/octo-buddy/*
desktop/ → 壳内 BrowserWindow 加载 MEETMIND_URL（默认 https://capture.meetmind.online/app）
desktop/ → HTTP 调用 {origin}/api/workspace/upload-image + /api/workspace/captures
```

- ✅ 界面素材一律走 `desktop/assets/`（从 `public/images/octo-buddy/` 用 sharp 复制/缩放而来）——安装包只打 desktop/，直接引用外部素材会在打包后丢图
- ✅ 可以通过壳内主窗口读网页 localStorage 的 `meetmind_access_token`，带 Bearer 调收集线 API
- ❌ 不直接 import `src/` 代码，避免桌面端和 Web 构建耦合
- ❌ 不直接连业务数据库；与服务端的交互只走公开 HTTP API

## 文件索引

| 文件 | 职责 |
|------|------|
| `main.js` | 主进程入口：单实例锁（重复启动只唤起主窗口）、应用菜单（编辑 role 保 Cmd/Ctrl+C/V）、Chromium 启动参数（macOS loopback / 免录屏选择器）、悬浮球窗口、托盘与两个能力模块的接线、IPC（含 `pet:toggle-listen` 旁听驱动网页 Recorder、`pet:menu` 右键最小菜单、截图成功向宠物推 `pet:gulp`） |
| `shell-window.js` | 内嵌主窗口（关闭即隐藏常驻 + 尺寸位置持久化）+ `setDisplayMediaRequestHandler` 免弹窗授予「主屏 + loopback 系统音频」+ 安全策略（权限最小化 / 站外导航与 target=_blank 交系统浏览器）+ 断网兜底页 + 系统托盘（版本、热键说明、开机自启开关） |
| `screenshot.js` | 全局热键 `Ctrl/Cmd+Shift+M`：**录制感知分流**——壳内正在录屏类课时先调网页 `__meetmindCaptureFrame` 钩子把当前帧挂到课堂时间轴；不在录才走收集线截图（截鼠标所在屏 → upload-image → captures）；失败重试一次（2s），仍失败暂存 `userData/pending-shots/`，启动时补传一次；`captureOnce` 同时供小窗按钮复用；成功时调 `deps.onCaptured` 触发宠物吞食动画 |
| `quick-panel.js` | v3 桌面小窗：无边框透明窗加载 Web 端 `/companion` 面板（随手记/随口问/截图），失焦自动收起；与主窗口共用 `persist:meetmind` partition 共享登录态；全局热键 `Cmd/Ctrl+Shift+K` 随时唤起 |
| `updater.js` | 自动更新检查：启动 20s 首查 + 每 4h 查 GitHub Releases 的 desktop-v* tag，新版本安静通知一次，点击打开对应平台安装包（零依赖，未签名包友好；macOS 有签名后可换 electron-updater） |
| `panel-preload.js` | 小窗安全桥：注入 `window.meetmindDesktop`（captureScreen / showMain / hidePanel）；浏览器打开 `/companion` 时无此对象，壳能力按钮自动隐藏 |
| `preload.js` | 悬浮球安全 IPC：展开窗口、拖动窗口、显示主窗口、toggle 小窗、`toggleListen`（旁听）、`showPetMenu`（右键菜单）、`onGulp`（吞食动画）、退出 |
| `companion.html` | 桌宠 DOM：全尺寸 canvas + 说话气泡（无按钮面板——交互即姿态） |
| `companion.css` | 桌宠视觉：透明窗 + 气泡样式（角色渲染全在 canvas） |
| `companion.js` | **参数化宠物**（v3）：canvas 渲染精灵图，原画 100% 保留，生命感全部来自连续参数——呼吸振荡 / 随机眨眼（sprite-map 眼位 + 同色眼皮遮罩）/ 眼随光标倾身 / 拖拽果冻物理 / 旁听声波涟漪 / 睡眠与深夜压暗；单击随手问（小窗）、双击旁听、右键最小菜单 |
| `offline.html` | 断网兜底页（主窗口 loadURL 失败时加载，带「重新连接」） |
| `assets/octo/*.png` | Octo Buddy 精灵图（从 `public/images/octo-buddy/` 复制——安装包只打 desktop/，外部素材必须进 assets） |
| `assets/octo/octo-sprite-map.json` | 精灵图算法分解产物（`scripts/octo-sprite-map.js` 生成）：body 包围盒、眼位、眼皮同色采样——参数化动画的锚点，闭眼态（excited/sleeping）从 idle 按比例映射 |
| `assets/tray-icon.png` / `assets/tray-iconTemplate.png` | 托盘图标 18x18（Win/Linux）与 macOS Template 22x22（sharp 生成） |
| `build/icon.png` | 安装包图标 512x512（sharp 从 original.png 生成；icns/ico 由 electron-builder 自动转） |
| `package.json` | two-package 结构的 app 清单（electron-builder 以 desktop/ 为 app 目录） |

## 运行

```bash
npm run desktop:dev    # MEETMIND_URL=http://localhost:3002/app（本地调试）
npm run desktop        # 默认 MEETMIND_URL=https://capture.meetmind.online/app
```

## 打包分发（electron-builder）

用户拿到的是安装包，不是 `npm run desktop`。配置在仓库根 `electron-builder.yml`
（two-package 结构：`desktop/package.json` 是独立 app 目录，运行时零 npm 依赖，
安装包只有 Electron 运行时 + 本目录文件，不打 Web 端 node_modules）。

```bash
npm run desktop:pack         # 冒烟打包（desktop-dist/ 下免安装目录，验证配置用）
npm run desktop:dist:mac     # 产出 .dmg（arm64+x64）——必须在 macOS 上跑
npm run desktop:dist:win     # 产出 .exe（NSIS x64）——Windows 或装 wine 的 Linux
npm run desktop:dist:linux   # 产出 .AppImage
```

**推荐走 CI**：`.github/workflows/desktop-release.yml`——手动 dispatch 或打
`desktop-v*` tag，macos-latest 出 dmg、windows-latest 出 nsis，产物上 artifacts；
tag 触发时自动建 GitHub Release。未配置签名证书：mac 首次「右键→打开」，
win SmartScreen「更多信息→仍要运行」；买到证书后在仓库 Secrets 注入
`CSC_LINK` / `CSC_KEY_PASSWORD` 即自动签名。

> ⚠️ 已知风险（2026-07 确认）：仓库主账号因 GitHub 贸易管制无法添加支付方式，
> 账户被 billing lock，GitHub-hosted runner 的 job 会被零步骤拒绝
> （"account is locked due to a billing issue"）。CI 不可用时的备选：
> **任意一台 Mac 可同时出 mac + win 两个包**（electron-builder 自带 wine）：
> `npm run desktop:dist:mac && npm run desktop:dist:win`，
> 产物手动传到 GitHub Release（文件名必须与 electron-builder.yml 的
> artifactName 一致，landing 下载链接按稳定文件名配置）。

本机打包若卡在下 binaries（GitHub 直连超时），用 npmmirror 镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
npm run desktop:pack
```

**发布流程（每次发桌面新版）**：
1. 改 `desktop/package.json` 的 `version`（语义化）
2. 提交后打同名 tag：`git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`
3. CI 或本地 Mac 构建（`desktop:dist:mac` + `desktop:dist:win`），产物传 Release
4. 老用户靠 `updater.js` 自动收到新版本提示（每个版本只提示一次）
5. landing 下载区按稳定文件名自动指向最新 Release，无需改动

**Landing 下载区**：`src/lib/config/desktop-download.config.ts` 的
`DESKTOP_DOWNLOAD.enabled` 是总开关（默认 false，不给半成品入口）；首个
Release 发布后翻 true 即在 landing page 出现 macOS / Windows 下载卡。
下载 URL 用稳定文件名，发新版不用改前端。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `MEETMIND_URL` | `https://capture.meetmind.online/app` | 壳内主窗口加载地址；origin 同时决定截图上传 API 的目标站点 |

## 全局热键

| 热键 | 行为 |
|------|------|
| `Ctrl/Cmd + Shift + M` | 截取鼠标所在屏 → 收进 MeetMind 收集线（未登录则提示并打开主窗口） |

## v2 架构说明

- **登录态**：用户在壳内主窗口里走网页自己的登录（邮箱验证码 / 微信扫码），token 落在该窗口 localStorage `meetmind_access_token`；截图上传时主进程用 `executeJavaScript` 读取，带 `Authorization: Bearer` 调 API。
- **系统内录**：`shell-window.js` 在主窗口 session 上注册 `setDisplayMediaRequestHandler`，网页内 `getDisplayMedia` 直接获得主屏视频轨 + `loopback` 音频轨，不弹系统选择器；macOS 依赖 `main.js` 里的 `MacLoopbackAudioForScreenShare` 启动参数。
- **常驻**：主窗口关闭即隐藏，`window-all-closed` 不退出；真正退出走托盘菜单或悬浮球退出（置 `app.isQuitting` 放行 close 拦截）。
- **降级**：热键注册失败 / 通知服务不可用 / 托盘不可用都只 log 不 crash；截图上传失败重试一次后落盘 `pending-shots/`，下次启动补传。

## 设计原则

- 行为让它在那里：无人互动也会呼吸、犯困、睡着
- 情绪让它有反应：点击强度会从开心、惊讶到生气
- 场景让它和用户一起：听课入口进壳内主窗口；截图收集让桌面任何画面都能随手发给 MeetMind
