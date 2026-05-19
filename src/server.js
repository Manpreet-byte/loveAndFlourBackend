import http from 'node:http';
import app from './app.js';
import { env } from './utils/env.js';
import { startWorker, stopWorker } from './jobs/worker.js';
import { logger } from './utils/logger.js';
import { pool } from './config/db.js';
import { getRedisClient, isRedisEnabled } from './services/redis/redisClient.js';
import {
  ensureAnalyticsTables,
  ensureAuthSupportTables,
  ensureCreatorCollaborationColumns,
  ensureCmsTables,
  ensureCommerceTables,
  ensureLmsCoreTables,
  ensureSupportTables,
  ensureUserExperienceTables,
  ensureUsersAuthColumns,
} from './utils/dbCompat.js';

const server = http.createServer(app);

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled_rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught_exception');
  // In production, crash fast and rely on the process manager to restart.
  if (env.NODE_ENV === 'production') process.exit(1);
});

server.on('error', (err) => {
  logger.error({ err }, 'server_error');

  if (err?.code === 'EADDRINUSE') {
    logger.error(
      `[backend] Port ${env.PORT} is already in use. Stop the other process using the port or change PORT in .env and restart.`,
    );
  } else if (err?.code === 'EACCES' || err?.code === 'EPERM') {
    logger.error(
      `[backend] Permission denied trying to listen on ${env.HOST}:${env.PORT}. Try a different PORT (e.g. 8081) or HOST=0.0.0.0.`,
    );
  }

  process.exitCode = 1;
});

async function preflight() {
  // Fail fast in production when critical dependencies are down.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxAttempts = env.NODE_ENV === 'production' ? 30 : 3; // ~1 minute in prod with backoff
  let connected = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query('SELECT 1');
      connected = true;
      break;
    } catch (err) {
      logger.warn({ err, attempt, maxAttempts }, 'preflight_db_connect_failed');
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(2000 * attempt, 5000));
    }
  }

  if (!connected) {
    const err = new Error('Database unavailable');
    logger.error({ err }, 'preflight_db_failed');
    if (env.NODE_ENV === 'production') throw err;
  } else {
    // Incremental compatibility checks for dev/staging DBs.
    try {
      await ensureUsersAuthColumns({ pool });
      await ensureCreatorCollaborationColumns({ pool });
      await ensureAuthSupportTables({ pool });
      await ensureCmsTables({ pool });
      await ensureSupportTables({ pool });
      await ensureCommerceTables({ pool });
      await ensureUserExperienceTables({ pool });
      await ensureLmsCoreTables({ pool });
      await ensureAnalyticsTables({ pool });
    } catch (err) {
      logger.error({ err }, 'preflight_db_compat_failed');
      if (env.NODE_ENV === 'production') throw err;
    }
  }

  if (isRedisEnabled()) {
    const client = await getRedisClient();
    if (!client) {
      const err = new Error('Redis unavailable');
      logger.error({ err }, 'preflight_redis_failed');
      if (env.NODE_ENV === 'production') throw err;
    } else {
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await client.ping();
          ok = true;
          break;
        } catch (err) {
          logger.warn({ err, attempt, maxAttempts }, 'preflight_redis_ping_failed');
          // eslint-disable-next-line no-await-in-loop
          await sleep(Math.min(1500 * attempt, 5000));
        }
      }
      if (!ok && env.NODE_ENV === 'production') throw new Error('Redis ping failed');
    }
  }
}

await preflight();

server.listen(env.PORT, env.HOST, () => {
  console.log(`Server running on port ${env.PORT}`);
  logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'listening');
});

if (env.WORKER_ENABLED) {
  try {
    startWorker();
  } catch (err) {
    logger.error({ err }, 'worker_start_failed');
  }
}

async function shutdown(signal) {
  logger.info({ signal }, 'shutdown_start');
  stopWorker();
  server.close(() => {
    logger.info({ signal }, 'http_server_closed');
  });

  try {
    await pool.end();
    logger.info({ signal }, 'mysql_pool_closed');
  } catch (err) {
    logger.warn({ err }, 'mysql_pool_close_failed');
  }

  if (isRedisEnabled()) {
    try {
      const client = await getRedisClient();
      await client?.quit();
      logger.info({ signal }, 'redis_closed');
    } catch (err) {
      logger.warn({ err }, 'redis_close_failed');
    }
  }

  // Allow ongoing requests to drain for a short period.
  setTimeout(() => {
    logger.info({ signal }, 'shutdown_exit');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
