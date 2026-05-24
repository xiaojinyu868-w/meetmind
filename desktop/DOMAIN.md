# Desktop — Octo Buddy 桌面陪伴端

> 电脑全局悬浮球原型。Web 端仍由 Next.js / PM2 提供，桌面端只负责 always-on-top 的陪伴入口与状态机。

## 依赖规则

```
desktop/ → Electron runtime + public/images/octo-buddy/*
desktop/ → 外部打开 MEETMIND_URL（默认 http://localhost:3002/app）
```

- ✅ 可以读取 `public/images/octo-buddy/*.png` 原始 IP 裁切素材
- ✅ 可以通过 `shell.openExternal` 打开 Web 版 MeetMind
- ❌ 不直接 import `src/` 代码，避免桌面端和 Web 构建耦合
- ❌ 不直接连业务数据库；状态同步后续通过本地 HTTP/WebSocket bridge 设计

## 文件索引

| 文件 | 职责 |
|------|------|
| `main.js` | Electron 主进程：透明无边框、always-on-top、位置持久化、可拖拽悬浮窗 |
| `preload.js` | 安全 IPC：展开窗口、拖动窗口、打开 MeetMind、退出 |
| `companion.html` | 桌面悬浮球 DOM 结构 |
| `companion.css` | 桌面悬浮球视觉：透明章鱼本体、漂浮/思考/生气/睡眠动画 |
| `companion.js` | 在场感状态机：待机生命周期、点击强度、任意拖动、听课/游戏入口 |

## 运行

```bash
npm run desktop:dev
```

脚本使用 `npx --yes electron desktop/main.js`，没有把 Electron 安装进项目依赖，避免当前 Web 服务部署变重。

## 设计原则

- 行为让它在那里：无人互动也会呼吸、犯困、睡着
- 情绪让它有反应：点击强度会从开心、惊讶到生气
- 场景让它和用户一起：听课 / 游戏入口先占位，后续接 GameBridge / GameStrategy
