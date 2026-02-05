# MeetMind 香港服务器部署指南

## 📋 项目信息

- **GitHub 仓库**: `git@github.com:xiaojinyu868-w/meetmind.git`
- **分支**: `feature/onboarding-improvements`
- **技术栈**: Next.js 15 + Prisma (SQLite) + WebSocket + Node.js
- **域名**: `meetmind.online`

---

## 🚀 部署步骤

### 第一步：系统环境准备

```bash
# 更新系统
apt update && apt upgrade -y

# 安装必要工具
apt install -y curl git nginx certbot python3-certbot-nginx

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 验证安装
node -v  # 应显示 v20.x.x
npm -v   # 应显示 10.x.x
```

### 第二步：克隆项目

```bash
# 创建项目目录
mkdir -p /mnt && cd /mnt

# 克隆仓库（需要先配置 SSH key 或使用 HTTPS）
# SSH 方式（推荐）：
git clone git@github.com:xiaojinyu868-w/meetmind.git

# 或 HTTPS 方式：
# git clone https://github.com/xiaojinyu868-w/meetmind.git

# 进入项目目录
cd meetmind

# 切换到正确分支
git checkout feature/onboarding-improvements
```

### 第三步：配置环境变量

```bash
# 创建 .env 文件
cat > /mnt/meetmind/.env << 'EOF'
# MeetMind 环境配置

# ===== 阿里云百炼 API =====
DASHSCOPE_API_KEY=<从原服务器.env复制>
LLM_MODEL=qwen3-max
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 实时语音识别
DASHSCOPE_ASR_WS_MODEL=qwen3-asr-flash-realtime
DASHSCOPE_ASR_WS_SR=16000

# 离线语音转录（公网访问配置）
# 注意：需要替换为香港服务器的公网 IP
PUBLIC_HOST=<香港服务器IP>:3001
PUBLIC_PROTOCOL=http

# Turbo 模式
PUBLIC_DOMAIN=meetmind.online

# ===== 其他 LLM 提供商（可选）=====
GOOGLE_API_KEY=<从原服务器.env复制>
OPENAI_API_KEY=<从原服务器.env复制>

# ===== 认证配置 =====
JWT_SECRET=<从原服务器.env复制>
JWT_EXPIRES_IN=7200
JWT_REFRESH_EXPIRES_IN=604800

# ===== 邮箱验证码服务 =====
SMTP_HOST=smtp.exmail.qq.com
SMTP_PORT=465
SMTP_USER=<从原服务器.env复制>
SMTP_PASS=<从原服务器.env复制>

# ===== 数据库 =====
DATABASE_URL="file:./prisma/meetmind.db"
EOF

# 重要：替换 PUBLIC_HOST 为实际的香港服务器公网 IP
# 例如服务器 IP 是 1.2.3.4，则修改为：
# sed -i 's/<香港服务器IP>/1.2.3.4/g' /mnt/meetmind/.env
```

### 第四步：安装依赖并构建

```bash
cd /mnt/meetmind

# 安装依赖
npm install

# 生成 Prisma 客户端
npx prisma generate

# 初始化数据库（首次部署）
npx prisma db push

# 构建生产版本
npm run build
```

### 第五步：配置 Nginx

```bash
# 创建 Nginx 配置
cat > /etc/nginx/conf.d/meetmind.conf << 'EOF'
# HTTP -> HTTPS 重定向
server {
    listen 80;
    server_name meetmind.online www.meetmind.online;
    return 301 https://$server_name$request_uri;
}

# HTTPS 主配置
server {
    listen 443 ssl http2;
    server_name meetmind.online www.meetmind.online;

    # SSL 证书（稍后由 certbot 自动配置）
    ssl_certificate /etc/letsencrypt/live/meetmind.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meetmind.online/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 文件上传大小限制
    client_max_body_size 500M;

    # 代理到 Next.js
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # WebSocket 专用路径
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF
```

### 第六步：配置 SSL 证书

```bash
# 先临时启动 Nginx（无 SSL）用于域名验证
# 临时修改配置，注释掉 SSL 相关行
cat > /etc/nginx/conf.d/meetmind-temp.conf << 'EOF'
server {
    listen 80;
    server_name meetmind.online www.meetmind.online;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
EOF

# 删除正式配置
rm -f /etc/nginx/conf.d/meetmind.conf

# 重启 Nginx
nginx -t && systemctl restart nginx

# 申请 SSL 证书
certbot --nginx -d meetmind.online -d www.meetmind.online --non-interactive --agree-tos --email originedu@meetmind.online

# 证书申请成功后，恢复正式配置
rm -f /etc/nginx/conf.d/meetmind-temp.conf

# 重新创建正式配置（包含 SSL）
cat > /etc/nginx/conf.d/meetmind.conf << 'EOF'
server {
    listen 80;
    server_name meetmind.online www.meetmind.online;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name meetmind.online www.meetmind.online;

    ssl_certificate /etc/letsencrypt/live/meetmind.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meetmind.online/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

# 重启 Nginx
nginx -t && systemctl restart nginx
```

### 第七步：配置 Systemd 服务（保持后台运行）

```bash
# 创建 systemd 服务文件
cat > /etc/systemd/system/meetmind.service << 'EOF'
[Unit]
Description=MeetMind Next.js Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/mnt/meetmind
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

# 日志
StandardOutput=append:/var/log/meetmind.log
StandardError=append:/var/log/meetmind-error.log

[Install]
WantedBy=multi-user.target
EOF

# 重新加载 systemd
systemctl daemon-reload

# 启用并启动服务
systemctl enable meetmind
systemctl start meetmind

# 检查状态
systemctl status meetmind
```

### 第八步：修改域名解析

**在域名服务商后台（如阿里云）修改 DNS 解析：**

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | @ | <香港服务器IP> | 600 |
| A | www | <香港服务器IP> | 600 |

---

## ✅ 验证部署

```bash
# 1. 检查服务状态
systemctl status meetmind

# 2. 检查端口监听
ss -tlnp | grep -E "80|443|3001"

# 3. 检查内存占用
ps aux | grep "node server.js" | grep -v grep

# 4. 测试本地访问
curl -s http://localhost:3001/ | head -5

# 5. 测试域名访问（等 DNS 生效后）
curl -I https://meetmind.online
```

---

## 📝 常用命令

```bash
# 查看日志
tail -f /var/log/meetmind.log

# 重启服务
systemctl restart meetmind

# 停止服务
systemctl stop meetmind

# 更新代码
cd /mnt/meetmind
git pull origin feature/onboarding-improvements
npm install
npm run build
systemctl restart meetmind
```

---

## ⚠️ 注意事项

1. **域名解析**：修改 DNS 后需要等待 5-30 分钟生效
2. **SSL 证书**：Let's Encrypt 证书 90 天过期，certbot 会自动续期
3. **数据库**：SQLite 数据库文件在 `/mnt/meetmind/prisma/meetmind.db`
4. **内存**：生产模式内存占用约 100-200MB

---

## 🔧 故障排查

```bash
# 服务启动失败
journalctl -u meetmind -n 50

# Nginx 配置错误
nginx -t

# 端口被占用
lsof -i :3001

# 查看系统资源
free -h && df -h
```
