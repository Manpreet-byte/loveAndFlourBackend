import { pool } from '../config/db.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';
import { computeLiveSessionState } from '../services/liveSessionStateService.js';

export async function myEnrollments(req, res, next) {
  try {
    const userId = req.user.id;
    try {
      const [rows] = await pool.query(
        `SELECT e.id AS enrollment_id, e.course_id, e.expiry_date, e.status,
                c.title, c.slug, c.summary, c.featured_image_url
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
          WHERE e.user_id = ? AND e.status = 'active' AND e.expiry_date >= CURDATE()
       ORDER BY e.expiry_date DESC`,
        [userId],
      );
      res.json({ enrollments: rows ?? [] });
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
      res.json({ enrollments: [] });
    }
  } catch (err) {
    next(err);
  }
}

export async function myRecordings(req, res, next) {
  try {
    const userId = req.user.id;
    try {
      const [rows] = await pool.query(
        `SELECT r.id AS recording_id, r.recording_url, r.provider, r.recorded_at, r.duration_seconds,
                s.id AS live_session_id, s.scheduled_at, s.title AS session_title,
                c.id AS course_id, c.title AS course_title, c.slug AS course_slug,
                DATE_ADD(s.scheduled_at, INTERVAL 1 YEAR) AS expires_at,
                CASE WHEN DATE_ADD(s.scheduled_at, INTERVAL 1 YEAR) < NOW() THEN 1 ELSE 0 END AS is_expired
           FROM session_recordings r
           JOIN live_sessions s ON s.id = r.live_session_id
           JOIN courses c ON c.id = r.course_id
          WHERE EXISTS (
            SELECT 1
              FROM enrollments e
             WHERE e.course_id = c.id
               AND e.user_id = ?
               AND e.status = 'active'
          )
       ORDER BY COALESCE(r.recorded_at, r.created_at) DESC
          LIMIT 500`,
        [userId],
      );
      res.json({ recordings: rows ?? [] });
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
      res.json({ recordings: [] });
    }
  } catch (err) {
    next(err);
  }
}

export async function myLiveSessions(req, res, next) {
  try {
    const userId = req.user.id;
    try {
      const [rows] = await pool.query(
        `SELECT s.id AS live_session_id, s.course_id, s.title AS session_title, s.scheduled_at, s.status,
                c.title AS course_title, c.slug AS course_slug, c.featured_image_url,
                (SELECT COUNT(*) FROM session_recordings r WHERE r.live_session_id = s.id) AS recordings_count,
                (SELECT COUNT(*) FROM enrollments e2 WHERE e2.course_id = s.course_id AND e2.status = 'active' AND e2.expiry_date >= CURDATE()) AS enrolled_count,
                s.seat_limit, s.duration_minutes, s.cancelled_at, s.recording_state, s.recording_ready_at, s.replay_days
           FROM live_sessions s
           JOIN courses c ON c.id = s.course_id
          WHERE EXISTS (
            SELECT 1
              FROM enrollments e
             WHERE e.course_id = s.course_id
               AND e.user_id = ?
               AND e.status = 'active'
          )
       ORDER BY s.scheduled_at DESC
          LIMIT 200`,
        [userId],
      );
      const now = new Date();
      const normalized = (rows ?? []).map((s) => {
        const enrolledCount = Number(s.enrolled_count ?? 0);
        const derived = computeLiveSessionState(s, { now, enrolledCount, ignoreSeatLimit: true });
        return { ...s, derived_state: derived.state };
      });
      res.json({ live_sessions: normalized });
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
      res.json({ live_sessions: [] });
    }
  } catch (err) {
    next(err);
  }
}
