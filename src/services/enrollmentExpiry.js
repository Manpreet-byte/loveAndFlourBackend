import { pool } from '../config/db.js';

function addOneYear(date) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

function pickConn(conn) {
  return conn ?? pool;
}

export async function computeCourseExpiryDate(courseId, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query('SELECT MAX(scheduled_at) AS max_scheduled_at FROM live_sessions WHERE course_id = ?', [
    courseId,
  ]);
  const maxScheduledAt = rows?.[0]?.max_scheduled_at;
  const base = maxScheduledAt ? new Date(maxScheduledAt) : new Date();
  const expiry = addOneYear(base);
  return expiry.toISOString().slice(0, 10);
}

export async function ensureEnrollmentsExpiryFromSessions(courseId) {
  const expiryDate = await computeCourseExpiryDate(courseId);
  await pool.query(
    `UPDATE enrollments
        SET expiry_date = ?
      WHERE course_id = ?
        AND (expiry_date IS NULL OR expiry_date < ?)`,
    [expiryDate, courseId, expiryDate],
  );
}
