import { z } from 'zod';
import { pool } from '../config/db.js';
import { enqueueBulkEmail } from '../services/emailOutbox.js';
import { buildBrandedEmailHtml } from '../services/emailTemplates.js';
import { env } from '../utils/env.js';

const schema = z.object({
  live_session_id: z.coerce.number().int().positive(),
  course_id: z.coerce.number().int().positive(),
  recording_url: z.string().url().max(2048),
  provider: z.string().max(60).optional().nullable(),
  recorded_at: z.string().datetime().optional().nullable(),
  duration_seconds: z.coerce.number().int().nonnegative().optional().nullable(),
});

const patchSchema = schema.partial().extend({
  live_session_id: z.coerce.number().int().positive().optional(),
  course_id: z.coerce.number().int().positive().optional(),
});

export async function createRecording(req, res, next) {
  try {
    const payload = schema.parse(req.body);
    const [result] = await pool.query(
      'INSERT INTO session_recordings (live_session_id, course_id, recording_url, provider, recorded_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)',
      [
        payload.live_session_id,
        payload.course_id,
        payload.recording_url,
        payload.provider ?? null,
        payload.recorded_at ?? null,
        payload.duration_seconds ?? null,
      ],
    );

    // Mark session recording state as ready (best effort; older DBs may not have the column).
    pool
      .query(`UPDATE live_sessions SET recording_state = 'ready', recording_ready_at = NOW() WHERE id = ?`, [payload.live_session_id])
      .catch(() => null);

    const [sent] = await pool.query(
      'SELECT 1 FROM live_session_notification_log WHERE live_session_id = ? AND notification_type = ? LIMIT 1',
      [payload.live_session_id, 'recording'],
    );
    if (!sent?.length) {
      const [users] = await pool.query(
        `SELECT DISTINCT u.email
           FROM enrollments e
           JOIN users u ON u.id = e.user_id
          WHERE e.course_id = ? AND e.status = 'active' AND e.expiry_date >= CURDATE()`,
        [payload.course_id],
      );
      const toEmails = users.map((u) => u.email).filter(Boolean);
      const dashUrl = `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/dashboard`;
      const bodyHtml = buildBrandedEmailHtml({
        title: 'Recording available for your class',
        preheader: 'Your class recording is now available.',
        contentHtml: `<p>Your class recording is now available.</p>
<p style="word-break:break-all"><a href="${payload.recording_url}">${payload.recording_url}</a></p>`,
        ctaLabel: 'Open dashboard',
        ctaUrl: dashUrl,
      });
      await enqueueBulkEmail({
        toEmails,
        subject: 'Recording available for your class',
        bodyText: `Your class recording is now available.\nRecording link: ${payload.recording_url}`,
        bodyHtml,
      });
      await pool.query(
        'INSERT IGNORE INTO live_session_notification_log (live_session_id, notification_type) VALUES (?, ?)',
        [payload.live_session_id, 'recording'],
      );
    }

    return res.status(201).json({ recording_id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function listRecordings(req, res, next) {
  try {
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    if (req.query.course_id && (!Number.isFinite(courseId) || courseId <= 0)) {
      return res.status(400).json({ error: { message: 'Invalid course_id' } });
    }
    const [rows] = await pool.query(
      courseId
        ? 'SELECT * FROM session_recordings WHERE course_id = ? ORDER BY created_at DESC LIMIT 200'
        : 'SELECT * FROM session_recordings ORDER BY created_at DESC LIMIT 200',
      courseId ? [courseId] : [],
    );
    return res.json({ recordings: rows });
  } catch (err) {
    return next(err);
  }
}

export async function updateRecording(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid recording id' } });
    const payload = patchSchema.parse(req.body ?? {});
    const fields = [];
    const values = [];
    for (const [key, col] of [
      ['live_session_id', 'live_session_id'],
      ['course_id', 'course_id'],
      ['recording_url', 'recording_url'],
      ['provider', 'provider'],
      ['recorded_at', 'recorded_at'],
      ['duration_seconds', 'duration_seconds'],
    ]) {
      if (payload[key] === undefined) continue;
      fields.push(`${col} = ?`);
      values.push(payload[key] ?? null);
    }
    if (!fields.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE session_recordings SET ${fields.join(', ')} WHERE id = ?`, values);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function deleteRecording(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid recording id' } });
    await pool.query('DELETE FROM session_recordings WHERE id = ? LIMIT 1', [id]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
