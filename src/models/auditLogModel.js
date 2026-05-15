import { pool } from '../config/db.js';

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function listAuditLogs({
  actorId = null,
  actorType = null,
  actionType = null,
  entityType = null,
  from = null,
  to = null,
  page = 1,
  limit = 50,
} = {}) {
  const safeLimit = clampInt(limit, { min: 1, max: 100, fallback: 50 });
  const safePage = clampInt(page, { min: 1, max: 10000, fallback: 1 });
  const offset = (safePage - 1) * safeLimit;

  const where = [];
  const params = [];

  if (actorType) {
    where.push('actor_type = ?');
    params.push(actorType);
  }
  if (actorId) {
    where.push('actor_id = ?');
    params.push(Number(actorId));
  }
  if (actionType) {
    where.push('action_type = ?');
    params.push(actionType);
  }
  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(to);
  }

  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT id, actor_type, actor_id, action_type, entity_type, entity_id, metadata_json,
            ip_address, user_agent, method, path, status_code, created_at
       FROM audit_logs
       ${sqlWhere}
   ORDER BY id DESC
      LIMIT ?
     OFFSET ?`,
    [...params, safeLimit, offset],
  );

  return { page: safePage, limit: safeLimit, logs: rows };
}

