import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function listLessonComments({ lessonId, limit = 100 }, { conn } = {}) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const [rows] = await db.query(
    `SELECT c.id, c.lesson_id, c.course_id, c.user_id, c.body_html, c.created_at, c.updated_at,
            u.name AS author_name
       FROM lesson_comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.lesson_id = ?
   ORDER BY c.id DESC
      LIMIT ?`,
    [lessonId, safeLimit],
  );
  return rows;
}

export async function createLessonComment(
  { lessonId, courseId, userId, bodyHtml },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO lesson_comments (lesson_id, course_id, user_id, body_html)
     VALUES (?, ?, ?, ?)`,
    [lessonId, courseId, userId, bodyHtml],
  );
  return result.insertId;
}

export async function deleteLessonComment({ id, userId, isAdmin }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `DELETE FROM lesson_comments
      WHERE id = ?
        AND (${isAdmin ? '1=1' : 'user_id = ?'})`,
    isAdmin ? [id] : [id, userId],
  );
}

