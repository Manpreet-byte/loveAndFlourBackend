import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../src/utils/env.js';
import { logger } from '../src/utils/logger.js';

function isMigrationFile(name) {
  if (!name.endsWith('.sql')) return false;
  if (name === 'schema.sql') return false;
  // Convention: YYYY-MM-DD_*.sql
  return /^\d{4}-\d{2}-\d{2}_.+\.sql$/.test(name);
}

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_schema_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function sha256Hex(buf) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('hex');
}

async function listMigrations(sqlDir) {
  const entries = await fs.readdir(sqlDir);
  return entries.filter(isMigrationFile).sort();
}

async function getApplied(conn) {
  const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations ORDER BY id ASC');
  const map = new Map();
  for (const r of rows) map.set(r.filename, r.checksum);
  return map;
}

async function applyMigration(conn, { filename, sql, checksum }) {
  logger.info({ filename }, 'migration_apply_start');
  await conn.beginTransaction();
  try {
    await conn.query(sql);
    await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [filename, checksum]);
    await conn.commit();
    logger.info({ filename }, 'migration_apply_ok');
  } catch (err) {
    await conn.rollback();
    logger.error({ filename, err }, 'migration_apply_failed');
    throw err;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sqlDir = path.resolve(process.cwd(), 'sql');

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  });

  try {
    await ensureMigrationsTable(conn);

    const files = await listMigrations(sqlDir);
    const applied = await getApplied(conn);

    const pending = [];
    for (const f of files) {
      const buf = await fs.readFile(path.join(sqlDir, f));
      const checksum = await sha256Hex(buf);
      if (!applied.has(f)) pending.push({ filename: f, buf, checksum });
      else if (applied.get(f) !== checksum) {
        const err = new Error(`Migration checksum mismatch for ${f}`);
        err.code = 'MIGRATION_CHECKSUM_MISMATCH';
        throw err;
      }
    }

    if (!pending.length) {
      logger.info({ dryRun }, 'migrations_up_to_date');
      return;
    }

    logger.info({ count: pending.length, dryRun, pending: pending.map((p) => p.filename) }, 'migrations_pending');
    if (dryRun) return;

    for (const m of pending) {
      // eslint-disable-next-line no-await-in-loop
      await applyMigration(conn, { filename: m.filename, sql: m.buf.toString('utf8'), checksum: m.checksum });
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'migrate_failed');
  process.exitCode = 1;
});

