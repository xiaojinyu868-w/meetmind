module.exports = {
  apps: [
    {
      name: 'openclaw-gateway',
      script: '/usr/bin/openclaw',
      args: 'gateway run --port 4000',
      cwd: '/mnt/meetmind-capture-v1-server-handoff/openclaw',
      interpreter: 'none',
      env: {
        OPENCLAW_STATE_DIR: '/mnt/meetmind-capture-v1-server-handoff/openclaw/.state',
        NODE_COMPILE_CACHE: '/var/tmp/openclaw-compile-cache',
        OPENCLAW_NO_RESPAWN: '1',
      },
      max_memory_restart: '1G',
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
