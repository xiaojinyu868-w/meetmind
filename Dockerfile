FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

# 安装 Node.js 18
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user/app

# 复制 package 文件并安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制所有文件
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建 Next.js 应用
RUN npm run build

# 暴露端口 7860
EXPOSE 7860

# 启动应用
ENTRYPOINT ["python", "-u", "app.py"]
