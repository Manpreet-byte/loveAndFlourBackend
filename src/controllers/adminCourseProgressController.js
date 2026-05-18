import { pool } from '../config/db.js';

export async function adminGetCourseProgress(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });

    const [[totals]] = await pool.query('SELECT COUNT(*) AS total FROM lessons WHERE course_id = ? AND is_published = 1', [courseId]);
    const totalLessons = Number(totals?.total ?? 0);

    const [rows] = await pool.query(
      `SELECT e.id AS enrollment_id, e.user_id, u.email, u.name, e.status, e.expiry_date,
              COALESCE(COUNT(DISTINCT CASE WHEN ulp.completed_at IS NOT NULL THEN ulp.lesson_id END), 0) AS completed_lessons,
              MAX(ulp.updated_at) AS last_activity_at
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
    LEFT JOIN user_lesson_progress ulp
           ON ulp.user_id = e.user_id AND ulp.course_id = e.course_id
    LEFT JOIN lessons l
           ON l.id = ulp.lesson_id AND l.is_published = 1
        WHERE e.course_id = ?
     GROUP BY e.id, e.user_id, u.email, u.name, e.status, e.expiry_date
     ORDER BY last_activity_at DESC
        LIMIT 2000`,
      [courseId],
    );

    const users = (rows ?? []).map((r) => {
      const completed = Number(r.completed_lessons ?? 0);
      const pct = totalLessons > 0 ? Math.floor((completed / totalLessons) * 100) : 0;
      return {
        enrollment_id: Number(r.enrollment_id),
        user_id: Number(r.user_id),
        email: r.email,
        name: r.name,
        status: r.status,
        expiry_date: r.expiry_date,
        completed_lessons: completed,
        total_lessons: totalLessons,
        progress_percentage: pct,
        last_activity_at: r.last_activity_at ?? null,
      };
    });

    return res.json({ course_id: courseId, total_lessons: totalLessons, users });
  } catch (err) {
    return next(err);
  }
}

