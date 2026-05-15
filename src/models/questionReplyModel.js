import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function listRepliesForQuestion({ questionId, limit = 50 }, { conn } = {}) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const [rows] = await db.query(
    `SELECT r.id, r.question_id, r.user_id, r.is_admin_reply, r.body_html, r.is_pinned, r.created_at, r.updated_at,
            u.name AS author_name
       FROM question_replies r
       JOIN users u ON u.id = r.user_id
      WHERE r.question_id = ?
   ORDER BY r.is_pinned DESC, r.id ASC
      LIMIT ?`,
    [questionId, safeLimit],
  );
  return rows;
}

export async function createReply({ questionId, userId, bodyHtml, isAdminReply = false }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO question_replies (question_id, user_id, is_admin_reply, body_html)
     VALUES (?, ?, ?, ?)`,
    [questionId, userId, isAdminReply ? 1 : 0, bodyHtml],
  );
  return result.insertId;
}

export async function deleteReply({ id, userId, isAdmin }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `DELETE FROM question_replies
      WHERE id = ?
        AND (${isAdmin ? '1=1' : 'user_id = ?'})`,
    isAdmin ? [id] : [id, userId],
  );
}
