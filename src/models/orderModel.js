import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createOrder(
  {
    userId,
    currency,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    couponId = null,
    couponCode = null,
    billing = {},
  },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO orders
      (user_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents,
       coupon_id, coupon_code, billing_name, billing_email, billing_phone, billing_gst_number, billing_address_json)
     VALUES (?, 'payment_pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      currency,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      couponId,
      couponCode,
      billing.name ?? null,
      billing.email ?? null,
      billing.phone ?? null,
      billing.gstNumber ?? null,
      billing.addressJson ?? null,
    ],
  );
  return result.insertId;
}

export async function insertOrderItems({ orderId, items }, { conn } = {}) {
  const db = pickConn(conn);
  if (!items?.length) return;
  const values = items.map((it) => [
    orderId,
    'course',
    it.courseId,
    it.title,
    it.currency,
    it.unitPriceCents,
    it.quantity ?? 1,
    it.lineSubtotalCents,
    it.lineDiscountCents ?? 0,
    it.lineTaxCents ?? 0,
    it.lineTotalCents,
    it.metadataJson ?? null,
  ]);

  await db.query(
    `INSERT INTO order_items
      (order_id, item_type, course_id, title, currency, unit_price_cents, quantity,
       line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents, metadata_json)
     VALUES ?`,
    [values],
  );
}

export async function findOrderByIdForUser({ orderId, userId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, user_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents,
            coupon_id, coupon_code, created_at, updated_at
       FROM orders
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [orderId, userId],
  );
  return rows?.[0] ?? null;
}

export async function findOrderById({ orderId }, { conn, forUpdate = false } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, user_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents,
            coupon_id, coupon_code
       FROM orders
      WHERE id = ?
      ${forUpdate ? 'FOR UPDATE' : ''}
      LIMIT 1`,
    [orderId],
  );
  return rows?.[0] ?? null;
}

export async function listOrderItems({ orderId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, item_type, course_id, title, currency, unit_price_cents, quantity,
            line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents
       FROM order_items
      WHERE order_id = ?
   ORDER BY id ASC`,
    [orderId],
  );
  return rows;
}

export async function markOrderPaid({ orderId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE orders
        SET status = 'paid', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('created','payment_pending','failed')`,
    [orderId],
  );
}

export async function markOrderFailed({ orderId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE orders
        SET status = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('created','payment_pending')`,
    [orderId],
  );
}
