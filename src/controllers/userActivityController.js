import { pool } from '../config/db.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';

export async function getMyActivity(req, res, next) {
  try {
    const userId = req.user.id;

    let enrollments = [];
    try {
      const [rows] = await pool.query(
        `SELECT e.id, e.course_id, e.enrolled_at, e.expiry_date, e.status,
                c.title AS course_title, c.slug AS course_slug
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
          WHERE e.user_id = ?
       ORDER BY e.enrolled_at DESC
          LIMIT 100`,
        [userId],
      );
      enrollments = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let lessonMilestones = [];
    try {
      const [rows] = await pool.query(
        `SELECT ulp.lesson_id, ulp.course_id, ulp.started_at, ulp.completed_at, ulp.progress_percentage, ulp.updated_at,
                l.title AS lesson_title, c.title AS course_title
           FROM user_lesson_progress ulp
           JOIN lessons l ON l.id = ulp.lesson_id
           JOIN courses c ON c.id = ulp.course_id
          WHERE ulp.user_id = ?
            AND (ulp.started_at IS NOT NULL OR ulp.completed_at IS NOT NULL)
       ORDER BY COALESCE(ulp.completed_at, ulp.started_at, ulp.updated_at) DESC
          LIMIT 200`,
        [userId],
      );
      lessonMilestones = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let completions = [];
    try {
      const [rows] = await pool.query(
        `SELECT ucc.course_id, ucc.completed_at, c.title AS course_title, c.slug AS course_slug
           FROM user_course_completions ucc
           JOIN courses c ON c.id = ucc.course_id
          WHERE ucc.user_id = ?
       ORDER BY ucc.completed_at DESC
          LIMIT 100`,
        [userId],
      );
      completions = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let certificates = [];
    try {
      const [rows] = await pool.query(
        `SELECT c.course_id, c.certificate_id, c.issued_at, c.status, c.revoked_at,
                co.title AS course_title, co.slug AS course_slug
           FROM certificates c
           JOIN courses co ON co.id = c.course_id
          WHERE c.user_id = ?
       ORDER BY c.issued_at DESC
          LIMIT 100`,
        [userId],
      );
      certificates = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    return res.json({
      enrollments,
      lesson_milestones: lessonMilestones,
      course_completions: completions,
      certificates,
    });
  } catch (err) {
    return next(err);
  }
}
