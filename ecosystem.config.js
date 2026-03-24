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
      max_memory_restart: '1G',     // Auto-restart if memory exceeds 1GB

      // Logs
      error_file: '/root/.pm2/logs/meetmind-error.log',
      out_file: '/root/.pm2/logs/meetmind-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Graceful restart
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Restart strategy on crash loop
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
    },
  ],
};
