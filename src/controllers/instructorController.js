import { pool } from '../config/db.js';

export async function instructorDashboard(req, res, next) {
  try {
    const userId = req.user.id;
    const [courses] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.workflow_status, c.is_published, c.updated_at,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS active_students
         FROM courses c
         JOIN course_instructors ci ON ci.course_id = c.id AND ci.instructor_id = ?
     ORDER BY c.updated_at DESC
        LIMIT 500`,
      [userId],
    );

    const [qa] = await pool.query(
      `SELECT q.id, q.course_id, q.lesson_id, q.title, q.status, q.updated_at, c.title AS course_title
         FROM course_questions q
         JOIN course_instructors ci ON ci.course_id = q.course_id AND ci.instructor_id = ?
         JOIN courses c ON c.id = q.course_id
        WHERE q.status IN ('open','answered')
     ORDER BY q.updated_at DESC
        LIMIT 50`,
      [userId],
    );

    return res.json({ dashboard: { courses, qa_inbox: qa } });
  } catch (err) {
    return next(err);
  }
}

export async function instructorAnalytics(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT c.id AS course_id, c.title,
              COUNT(DISTINCT e.user_id) AS students,
              SUM(CASE WHEN o.status IN ('paid','fulfilled') THEN oi.line_total_cents ELSE 0 END) AS revenue_cents
         FROM courses c
         JOIN course_instructors ci ON ci.course_id = c.id AND ci.instructor_id = ?
    LEFT JOIN enrollments e ON e.course_id = c.id
    LEFT JOIN order_items oi ON oi.course_id = c.id
    LEFT JOIN orders o ON o.id = oi.order_id
     GROUP BY c.id
     ORDER BY revenue_cents DESC
        LIMIT 200`,
      [userId],
    );
    return res.json({ analytics: { by_course: rows } });
  } catch (err) {
    return next(err);
  }
}

export async function instructorStudents(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT e.course_id, c.title AS course_title, u.id AS user_id, u.name, u.email, e.enrolled_at, e.expiry_date
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = e.user_id
         JOIN course_instructors ci ON ci.course_id = e.course_id AND ci.instructor_id = ?
        WHERE e.status = 'active'
     ORDER BY e.enrolled_at DESC
        LIMIT 500`,
      [userId],
    );
    return res.json({ students: rows });
  } catch (err) {
    return next(err);
  }
}

export async function instructorEarnings(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT id, course_id, order_id, gross_amount_cents, commission_rate_bp, payout_amount_cents, payout_status, created_at
         FROM instructor_earnings
        WHERE instructor_id = ?
     ORDER BY id DESC
        LIMIT 500`,
      [userId],
    );
    return res.json({ earnings: rows });
  } catch (err) {
    return next(err);
  }
}
