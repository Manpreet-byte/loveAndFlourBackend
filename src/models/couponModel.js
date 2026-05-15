import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function findActiveCouponByCode(code, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, code, description, discount_type, discount_value_cents, discount_percent, currency,
            max_redemptions, max_redemptions_per_user, min_order_total_cents, starts_at, ends_at, is_active
       FROM coupons
      WHERE code = ? AND is_active = 1
      LIMIT 1`,
    [code],
  );
  return rows?.[0] ?? null;
}

export async function countCouponUsages({ couponId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query('SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ?', [couponId]);
  return Number(rows?.[0]?.cnt ?? 0);
}

export async function countCouponUsagesForUser({ couponId, userId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query('SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ? AND user_id = ?', [
    couponId,
    userId,
  ]);
  return Number(rows?.[0]?.cnt ?? 0);
}

export async function recordCouponUsage({ couponId, userId, orderId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query('INSERT IGNORE INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)', [
    couponId,
    userId,
    orderId,
  ]);
}

