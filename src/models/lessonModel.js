import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function listLessonsForCourse({ courseId, includeDrafts = false }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, course_id, sequence, lesson_type, title, summary, content_html, video_url, resource_url,
            duration_seconds, is_published, published_at, created_at, updated_at
       FROM lessons
      WHERE course_id = ?
        ${includeDrafts ? '' : 'AND is_published = 1'}
   ORDER BY sequence ASC, id ASC`,
    [courseId],
  );
  return rows;
}

export async function getLessonById({ lessonId, includeDrafts = false }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, course_id, sequence, lesson_type, title, summary, content_html, video_url, resource_url,
            duration_seconds, is_published, published_at, created_at, updated_at
       FROM lessons
      WHERE id = ?
        ${includeDrafts ? '' : 'AND is_published = 1'}
      LIMIT 1`,
    [lessonId],
  );
  return rows?.[0] ?? null;
}

export async function createLesson(
  {
    courseId,
    sequence,
    lessonType,
    title,
    summary = null,
    contentHtml = null,
    videoUrl = null,
    resourceUrl = null,
    durationSeconds = null,
    isPublished = false,
    publishedAt = null,
  },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO lessons
      (course_id, sequence, lesson_type, title, summary, content_html, video_url, resource_url, duration_seconds, is_published, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId,
      sequence,
      lessonType,
      title,
      summary,
      contentHtml,
      videoUrl,
      resourceUrl,
      durationSeconds,
      isPublished ? 1 : 0,
      publishedAt,
    ],
  );
  return result.insertId;
}

export async function updateLessonById({ lessonId, fields, values }, { conn } = {}) {
  const db = pickConn(conn);
  if (!fields.length) return 0;
  const [result] = await db.query(`UPDATE lessons SET ${fields.join(', ')} WHERE id = ?`, [...values, lessonId]);
  return result.affectedRows ?? 0;
}

export async function deleteLessonById({ lessonId }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query('DELETE FROM lessons WHERE id = ?', [lessonId]);
  return result.affectedRows ?? 0;
}

export async function reorderLessons({ courseId, orderedLessonIds }, { conn } = {}) {
  const db = pickConn(conn);
  if (!orderedLessonIds.length) return;

  // Ensure all lesson ids belong to the course.
  const [rows] = await db.query('SELECT id FROM lessons WHERE course_id = ? AND id IN (?)', [courseId, orderedLessonIds]);
  if (rows.length !== orderedLessonIds.length) {
    const err = new Error('One or more lessons do not belong to this course');
    err.status = 400;
    throw err;
  }

  // Update sequences deterministically.
  for (let i = 0; i < orderedLessonIds.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.query('UPDATE lessons SET sequence = ? WHERE id = ? AND course_id = ?', [i + 1, orderedLessonIds[i], courseId]);
  }
}
