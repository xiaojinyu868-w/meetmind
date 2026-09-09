/**
 * PM2 Ecosystem Configuration
 * https://pm2.keymetrics.io/docs/usage/application-declaration/
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart meetmind
 *   pm2 logs meetmind
 */
module.exports = {
  apps: [
    {
      name: 'meetmind',
      script: 'server.js',
      cwd: '/mnt/meetmind-capture-v1-server-handoff',
      interpreter: '/usr/local/bin/node',

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
      },

      // Process behavior
      instances: 1,
      exec_mode: 'fork',           // WebSocket requires fork mode
      autorestart: true,
      watch: false,                 // Don't watch in production
      max_memory_restart: '2G',     // Auto-restart if memory exceeds 2GB
      node_args: '--max-old-space-size=2048',  // V8 heap limit 2GB

      // Logs
      error_file: '/root/.pm2/logs/meetmind-error.log',
      out_file: '/root/.pm2/logs/meetmind-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Graceful restart
      kill_timeout: 30000,
      listen_timeout: 30000,
      shutdown_with_message: true,

      // Restart strategy on crash loop
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
    },
    {
      // 共享记忆（Hindsight）可靠投递 worker：与 Web 同 cwd / 同库 / 同 .env（worker.ts 自己加载 .env），
      // 把 ContextEvent 投给 Hindsight 并推进暂停 / 忘记的清理。Web 不依赖它在线（202 只表示本地接收）。
      // 部署：make deploy 只重载 meetmind；worker 单独 `pm2 startOrReload ecosystem.config.js --only meetmind-context-worker`
      name: 'meetmind-context-worker',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/lib/services/context/worker.ts',
      cwd: '/mnt/meetmind-capture-v1-server-handoff',
      interpreter: '/usr/local/bin/node',
      env: { NODE_ENV: 'production' },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/root/.pm2/logs/meetmind-context-worker-error.log',
      out_file: '/root/.pm2/logs/meetmind-context-worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 15000,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
    },
  ],
};
