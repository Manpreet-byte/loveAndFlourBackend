import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createCertificate(
  { certificateId, userId, courseId, verificationCode, issuedAt = null },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO certificates
      (certificate_id, user_id, course_id, issued_at, verification_code, status)
     VALUES (?, ?, ?, COALESCE(?, NOW()), ?, 'active')`,
    [certificateId, userId, courseId, issuedAt, verificationCode],
  );
  return result.insertId;
}

export async function findCertificateByUserCourse({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, certificate_id, user_id, course_id, issued_at, verification_code, status, revoked_at, revoke_reason
       FROM certificates
      WHERE user_id = ? AND course_id = ?
      LIMIT 1`,
    [userId, courseId],
  );
  return rows?.[0] ?? null;
}

export async function findCertificateByUserCourseWithCourse({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT c.id, c.certificate_id, c.user_id, c.course_id, c.issued_at, c.verification_code, c.status, c.revoked_at, c.revoke_reason,
            co.title AS course_title, co.slug AS course_slug
       FROM certificates c
       JOIN courses co ON co.id = c.course_id
      WHERE c.user_id = ? AND c.course_id = ?
      LIMIT 1`,
    [userId, courseId],
  );
  return rows?.[0] ?? null;
}

export async function findCertificateByVerificationCode({ code }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT c.id, c.certificate_id, c.user_id, c.course_id, c.issued_at, c.status, c.revoked_at,
            u.name AS user_name, u.email AS user_email,
            co.title AS course_title, co.slug AS course_slug
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       JOIN courses co ON co.id = c.course_id
      WHERE c.verification_code = ?
      LIMIT 1`,
    [code],
  );
  return rows?.[0] ?? null;
}

export async function revokeCertificate({ id, reason = null }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `UPDATE certificates
        SET status = 'revoked', revoked_at = NOW(), revoke_reason = ?
      WHERE id = ? AND status <> 'revoked'`,
    [reason, id],
  );
  return result.affectedRows ?? 0;
}

export async function reactivateCertificate({ id }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `UPDATE certificates
        SET status = 'active', revoked_at = NULL, revoke_reason = NULL
      WHERE id = ?`,
    [id],
  );
  return result.affectedRows ?? 0;
}

export async function listCertificatesForUser({ userId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT c.id, c.certificate_id, c.user_id, c.course_id, c.issued_at, c.verification_code, c.status, c.revoked_at, c.revoke_reason,
            co.title AS course_title, co.slug AS course_slug
       FROM certificates c
       JOIN courses co ON co.id = c.course_id
      WHERE c.user_id = ?
   ORDER BY c.issued_at DESC, c.id DESC
      LIMIT 500`,
    [userId],
  );
  return rows ?? [];
}
