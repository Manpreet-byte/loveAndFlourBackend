import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createNotification(
  { userId = null, type, eventType, eventId, title, message, metadataJson = null },
  { conn } = {},
) {
  const db = pickConn(conn);
  await db.query(
    `INSERT IGNORE INTO notifications
      (user_id, type, event_type, event_id, title, message, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [userId, type, eventType, eventId, title, message, metadataJson],
  );
}

export async function listPendingNotifications({ type = 'email', limit = 25 }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, user_id, type, event_type, event_id, title, message, metadata_json, attempts
       FROM notifications
      WHERE type = ? AND status = 'pending'
   ORDER BY id ASC
      LIMIT ?`,
    [type, limit],
  );
  return rows;
}

export async function markNotificationSent({ id }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE notifications
        SET status = 'sent', sent_at = NOW()
      WHERE id = ?`,
    [id],
  );
}

export async function markNotificationFailed({ id, errorMessage }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE notifications
        SET status = 'failed', attempts = attempts + 1, last_error = ?
      WHERE id = ?`,
    [String(errorMessage ?? 'failed').slice(0, 255), id],
  );
}

