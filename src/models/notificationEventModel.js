import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function claimNextEvents({ limit = 25 }, { conn } = {}) {
  const db = pickConn(conn);
  // Simple claiming strategy: claim events that are received and due (next_attempt_at null or <= now).
  const [rows] = await db.query(
    `SELECT id, event_id, event_type, payload_json, attempts
       FROM notification_events
      WHERE status = 'received'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
   ORDER BY id ASC
      LIMIT ?`,
    [limit],
  );
  return rows;
}

export async function markEventProcessed({ id }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE notification_events
        SET status = 'processed', processed_at = NOW()
      WHERE id = ?`,
    [id],
  );
}

export async function markEventFailed({ id, errorMessage, delayMinutes = 10 }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE notification_events
        SET status = 'received',
            attempts = attempts + 1,
            last_error = ?,
            next_attempt_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
      WHERE id = ?`,
    [String(errorMessage ?? 'failed').slice(0, 255), delayMinutes, id],
  );
}

