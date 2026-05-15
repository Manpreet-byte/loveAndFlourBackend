import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function listCourseQuestions({ courseId, limit = 20, cursor = null }, { conn } = {}) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const cursorId = cursor ? Number(cursor) : null;

  const [rows] = await db.query(
    `SELECT q.id, q.course_id, q.lesson_id, q.user_id, q.title, q.body_html, q.status, q.is_pinned,
            q.created_at, q.updated_at,
            u.name AS author_name,
            (SELECT COUNT(*) FROM question_replies r WHERE r.question_id = q.id) AS reply_count,
            (SELECT MAX(r2.created_at) FROM question_replies r2 WHERE r2.question_id = q.id) AS last_reply_at
       FROM course_questions q
       JOIN users u ON u.id = q.user_id
      WHERE q.course_id = ?
        ${cursorId ? 'AND q.id < ?' : ''}
   ORDER BY q.is_pinned DESC, q.updated_at DESC, q.id DESC
      LIMIT ?`,
    cursorId ? [courseId, cursorId, safeLimit] : [courseId, safeLimit],
  );

  const nextCursor = rows.length === safeLimit ? rows[rows.length - 1]?.id : null;
  return { questions: rows, next_cursor: nextCursor };
}

export async function getCourseQuestionById({ id }, { conn } = {}) {
  const db = pickConn(conn);
  const [[row]] = await db.query(
    `SELECT q.id, q.course_id, q.lesson_id, q.user_id, q.title, q.body_html, q.status, q.is_pinned,
            q.created_at, q.updated_at,
            u.name AS author_name
       FROM course_questions q
       JOIN users u ON u.id = q.user_id
      WHERE q.id = ?
      LIMIT 1`,
    [id],
  );
  return row ?? null;
}

export async function createCourseQuestion(
  { courseId, userId, lessonId = null, title, bodyHtml },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO course_questions (course_id, user_id, lesson_id, title, body_html)
     VALUES (?, ?, ?, ?, ?)`,
    [courseId, userId, lessonId, title, bodyHtml],
  );
  return result.insertId;
}

export async function updateCourseQuestion(
  { id, userId, isAdmin, title, bodyHtml, status },
  { conn } = {},
) {
  const db = pickConn(conn);
  const fields = [];
  const values = [];
  if (title !== undefined) {
    fields.push('title = ?');
    values.push(title);
  }
  if (bodyHtml !== undefined) {
    fields.push('body_html = ?');
    values.push(bodyHtml);
  }
  if (status !== undefined) {
    fields.push('status = ?');
    values.push(status);
  }
  if (!fields.length) return;
  if (isAdmin) {
    values.push(id);
    await db.query(
      `UPDATE course_questions
          SET ${fields.join(', ')}
        WHERE id = ?`,
      values,
    );
    return;
  }

  values.push(id);
  values.push(userId);
  await db.query(
    `UPDATE course_questions
        SET ${fields.join(', ')}
      WHERE id = ? AND user_id = ?`,
    values,
  );
}

export async function deleteCourseQuestion({ id, userId, isAdmin }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `DELETE FROM course_questions
      WHERE id = ?
        AND (${isAdmin ? '1=1' : 'user_id = ?'})`,
    isAdmin ? [id] : [id, userId],
  );
}
