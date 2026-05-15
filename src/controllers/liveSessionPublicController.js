import { pool } from '../config/db.js';
import { computeLiveSessionState } from '../services/liveSessionStateService.js';

export async function listPublicLiveSessions(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, c.title AS course_title, c.slug AS course_slug, c.featured_image_url
              , (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id AND e.status = 'active' AND e.expiry_date >= CURDATE()) AS enrolled_count
         FROM live_sessions s
         JOIN courses c ON c.id = s.course_id
        WHERE c.is_published = 1
     ORDER BY s.scheduled_at ASC
        LIMIT 500`,
    );

    const now = new Date();
    const out = (rows ?? []).map((s) => {
      const enrolledCount = Number(s.enrolled_count ?? 0);
      const state = computeLiveSessionState(s, { now, enrolledCount });
      return { ...s, enrolled_count: enrolledCount, derived_state: state.state };
    });

    return res.json({ live_sessions: out });
  } catch (err) {
    return next(err);
  }
}

export async function getPublicLiveSessionBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug ?? '').trim();
    if (!slug) return res.status(400).json({ error: { message: 'Invalid slug' } });

    // Prefer the next upcoming/live session; fallback to latest.
    const [rows] = await pool.query(
      `SELECT s.*, c.title AS course_title, c.slug AS course_slug, c.featured_image_url
         FROM live_sessions s
         JOIN courses c ON c.id = s.course_id
        WHERE c.slug = ?
     ORDER BY
       (CASE WHEN s.scheduled_at >= NOW() THEN 0 ELSE 1 END) ASC,
       ABS(TIMESTAMPDIFF(SECOND, NOW(), s.scheduled_at)) ASC
        LIMIT 1`,
      [slug],
    );
    const s = rows?.[0];
    if (!s) return res.status(404).json({ error: { message: 'Not found' } });

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS enrolled_count
         FROM enrollments e
        WHERE e.course_id = ?
          AND e.status = 'active'
          AND e.expiry_date >= CURDATE()`,
      [s.course_id],
    );
    const enrolledCount = Number(cnt?.enrolled_count ?? 0);
    const state = computeLiveSessionState(s, { now: new Date(), enrolledCount });

    return res.json({
      live_session: {
        ...s,
        enrolled_count: enrolledCount,
        derived_state: state.state,
      },
    });
  } catch (err) {
    return next(err);
  }
}
