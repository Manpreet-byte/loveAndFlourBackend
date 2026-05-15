import crypto from 'node:crypto';
import { pool } from '../../config/db.js';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export async function emitEvent(eventType, payload, { idempotencyKey } = {}) {
  const key = idempotencyKey ? String(idempotencyKey) : sha256Hex(JSON.stringify(payload ?? {})).slice(0, 32);
  const eventId = sha256Hex(`${eventType}|${key}`);
  const payloadJson = JSON.stringify(payload ?? {});

  await pool.query(
    `INSERT IGNORE INTO notification_events (event_id, event_type, payload_json, status)
     VALUES (?, ?, ?, 'received')`,
    [eventId, eventType, payloadJson],
  );

  return { eventId };
}

