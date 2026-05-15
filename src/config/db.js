import mysql from 'mysql2/promise';
import { env } from '../utils/env.js';
import { dbQueryDurationMs } from '../services/metricsService.js';
import { logger } from '../utils/logger.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
});

// Lightweight query timing instrumentation (no SQL text logging).
const originalQuery = pool.query.bind(pool);
pool.query = async (...args) => {
  const start = process.hrtime.bigint();
  try {
    const result = await originalQuery(...args);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    dbQueryDurationMs.observe({ ok: 'true' }, ms);
    if (ms >= env.SLOW_QUERY_MS) {
      const sql = typeof args?.[0] === 'string' ? args[0] : '';
      const op = sql ? String(sql).trim().split(/\s+/)[0]?.toUpperCase() : 'QUERY';
      logger.warn({ ms, op }, 'slow_query');
    }
    return result;
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    dbQueryDurationMs.observe({ ok: 'false' }, ms);
    if (ms >= env.SLOW_QUERY_MS) {
      const sql = typeof args?.[0] === 'string' ? args[0] : '';
      const op = sql ? String(sql).trim().split(/\s+/)[0]?.toUpperCase() : 'QUERY';
      logger.warn({ ms, op, err: { message: err?.message, code: err?.code } }, 'slow_query_error');
    }
    throw err;
  }
};
