'use strict';

function resolveServerHost({ dev, configuredHost }) {
  if (configuredHost?.trim()) return configuredHost.trim();
  return dev ? '0.0.0.0' : '127.0.0.1';
}

function installGracefulShutdown({
  server,
  webSocketServers = [],
  processRef = process,
  exit = process.exit.bind(process),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  timeoutMs = 25_000,
  logger = console,
}) {
  let shuttingDown = false;

  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`[Server] Graceful shutdown started (${reason})`);

    let completed = false;
    let closeFailed = false;
    let pendingClosures = webSocketServers.length + 1;
    const forceExitTimer = setTimeoutFn(() => {
      if (completed) return;
      completed = true;
      logger.error('[Server] Graceful shutdown timed out');
      exit(1);
    }, timeoutMs);
    forceExitTimer?.unref?.();

    const finishClose = (label, error) => {
      if (completed) return;
      if (error) {
        closeFailed = true;
        logger.error(`[Server] ${label} close failed:`, error);
      }
      pendingClosures -= 1;
      if (pendingClosures > 0) return;

      completed = true;
      clearTimeoutFn(forceExitTimer);
      if (closeFailed) {
        exit(1);
        return;
      }
      logger.log('[Server] Graceful shutdown completed');
      exit(0);
    };

    for (const webSocketServer of webSocketServers) {
      for (const client of webSocketServer.clients || []) {
        try {
          client.close(1012, 'Service restarting');
        } catch {
          // Continue draining other connections.
        }
      }
      try {
        webSocketServer.close((error) => finishClose('WebSocket server', error));
      } catch {
        // A WebSocket server that never accepted a connection is already drained.
        finishClose('WebSocket server');
      }
    }

    try {
      server.close((error) => finishClose('HTTP server', error));
    } catch (error) {
      finishClose('HTTP server', error);
    }
  };

  processRef.once('SIGTERM', () => shutdown('SIGTERM'));
  processRef.once('SIGINT', () => shutdown('SIGINT'));
  processRef.on('message', (message) => {
    if (message === 'shutdown') shutdown('PM2');
  });

  return shutdown;
}

module.exports = { installGracefulShutdown, resolveServerHost };
