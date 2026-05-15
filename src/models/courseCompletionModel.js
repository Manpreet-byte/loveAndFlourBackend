import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function markCourseCompleted({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `INSERT INTO user_course_completions (user_id, course_id, completed_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE completed_at = LEAST(completed_at, VALUES(completed_at))`,
    [userId, courseId],
  );
}

export async function getCourseCompletion({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT user_id, course_id, completed_at
       FROM user_course_completions
      WHERE user_id = ? AND course_id = ?
      LIMIT 1`,
    [userId, courseId],
  );
  return rows?.[0] ?? null;
}

