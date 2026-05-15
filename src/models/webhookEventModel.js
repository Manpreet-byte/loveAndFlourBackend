import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function insertWebhookEvent(
  { provider, eventId = null, eventHash, eventType = null, payloadJson },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT IGNORE INTO webhook_events
      (provider, event_id, event_hash, event_type, payload_json, status)
     VALUES (?, ?, ?, ?, ?, 'received')`,
    [provider, eventId, eventHash, eventType, payloadJson],
  );
  return result.affectedRows === 1;
}

export async function markWebhookProcessed({ provider, eventHash, status = 'processed', errorMessage = null }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE webhook_events
        SET status = ?, processed_at = NOW(), error_message = ?
      WHERE provider = ? AND event_hash = ?`,
    [status, errorMessage, provider, eventHash],
  );
}

