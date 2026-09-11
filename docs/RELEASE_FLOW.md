# 多人并行开发与上线流程（2026-09-11 起）

> 一份仓库历史，多个工作目录：**每个人（会话）一个 worktree + 一个分支**；**生产只从专用检出目录跑**，任何人的开发目录都不是运行目录。
> 这套流程解决的是 9 月 10 日撞出来的三类事故：`git add -A` 把别人已暂存的删除带进提交、`git stash` 撤走别人的工作文件、`make deploy` 把别人的半成品送上生产。

## 目录与分支

| 目录 | 分支 | 用途 |
|---|---|---|
| `/mnt/meetmind-prod` | `release/prod` | **生产运行目录**（PM2 cwd、`scripts/deploy.sh` 的 `PROJECT_DIR`）。只做 `git merge` / `make deploy`，**不在这里改代码** |
| `/mnt/meetmind-capture-v1-server-handoff` | `feat/settings-redesign` | teach 会话的开发目录（历史上也是生产目录，现在只是开发目录） |
| `/mnt/meetmind-product-polish` | `feat/product-polish` | 产品打磨 / 内容层 |
| `/mnt/meetmind-reliability` | `feat/reliability` | 课堂线可靠性 |
| `/mnt/meetmind-zhihu` | `feat/zhihu-hackathon` | 知乎线（收藏夹开课）。**同时是一个独立试用实例的运行目录**：PM2 `meetmind-zhihu` @ 3012，nginx `zhihu.meetmind.online`，`make deploy-zhihu` 在这里旁路构建；与生产同库同数据目录，零 schema 改动。是否合进 `release/prod` 由产品负责人试用后决定（`docs/plans/2026-09-12-zhihu-line.md`） |

数据不在版本库里，目前仍放在 `/mnt/meetmind-capture-v1-server-handoff/`（`prisma/meetmind.db`、`public/uploads`、`public/downloads`、`public/wechat-media`、`data/`），生产目录用软链指过去；`.env` 里 `DATABASE_URL` 用**绝对路径**，`src/lib/prisma.ts` 读它（此前只按 cwd 找库，换目录会静默新建空库）。**下一步维护窗口把这些数据迁到 `/mnt/meetmind-data` 并双向软链**，让数据也不住在任何人的开发目录里。

新开一条线：

```bash
cd /mnt/meetmind-prod
git worktree add /mnt/meetmind-<线名> -b feat/<线名> release/prod
cd /mnt/meetmind-<线名>
ln -s /mnt/meetmind-capture-v1-server-handoff/node_modules node_modules   # 同一 Node 24，原生模块可复用
cp /mnt/meetmind-prod/.env .env                                             # DATABASE_URL 已是绝对路径
PORT=31xx NEXT_DEV_DIST_DIR=.next-dev-<线名> make dev                        # 端口与 dist 目录各自独立
```

## 独立子域名试用实例（2026-09-12 起，知乎线首用）

一条线想先给人试用、再决定合不合：不合进 `release/prod`，而是**把它的 worktree 当作第二个运行目录**——
`ecosystem.config.js` 加一个 app（cwd 指向该 worktree、独立端口）、`scripts/deploy.sh` 用 `MEETMIND_PROD_DIR / MEETMIND_APP_NAME / MEETMIND_PORT`
三个变量一起指过去（有 `make deploy-zhihu` 作样板）、nginx 一个子域名 server 块（模板 `ops/nginx/`）、certbot 签证书。
约束：该分支**不能有 schema 改动**（共库）；`.env` 是生产副本加本线独有变量；`data/` `public/uploads` 等软链同生产；`make deploy-xxx` 前同样看 `free -m`。
试用结束要么合进 `release/prod` 并 `pm2 delete` 这个实例，要么整体下线——不要让试用实例长期与生产各跑一版。

## 日常开发的三条铁律

1. **只提交自己的文件**：`git add <路径>` / `git commit -- <路径>`；禁止 `git add -A`、`git commit -a`。
2. **不在别人的目录里执行任何 git 命令**；自己的目录里也不 `git stash`、不切分支（一个 worktree 一个分支，不需要切）。
3. **不在开发目录里 `make deploy`**——`deploy.sh` 现在固定在 `/mnt/meetmind-prod` 构建，你在哪个目录敲都一样，但先合并到 `release/prod` 才会带上你的改动。

## 上线（谁都可以做，步骤固定）

```bash
# 1. 特性分支已推送、make check 全绿、DOMAIN / CHANGELOG 已同步
git push origin feat/<线名>

# 2. 合进 release/prod（在生产目录里合，它永远是干净的）
cd /mnt/meetmind-prod
git fetch origin
git merge --no-edit origin/feat/<线名>          # 冲突只可能在 CHANGELOG / DOMAIN 这类"各自顶部追加"的文件：两边都保留
git push origin release/prod

# 3. 构建 + 原子切换 + 重载 + 健康检查（失败自动回滚）
make deploy                                       # = tsc → .next-staging 旁路构建 → mv 切换 → pm2 reload → /api/health + 静态 chunk 抽样

# 4. 看一眼
pm2 describe meetmind | grep -E "exec cwd|uptime"   # exec cwd 必须是 /mnt/meetmind-prod
curl -s http://127.0.0.1:3002/api/health
```

改了 `server.js` / `server/`（ASR 代理等非 Next 代码）时 `pm2 reload` 已足够：进程从 `/mnt/meetmind-prod/server.js` 启动。改了 `ecosystem.config.js` 才需要 `pm2 delete meetmind && pm2 start ecosystem.config.js --only meetmind`（PM2 的 reload 不更新 cwd）。

**回滚**：`deploy.sh` 健康检查失败会自动把 `.next-previous` 换回来；人工回滚 `cd /mnt/meetmind-prod && mv .next .next-failed && mv .next-previous .next && pm2 reload meetmind`。要回到某个提交：`git checkout <sha> -- .`（不要 reset 已推送的 release/prod）再 `make deploy`。

## 把 release/prod 的变化拿回自己的分支

生产上的运维改动（`ecosystem.config.js`、`deploy.sh`、`prisma.ts`）和别人合进去的东西，隔一段时间同步一次：

```bash
cd /mnt/meetmind-<线名>
git fetch origin && git merge --no-edit origin/release/prod
```

## 机器资源

内存 15GB：一个 `next dev` 常驻 4–6GB，`make build` 峰值 ~7GB。同一时刻**最多两个 dev**，`make deploy` 前 `free -m` 看可用 ≥ 8GB；不要两个人同时 build。
