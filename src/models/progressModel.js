import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function upsertLessonStarted({ userId, courseId, lessonId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `INSERT INTO user_lesson_progress (user_id, course_id, lesson_id, started_at, progress_percentage)
     VALUES (?, ?, ?, NOW(), 0)
     ON DUPLICATE KEY UPDATE started_at = COALESCE(started_at, NOW()), updated_at = CURRENT_TIMESTAMP`,
    [userId, courseId, lessonId],
  );
}

export async function upsertLessonProgress(
  { userId, courseId, lessonId, progressPercentage, lastPositionSeconds = null },
  { conn } = {},
) {
  const db = pickConn(conn);
  await db.query(
    `INSERT INTO user_lesson_progress (user_id, course_id, lesson_id, started_at, progress_percentage, last_position_seconds)
     VALUES (?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       started_at = COALESCE(started_at, NOW()),
       progress_percentage = GREATEST(progress_percentage, VALUES(progress_percentage)),
       last_position_seconds = COALESCE(VALUES(last_position_seconds), last_position_seconds),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, courseId, lessonId, progressPercentage, lastPositionSeconds],
  );
}

export async function markLessonCompleted({ userId, courseId, lessonId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `INSERT INTO user_lesson_progress (user_id, course_id, lesson_id, started_at, completed_at, progress_percentage)
     VALUES (?, ?, ?, NOW(), NOW(), 100)
     ON DUPLICATE KEY UPDATE
       started_at = COALESCE(started_at, NOW()),
       completed_at = COALESCE(completed_at, NOW()),
       progress_percentage = 100,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, courseId, lessonId],
  );
}

export async function getCourseProgressSummary({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT
        (SELECT COUNT(*) FROM lessons WHERE course_id = ? AND is_published = 1) AS total_lessons,
        (SELECT COUNT(*)
           FROM user_lesson_progress ulp
           JOIN lessons l ON l.id = ulp.lesson_id
          WHERE ulp.user_id = ? AND ulp.course_id = ? AND ulp.completed_at IS NOT NULL AND l.is_published = 1) AS completed_lessons`,
    [courseId, userId, courseId],
  );
  const total = Number(rows?.[0]?.total_lessons ?? 0);
  const completed = Number(rows?.[0]?.completed_lessons ?? 0);
  const percentage = total === 0 ? 0 : Math.floor((completed / total) * 100);
  return { totalLessons: total, completedLessons: completed, progressPercentage: percentage, isCompleted: total > 0 && completed >= total };
}

export async function listLessonProgressForCourse({ userId, courseId }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT ulp.lesson_id, ulp.started_at, ulp.completed_at, ulp.progress_percentage, ulp.last_position_seconds, ulp.updated_at
       FROM user_lesson_progress ulp
      WHERE ulp.user_id = ? AND ulp.course_id = ?
   ORDER BY ulp.lesson_id ASC`,
    [userId, courseId],
  );
  return rows;
}

