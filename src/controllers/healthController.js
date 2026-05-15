import os from 'node:os';
import { pool } from '../config/db.js';
import { env } from '../utils/env.js';
import { getRedisClient, isRedisAvailable, isRedisEnabled } from '../services/redis/redisClient.js';

export async function health(req, res) {
  res.json({ ok: true, service: 'love-and-flour-backend', env: env.NODE_ENV });
}

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
  // Current worker is in-process timers; we expose a best-effort heartbeat set by worker loops.
  const last = globalThis.__worker_last_heartbeat ?? null;
  const ok = !last ? true : Date.now() - last < 60_000;
  return { ok, last_heartbeat_ms_ago: last ? Date.now() - last : null };
}

async function checkOutbox() {
  const [[pending]] = await pool.query(`SELECT COUNT(*) AS cnt FROM email_outbox WHERE status = 'pending'`);
  const [[failed]] = await pool.query(`SELECT COUNT(*) AS cnt FROM email_outbox WHERE status = 'failed'`);
  return { ok: true, pending: Number(pending?.cnt ?? 0), failed: Number(failed?.cnt ?? 0) };
}

export async function deepHealth(req, res, next) {
  try {
    if (env.HEALTH_DEEP_TOKEN) {
      const token = String(req.headers['x-health-token'] ?? '');
      if (token !== env.HEALTH_DEEP_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    } else if (env.NODE_ENV === 'production') {
      return res.status(404).json({ ok: false });
    }

    const [db, redis, outbox] = await Promise.allSettled([checkDb(), checkRedis(), checkOutbox()]);
    const worker = checkWorker();

    const dbRes = db.status === 'fulfilled' ? db.value : { ok: false, error: db.reason?.message ?? String(db.reason) };
    const redisRes =
      redis.status === 'fulfilled' ? redis.value : { ok: false, error: redis.reason?.message ?? String(redis.reason) };
    const outboxRes =
      outbox.status === 'fulfilled' ? outbox.value : { ok: false, error: outbox.reason?.message ?? String(outbox.reason) };

    const mem = process.memoryUsage();
    const load = os.loadavg();

    const ok = !!dbRes.ok && !!worker.ok && (redisRes.enabled ? !!redisRes.ok : true) && !!outboxRes.ok;
    return res.json({
      ok,
      checks: { db: dbRes, redis: redisRes, worker, outbox: outboxRes },
      system: {
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        loadavg: load,
        uptime_s: process.uptime(),
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function live(_req, res) {
  // Liveness: process is up and able to respond.
  res.json({ ok: true });
}

export async function ready(_req, res) {
  // Readiness: dependencies are reachable.
  const [db, redis] = await Promise.allSettled([checkDb(), checkRedis()]);
  const dbRes = db.status === 'fulfilled' ? db.value : { ok: false };
  const redisRes = redis.status === 'fulfilled' ? redis.value : { ok: false, enabled: isRedisEnabled() };
  const ok = !!dbRes.ok && (redisRes.enabled ? !!redisRes.ok : true);
  res.status(ok ? 200 : 503).json({ ok, checks: { db: dbRes, redis: redisRes } });
}
