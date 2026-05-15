import { z } from 'zod';
import { pool } from '../config/db.js';

const subSchema = z.object({
  endpoint: z.string().trim().min(10).max(512),
  keys: z.object({
    p256dh: z.string().trim().min(10).max(255),
    auth: z.string().trim().min(6).max(255),
  }),
});

export async function subscribe(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = subSchema.parse(req.body ?? {});
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 255) || null;
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
      [userId, payload.endpoint, payload.keys.p256dh, payload.keys.auth, ua],
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const endpointSchema = z.object({ endpoint: z.string().trim().min(10).max(512) });

export async function unsubscribe(req, res, next) {
  try {
    const userId = req.user.id;
    const { endpoint } = endpointSchema.parse(req.body ?? {});
    await pool.query(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, [userId, endpoint]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

