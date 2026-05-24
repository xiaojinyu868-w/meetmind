# MeetMind Desktop Companion

Octo Buddy 的电脑全局悬浮球原型。

## 运行

先确保 Web 服务已经通过 PM2 或 `make dev` 跑起来，然后执行：

```bash
npm run desktop:dev
```

如果本机还没有 Electron，脚本会通过 `npx --yes electron` 拉起。

## 当前能力

- 透明无边框窗口
- always-on-top，浮在电脑桌面上
- 章鱼本体可任意拖拽，不是卡片按钮；位置会保存，下次启动恢复
- 使用 `public/images/octo-buddy/*.png` 原始 IP 裁切素材，白色背景已算法透明化
- 待机生命周期：在旁边 → 轻回应 → 犯困 → 睡着
- 点击强度反馈：轻戳开心，二次亲近，连续戳惊讶，再戳生气；反应会自然回到待机
- 听课入口：切到 listening 状态
- 游戏陪伴入口：切到 game 状态，为后续 GameBridge / GameStrategy 预留
- 打开 MeetMind：跳转 `MEETMIND_URL`，默认 `http://localhost:3002/app`

## 设计原则

模型负责智能，状态机负责存在。

这不是聊天框入口，而是一个持续在场的桌面陪伴体。
