import { pool } from '../../config/db.js';
import { sendPushToSubscription } from './pushDeliveryService.js';

function safeJson(obj) {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return '{}';
  }
}

export async function enqueuePushForUser({ userId, title, body, url = '/', tag = null, data = null, urgency = 'normal' }) {
  const [subs] = await pool.query(
    `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = ?`,
    [userId],
  );
  if (!subs?.length) return { queued: 0 };

  const payload = {
    title: String(title ?? 'Notification'),
    body: String(body ?? ''),
    url: String(url ?? '/'),
    tag: tag ? String(tag) : null,
    data: data ?? null,
    urgency,
  };

  const values = subs.map((s) => [
    userId,
    s.endpoint,
    safeJson(payload),
    'pending',
    0,
    null,
    null,
    null,
  ]);
  await pool.query(
    `INSERT INTO push_outbox (user_id, endpoint, payload_json, status, attempts, last_error, scheduled_at, sent_at)
     VALUES ?`,
    [values],
  );
  return { queued: values.length };
}

export async function enqueuePushForUsers({ userIds, title, body, url = '/', tag = null, data = null }) {
  const ids = Array.from(new Set((userIds ?? []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return { queued: 0 };

  const [rows] = await pool.query(
    `SELECT user_id, endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id IN (?)`,
    [ids],
  );
  if (!rows?.length) return { queued: 0 };

  const payload = {
    title: String(title ?? 'Notification'),
    body: String(body ?? ''),
    url: String(url ?? '/'),
    tag: tag ? String(tag) : null,
    data: data ?? null,
  };

  const values = rows.map((s) => [
    Number(s.user_id),
    s.endpoint,
    safeJson(payload),
    'pending',
    0,
    null,
    null,
    null,
  ]);
  await pool.query(
    `INSERT INTO push_outbox (user_id, endpoint, payload_json, status, attempts, last_error, scheduled_at, sent_at)
     VALUES ?`,
    [values],
  );
  return { queued: values.length };
}

function parsePayload(payloadJson) {
  if (!payloadJson) return {};
  if (typeof payloadJson === 'object') return payloadJson;
  try {
    return JSON.parse(String(payloadJson));
  } catch {
    return {};
  }
}

function isInvalidSubscription(err) {
  const code = err?.statusCode ?? err?.status;
  return code === 404 || code === 410;
}

export async function processPushOutboxBatch({ limit = 50 } = {}) {
  const [rows] = await pool.query(
    `SELECT o.id, o.user_id, o.endpoint, o.payload_json, o.attempts,
            s.p256dh, s.auth
       FROM push_outbox o
       JOIN push_subscriptions s
         ON s.user_id = o.user_id AND s.endpoint = o.endpoint
      WHERE o.status IN ('pending','failed')
        AND o.attempts < 5
        AND (o.scheduled_at IS NULL OR o.scheduled_at <= NOW())
        AND (
          o.status = 'pending'
          OR (o.status = 'failed' AND o.updated_at <= (NOW() - INTERVAL 5 MINUTE))
        )
   ORDER BY o.id ASC
      LIMIT ?`,
    [limit],
  );

  for (const msg of rows ?? []) {
    const payload = parsePayload(msg.payload_json);
    try {
      await sendPushToSubscription({
        subscription: {
          endpoint: msg.endpoint,
          keys: { p256dh: msg.p256dh, auth: msg.auth },
        },
        payload,
      });
      await pool.query(`UPDATE push_outbox SET status='sent', attempts = attempts + 1, sent_at = NOW() WHERE id = ?`, [msg.id]);
    } catch (err) {
      const errText = String(err?.message ?? err);
      if (isInvalidSubscription(err)) {
        // Remove bad subscription automatically.
        await pool.query(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, [msg.user_id, msg.endpoint]);
      }
      await pool.query(`UPDATE push_outbox SET status='failed', attempts = attempts + 1, last_error = ? WHERE id = ?`, [errText.slice(0, 500), msg.id]);
      pool
        .query(
          `INSERT INTO failed_jobs (job_type, payload_json, status, attempts, last_error)
           VALUES (?, ?, 'failed', ?, ?)`,
          ['push_outbox', JSON.stringify({ push_outbox_id: msg.id, user_id: msg.user_id }), Number(msg.attempts ?? 0) + 1, errText.slice(0, 500)],
        )
        .catch(() => null);
    }
  }
}

