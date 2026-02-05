# 香港服务器部署任务提示词

复制以下内容给香港服务器上的 Coding Agent：

---

## 任务：部署 MeetMind 项目到香港服务器

### 项目信息
- **GitHub 仓库**: `https://github.com/xiaojinyu868-w/meetmind.git`
- **分支**: `feature/onboarding-improvements`
- **域名**: `meetmind.online`
- **端口**: 3001

### 你需要完成的任务

1. **安装系统依赖**
   - Node.js 20.x
   - Nginx
   - Certbot（SSL 证书）

2. **克隆项目到 `/mnt/meetmind`**
   ```bash
   cd /mnt && git clone https://github.com/xiaojinyu868-w/meetmind.git
   cd meetmind && git checkout feature/onboarding-improvements
   ```

3. **创建 `.env` 配置文件**
   
   ⚠️ **重要**：环境变量包含敏感 API Key，不能放在 GitHub 上。
   
   **请从原服务器 `/mnt/meetmind/.env` 复制完整内容**，然后修改以下字段：
   - `PUBLIC_HOST=<香港服务器IP>:3001`（替换为新服务器的公网IP）
   
   ```bash
   # 在原服务器执行，查看 .env 内容
   cat /mnt/meetmind/.env
   
   # 在香港服务器创建 .env 文件
   nano /mnt/meetmind/.env
   # 粘贴内容，修改 PUBLIC_HOST 为新 IP
   ```

4. **安装依赖并构建**
   ```bash
   npm install
   npx prisma generate
   npx prisma db push
   npm run build
   ```

5. **配置 Nginx 反向代理**
   - 监听 80/443 端口
   - 代理到 `127.0.0.1:3001`
   - 支持 WebSocket（`/ws` 路径）
   - 配置 SSL（用 certbot）

6. **创建 systemd 服务**
   - 服务名：`meetmind`
   - 启动命令：`node server.js`
   - 设置 `NODE_ENV=production`
   - 开机自启

7. **申请 SSL 证书**
   ```bash
   certbot --nginx -d meetmind.online -d www.meetmind.online
   ```

8. **验证部署**
   - 确认 `curl http://localhost:3001/` 返回 HTML
   - 确认内存占用 < 300MB
   - 确认 Nginx 正常代理

### 完成标志
- 服务正常运行在 3001 端口
- `https://meetmind.online` 可访问（等 DNS 切换后）
- systemd 服务状态为 `active (running)`

### 参考
详细部署文档见仓库中的 `DEPLOY_HONGKONG.md`

---

**注意**：部署完成后，需要在域名服务商后台将 `meetmind.online` 的 A 记录指向香港服务器 IP。
