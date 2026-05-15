import { z } from 'zod';
import { pool } from '../config/db.js';
import { ensureEnrollmentsExpiryFromSessions } from '../services/enrollmentExpiry.js';
import { enqueueBulkEmail } from '../services/emailOutbox.js';
import { toMysqlDatetime } from '../utils/datetime.js';

const sessionSchema = z.object({
  course_id: z.coerce.number().int().positive(),
  title: z.string().max(255).optional().nullable(),
  scheduled_at: z.string().datetime(),
  status: z.enum(['upcoming', 'live', 'completed', 'cancelled']).default('upcoming'),
  zoom_meeting_id: z.string().max(64).optional().nullable(),
  zoom_join_url: z.string().url().max(2048).optional().nullable(),
  seat_limit: z.coerce.number().int().min(0).max(100000).optional().default(0),
  duration_minutes: z.coerce.number().int().min(15).max(24 * 60).optional().default(120),
  replay_days: z.coerce.number().int().min(1).max(3650).optional().default(365),
});

const updateSchema = sessionSchema.partial().extend({
  status: z.enum(['upcoming', 'live', 'completed', 'cancelled']).optional(),
});

export async function createLiveSession(req, res, next) {
  try {
    const payload = sessionSchema.parse(req.body);
    const scheduledAt = toMysqlDatetime(payload.scheduled_at);
    if (!scheduledAt) return res.status(400).json({ error: { message: 'Invalid scheduled_at' } });
    const [result] = await pool.query(
      'INSERT INTO live_sessions (course_id, title, scheduled_at, status, zoom_meeting_id, zoom_join_url, seat_limit, duration_minutes, replay_days, recording_state, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        payload.course_id,
        payload.title ?? null,
        scheduledAt,
        payload.status,
        payload.zoom_meeting_id ?? null,
        payload.zoom_join_url ?? null,
        payload.seat_limit ?? 0,
        payload.duration_minutes ?? 120,
        payload.replay_days ?? 365,
        payload.status === 'completed' ? 'processing' : 'none',
        payload.status === 'cancelled' ? new Date() : null,
      ],
    );

    await ensureEnrollmentsExpiryFromSessions(payload.course_id);

    if (payload.zoom_join_url) {
      const [users] = await pool.query(
        `SELECT DISTINCT u.email
           FROM enrollments e
           JOIN users u ON u.id = e.user_id
          WHERE e.course_id = ? AND e.status = 'active' AND e.expiry_date >= CURDATE()`,
        [payload.course_id],
      );
      const toEmails = users.map((u) => u.email).filter(Boolean);
      await enqueueBulkEmail({
        toEmails,
        subject: 'Your live class is scheduled (Zoom link inside)',
        bodyText: `Your live class has been scheduled.\nZoom link: ${payload.zoom_join_url}\nScheduled at: ${payload.scheduled_at}`,
      });
      await pool.query(
        'INSERT IGNORE INTO live_session_notification_log (live_session_id, notification_type) VALUES (?, ?)',
        [result.insertId, 'scheduled'],
      );
    }
    return res.status(201).json({ live_session_id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function updateLiveSession(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid session id' } });
    const payload = updateSchema.parse(req.body);
    const fields = [];
    const values = [];
    for (const [key, col] of [
      ['title', 'title'],
      ['scheduled_at', 'scheduled_at'],
      ['status', 'status'],
      ['zoom_meeting_id', 'zoom_meeting_id'],
      ['zoom_join_url', 'zoom_join_url'],
      ['seat_limit', 'seat_limit'],
      ['duration_minutes', 'duration_minutes'],
      ['replay_days', 'replay_days'],
    ]) {
      if (payload[key] !== undefined) {
        fields.push(`${col} = ?`);
        if (key === 'scheduled_at') {
          const scheduledAt = payload.scheduled_at ? toMysqlDatetime(payload.scheduled_at) : null;
          if (!scheduledAt) return res.status(400).json({ error: { message: 'Invalid scheduled_at' } });
          values.push(scheduledAt);
        } else {
          values.push(payload[key] ?? null);
        }
      }
    }
    // Handle cancel toggle.
    if (payload.status === 'cancelled') {
      fields.push('cancelled_at = COALESCE(cancelled_at, NOW())');
    } else if (payload.status && payload.status !== 'cancelled') {
      fields.push('cancelled_at = NULL');
    }
    if (!fields.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE live_sessions SET ${fields.join(', ')} WHERE id = ?`, values);

    const [sessionRows] = await pool.query('SELECT id, course_id, scheduled_at, zoom_join_url FROM live_sessions WHERE id = ? LIMIT 1', [id]);
    const session = sessionRows?.[0];
    if (session?.course_id) {
      await ensureEnrollmentsExpiryFromSessions(session.course_id);
      if (session.zoom_join_url) {
        const [sent] = await pool.query(
          'SELECT 1 FROM live_session_notification_log WHERE live_session_id = ? AND notification_type = ? LIMIT 1',
          [id, 'updated'],
        );
        if (!sent?.length) {
          const [users] = await pool.query(
            `SELECT DISTINCT u.email
               FROM enrollments e
               JOIN users u ON u.id = e.user_id
              WHERE e.course_id = ? AND e.status = 'active' AND e.expiry_date >= CURDATE()`,
            [session.course_id],
          );
          const toEmails = users.map((u) => u.email).filter(Boolean);
          await enqueueBulkEmail({
            toEmails,
            subject: 'Your live class details were updated',
            bodyText: `Live class details updated.\nZoom link: ${session.zoom_join_url}\nScheduled at: ${session.scheduled_at}`,
          });
          await pool.query(
            'INSERT IGNORE INTO live_session_notification_log (live_session_id, notification_type) VALUES (?, ?)',
            [id, 'updated'],
          );
        }
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function listLiveSessions(req, res, next) {
  try {
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    if (req.query.course_id && (!Number.isFinite(courseId) || courseId <= 0)) {
      return res.status(400).json({ error: { message: 'Invalid course_id' } });
    }
    const [rows] = await pool.query(
      courseId
        ? 'SELECT s.*, c.title AS course_title FROM live_sessions s JOIN courses c ON c.id = s.course_id WHERE s.course_id = ? ORDER BY s.scheduled_at DESC LIMIT 200'
        : 'SELECT s.*, c.title AS course_title FROM live_sessions s JOIN courses c ON c.id = s.course_id ORDER BY s.scheduled_at DESC LIMIT 200',
      courseId ? [courseId] : [],
    );
    return res.json({ live_sessions: rows });
  } catch (err) {
    return next(err);
  }
}

export async function deleteLiveSession(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid session id' } });
    await pool.query('DELETE FROM live_sessions WHERE id = ? LIMIT 1', [id]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
