import { pool } from '../config/db.js';

function safeJson(obj) {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return '{}';
  }
}

export async function trackEvent({ userId = null, eventType, entityType = null, entityId = null, metadata = null }) {
  await pool.query(
    `INSERT INTO analytics_events (user_id, event_type, entity_type, entity_id, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, eventType, entityType, entityId, metadata ? safeJson(metadata) : null],
  );
}

