import { pool } from '../config/db.js';
import { canJoinWindow, computeLiveSessionState } from '../services/liveSessionStateService.js';

export async function getLiveSessionAccess(req, res, next) {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid live session id' } });

    const [[session]] = await pool.query(
      `SELECT s.*, c.title AS course_title, c.slug AS course_slug
         FROM live_sessions s
         JOIN courses c ON c.id = s.course_id
        WHERE s.id = ?
        LIMIT 1`,
      [id],
    );
    if (!session) return res.status(404).json({ error: { message: 'Not found' } });

    const [[enrollment]] = await pool.query(
      `SELECT id, status, expiry_date
         FROM enrollments
        WHERE user_id = ? AND course_id = ?
          AND status = 'active'
          AND expiry_date >= CURDATE()
        LIMIT 1`,
      [userId, session.course_id],
    );
    const isEnrolled = !!enrollment;
    if (!isEnrolled) return res.status(403).json({ error: { message: 'Not enrolled' } });

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS enrolled_count
         FROM enrollments e
        WHERE e.course_id = ?
          AND e.status = 'active'
          AND e.expiry_date >= CURDATE()`,
      [session.course_id],
    );
    const enrolledCount = Number(cnt?.enrolled_count ?? 0);
    const now = new Date();
    const derived = computeLiveSessionState(session, { now, enrolledCount, ignoreSeatLimit: true });

    const nowMs = now.getTime();
    const canJoin =
      (derived.state === 'live' || derived.state === 'upcoming') &&
      canJoinWindow({ scheduledMs: derived.scheduledMs, endedMs: derived.endedMs, nowMs });

    let recordings = [];
    try {
      const [rows] = await pool.query(
        `SELECT id AS recording_id, recording_url, provider, recorded_at, duration_seconds
           FROM session_recordings
          WHERE live_session_id = ?
       ORDER BY COALESCE(recorded_at, created_at) DESC
          LIMIT 20`,
        [id],
      );
      recordings = rows ?? [];
    } catch {
      recordings = [];
    }

    // Replay window: replay_days from session, and enrollment expiry.
    const replayDays = Number(session.replay_days ?? 365);
    const replayUntil = session.scheduled_at ? new Date(new Date(session.scheduled_at).getTime() + replayDays * 24 * 60 * 60_000) : null;
    const canReplay = replayUntil ? now.getTime() <= replayUntil.getTime() : true;

    const canWatch = derived.state === 'recording-ready' && canReplay && recordings.some((r) => !!r.recording_url);

    return res.json({
      access: {
        live_session_id: id,
        course_id: Number(session.course_id),
        state: derived.state,
        enrollment: { ok: true, expiry_date: enrollment.expiry_date },
        join: {
          can_join: Boolean(canJoin && session.zoom_join_url),
          zoom_join_url: canJoin ? session.zoom_join_url : null,
        },
        recordings: {
          can_watch: Boolean(canWatch),
          items: recordings.map((r) => ({
            recording_id: r.recording_id ?? r.id,
            recording_url: r.recording_url ?? null,
            provider: r.provider ?? null,
            recorded_at: r.recorded_at ?? null,
            duration_seconds: r.duration_seconds ?? null,
          })),
        },
        replay: {
          replay_days: replayDays,
          replay_until: replayUntil ? replayUntil.toISOString() : null,
        },
        // Compatibility for older frontend callers:
        live_url: canJoin ? session.zoom_join_url : null,
      },
    });
  } catch (err) {
    return next(err);
  }
}
