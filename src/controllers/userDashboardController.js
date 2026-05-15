import { pool } from '../config/db.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';

function toDateOnly(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function getUserDashboard(req, res, next) {
  try {
    const userId = req.user.id;

    let kpis = {};
    try {
      // eslint-disable-next-line prefer-destructuring
      const [[row]] = await pool.query(
        `SELECT
            (SELECT COUNT(*)
               FROM enrollments e
              WHERE e.user_id = ?
                AND e.status = 'active'
                AND e.expiry_date >= CURDATE()) AS active_enrollments,
            (SELECT COUNT(*)
               FROM user_course_completions ucc
              WHERE ucc.user_id = ?) AS completed_courses,
            (SELECT COUNT(*)
               FROM certificates cert
              WHERE cert.user_id = ?
                AND cert.status = 'active') AS certificates_earned,
            (SELECT COUNT(*)
               FROM live_sessions s
              WHERE s.scheduled_at >= NOW()
                AND s.status IN ('upcoming','live')
                AND EXISTS (
                  SELECT 1 FROM enrollments e2
                   WHERE e2.user_id = ?
                     AND e2.course_id = s.course_id
                     AND e2.status = 'active'
                     AND e2.expiry_date >= CURDATE()
                )) AS upcoming_live_workshops,
            (SELECT COUNT(*)
               FROM session_recordings r
               JOIN live_sessions s2 ON s2.id = r.live_session_id
              WHERE EXISTS (
                SELECT 1 FROM enrollments e3
                 WHERE e3.user_id = ?
                   AND e3.course_id = r.course_id
                   AND e3.status = 'active'
              )
                AND DATE_ADD(s2.scheduled_at, INTERVAL 1 YEAR) >= NOW()
            ) AS available_recordings`,
        [userId, userId, userId, userId, userId],
      );
      kpis = row ?? {};
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let cont = null;
    try {
      const [continueRows] = await pool.query(
        `SELECT ulp.course_id, ulp.lesson_id, ulp.progress_percentage, ulp.last_position_seconds, ulp.updated_at,
                l.title AS lesson_title,
                c.title AS course_title, c.slug AS course_slug, c.featured_image_url
           FROM user_lesson_progress ulp
           JOIN lessons l ON l.id = ulp.lesson_id
           JOIN courses c ON c.id = ulp.course_id
          WHERE ulp.user_id = ?
            AND (ulp.started_at IS NOT NULL OR ulp.progress_percentage > 0)
            AND ulp.completed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM enrollments e
               WHERE e.user_id = ulp.user_id
                 AND e.course_id = ulp.course_id
                 AND e.status = 'active'
                 AND e.expiry_date >= CURDATE()
            )
       ORDER BY ulp.updated_at DESC
          LIMIT 1`,
        [userId],
      );
      cont = continueRows?.[0] ?? null;
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let recentLessons = [];
    try {
      const [rows] = await pool.query(
        `SELECT ulp.lesson_id, ulp.course_id, ulp.started_at, ulp.completed_at, ulp.updated_at,
                l.title AS lesson_title, c.title AS course_title, c.slug AS course_slug
           FROM user_lesson_progress ulp
           JOIN lessons l ON l.id = ulp.lesson_id
           JOIN courses c ON c.id = ulp.course_id
          WHERE ulp.user_id = ?
            AND (ulp.started_at IS NOT NULL OR ulp.completed_at IS NOT NULL)
       ORDER BY COALESCE(ulp.completed_at, ulp.started_at, ulp.updated_at) DESC
          LIMIT 8`,
        [userId],
      );
      recentLessons = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let latestCertificates = [];
    try {
      const [rows] = await pool.query(
        `SELECT cert.id, cert.certificate_id, cert.status, cert.issued_at, cert.revoked_at,
                co.title AS course_title, co.slug AS course_slug
           FROM certificates cert
           JOIN courses co ON co.id = cert.course_id
          WHERE cert.user_id = ?
       ORDER BY cert.issued_at DESC
          LIMIT 5`,
        [userId],
      );
      latestCertificates = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    let upcomingSessions = [];
    try {
      const [rows] = await pool.query(
        `SELECT s.id, s.course_id, s.title, s.scheduled_at, s.status,
                c.title AS course_title, c.slug AS course_slug
           FROM live_sessions s
           JOIN courses c ON c.id = s.course_id
          WHERE s.scheduled_at >= NOW()
            AND s.status IN ('upcoming','live')
            AND EXISTS (
              SELECT 1 FROM enrollments e
               WHERE e.user_id = ?
                 AND e.course_id = s.course_id
                 AND e.status = 'active'
                 AND e.expiry_date >= CURDATE()
            )
       ORDER BY s.scheduled_at ASC
          LIMIT 5`,
        [userId],
      );
      upcomingSessions = rows ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
    }

    return res.json({
      ok: true,
      scope: 'user',
      user: req.user,
      dashboard: {
        range: { as_of: toDateOnly(new Date()) },
        kpis: {
          active_enrollments: Number(kpis?.active_enrollments ?? 0),
          completed_courses: Number(kpis?.completed_courses ?? 0),
          certificates_earned: Number(kpis?.certificates_earned ?? 0),
          upcoming_live_workshops: Number(kpis?.upcoming_live_workshops ?? 0),
          available_recordings: Number(kpis?.available_recordings ?? 0),
        },
        continue_learning: cont
          ? {
              course_id: cont.course_id,
              course_title: cont.course_title,
              course_slug: cont.course_slug,
              featured_image_url: cont.featured_image_url ?? null,
              lesson_id: cont.lesson_id,
              lesson_title: cont.lesson_title,
              progress_percentage: cont.progress_percentage ?? 0,
              last_position_seconds: cont.last_position_seconds ?? null,
              updated_at: cont.updated_at,
            }
          : null,
        recent_activity: {
          lessons: recentLessons ?? [],
          certificates: latestCertificates ?? [],
          upcoming_sessions: upcomingSessions ?? [],
        },
      },
    });
  } catch (err) {
    return next(err);
  }
}
