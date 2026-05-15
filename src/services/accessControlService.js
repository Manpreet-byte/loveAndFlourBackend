import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function assertActiveEnrollment({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);

  const [rows] = await db.query(
    `SELECT e.id, e.status, e.expiry_date, e.payment_reference,
            o.status AS order_status
       FROM enrollments e
  LEFT JOIN orders o
         ON o.id = CAST(SUBSTRING_INDEX(e.payment_reference, ':', -1) AS UNSIGNED)
        AND e.payment_reference LIKE 'order:%'
      WHERE e.user_id = ?
        AND e.course_id = ?
        AND e.status = 'active'
        AND e.expiry_date >= CURDATE()
      LIMIT 1`,
    [userId, courseId],
  );

  const row = rows?.[0];
  if (!row) {
    const err = new Error('Enrollment required');
    err.status = 403;
    throw err;
  }

  // Payment verification check:
  // - If enrollment was created by paid order fulfillment: payment_reference = order:<id> and order must be paid/fulfilled.
  // - If enrollment is manual/admin-granted: payment_reference is non-null but not order-based (treated as verified grant).
  if (row.payment_reference && String(row.payment_reference).startsWith('order:')) {
    const ok = row.order_status === 'paid' || row.order_status === 'fulfilled';
    if (!ok) {
      const err = new Error('Payment not verified');
      err.status = 403;
      throw err;
    }
  } else if (!row.payment_reference) {
    const err = new Error('Payment not verified');
    err.status = 403;
    throw err;
  }

  return { enrollmentId: row.id };
}

