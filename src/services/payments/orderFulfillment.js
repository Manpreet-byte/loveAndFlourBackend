import { computeCourseExpiryDate } from '../enrollmentExpiry.js';

export async function fulfillPaidOrder({ conn, order, orderItems }) {
  const paymentReference = `order:${order.id}`;

  for (const item of orderItems) {
    if (item.item_type !== 'course') continue;
    const expiry = await computeCourseExpiryDate(item.course_id, { conn });
    await conn.query(
      `INSERT INTO enrollments (user_id, course_id, expiry_date, status, payment_reference)
       SELECT ?, ?, ?, 'active', ?
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM enrollments
          WHERE payment_reference = ? AND course_id = ?
       )`,
      [order.user_id, item.course_id, expiry, paymentReference, paymentReference, item.course_id],
    );
  }
}

