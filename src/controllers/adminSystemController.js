import os from 'node:os';
import { pool } from '../config/db.js';
import { env } from '../utils/env.js';
import { getRedisClient, isRedisAvailable, isRedisEnabled } from '../services/redis/redisClient.js';

async function checkDb() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return { ok: true, latency_ms: Date.now() - start };
}

async function checkRedis() {
  if (!isRedisEnabled()) return { ok: true, enabled: false };
  const client = await getRedisClient();
  if (!client) return { ok: false, enabled: true };
  const start = Date.now();
  await client.ping();
  return { ok: isRedisAvailable(), enabled: true, latency_ms: Date.now() - start };
}

function checkWorker() {
  const last = globalThis.__worker_last_heartbeat ?? null;
  const ok = !last ? true : Date.now() - last < 60_000;
  return { ok, last_heartbeat_ms_ago: last ? Date.now() - last : null };
}

async function getQueueSnapshot() {
  // Email outbox (in-process worker)
  const [[pending]] = await pool.query(`SELECT COUNT(*) AS cnt FROM email_outbox WHERE status = 'pending'`);
  const [[failed]] = await pool.query(`SELECT COUNT(*) AS cnt FROM email_outbox WHERE status = 'failed'`);
  return { email_outbox: { pending: Number(pending?.cnt ?? 0), failed: Number(failed?.cnt ?? 0) } };
}

async function getCommerceSnapshot() {
  // Keep it lightweight: last 24h payment failures from orders table.
  const [[row]] = await pool.query(
    `SELECT
        SUM(status = 'paid' OR status = 'fulfilled') AS paid,
        SUM(status = 'pending') AS pending,
        SUM(status = 'failed') AS failed,
        SUM(status = 'refunded') AS refunded
       FROM orders
      WHERE created_at >= (NOW() - INTERVAL 24 HOUR)`,
  );
  return {
    orders_last_24h: {
      paid: Number(row?.paid ?? 0),
      pending: Number(row?.pending ?? 0),
      failed: Number(row?.failed ?? 0),
      refunded: Number(row?.refunded ?? 0),
    },
  };
}

export async function adminSystemHealth(_req, res, next) {
  try {
    const [db, redis] = await Promise.allSettled([checkDb(), checkRedis()]);
    const dbRes = db.status === 'fulfilled' ? db.value : { ok: false, error: db.reason?.message ?? String(db.reason) };
    const redisRes =
      redis.status === 'fulfilled' ? redis.value : { ok: false, enabled: isRedisEnabled(), error: redis.reason?.message ?? String(redis.reason) };
    const worker = checkWorker();
    const ok = !!dbRes.ok && !!worker.ok && (redisRes.enabled ? !!redisRes.ok : true);
    return res.json({
      ok,
      checks: { db: dbRes, redis: redisRes, worker },
      env: { node_env: env.NODE_ENV, worker_enabled: Boolean(env.WORKER_ENABLED), redis_enabled: Boolean(env.REDIS_ENABLED) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function adminSystemMetrics(_req, res, next) {
  try {
    const [queue, commerce] = await Promise.allSettled([getQueueSnapshot(), getCommerceSnapshot()]);
    const mem = process.memoryUsage();
    const load = os.loadavg();
    return res.json({
      system: {
        uptime_s: process.uptime(),
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        loadavg: load,
      },
      queue: queue.status === 'fulfilled' ? queue.value : { error: queue.reason?.message ?? String(queue.reason) },
      commerce: commerce.status === 'fulfilled' ? commerce.value : { error: commerce.reason?.message ?? String(commerce.reason) },
    });
  } catch (err) {
    return next(err);
  }
}

