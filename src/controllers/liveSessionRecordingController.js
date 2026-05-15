import { pool } from '../config/db.js';
import { enqueueBulkEmail } from '../services/emailOutbox.js';
import { buildBrandedEmailHtml } from '../services/emailTemplates.js';
import { env } from '../utils/env.js';
import { enqueuePushForUsers } from '../services/push/pushOutboxService.js';

export async function markRecordingReady(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid session id' } });

    const [[session]] = await pool.query(
      `SELECT s.id, s.course_id, s.title AS session_title, s.scheduled_at, c.title AS course_title, c.slug AS course_slug
         FROM live_sessions s
         JOIN courses c ON c.id = s.course_id
        WHERE s.id = ?
        LIMIT 1`,
      [id],
    );
    if (!session) return res.status(404).json({ error: { message: 'Not found' } });

    const [[hasRec]] = await pool.query(
      `SELECT 1 AS ok
         FROM session_recordings
        WHERE live_session_id = ?
          AND recording_url IS NOT NULL
        LIMIT 1`,
      [id],
    );
    if (!hasRec?.ok) return res.status(400).json({ error: { message: 'Upload a recording URL first' } });

    await pool.query(
      `UPDATE live_sessions
          SET recording_state = 'ready', recording_ready_at = NOW()
        WHERE id = ?`,
      [id],
    );

    const [sent] = await pool.query(
      'SELECT 1 FROM live_session_notification_log WHERE live_session_id = ? AND notification_type = ? LIMIT 1',
      [id, 'recording'],
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
      const dashUrl = `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/dashboard`;
      const bodyHtml = buildBrandedEmailHtml({
        title: 'Recording is ready',
        preheader: `Recording is ready for ${session.course_title}.`,
        contentHtml: `<p>Your recording is ready.</p>
<p><strong>Course:</strong> ${session.course_title}</p>
${session.session_title ? `<p><strong>Session:</strong> ${session.session_title}</p>` : ''}
<p><strong>Date:</strong> ${session.scheduled_at}</p>`,
        ctaLabel: 'Open dashboard',
        ctaUrl: dashUrl,
      });
      await enqueueBulkEmail({
        toEmails,
        subject: 'Recording is ready',
        bodyText: `Your recording is ready.\nCourse: ${session.course_title}\nSession: ${session.session_title ?? ''}\nDate: ${session.scheduled_at}`,
        bodyHtml,
      });
      const [uids] = await pool.query(
        `SELECT DISTINCT e.user_id
           FROM enrollments e
          WHERE e.course_id = ? AND e.status = 'active' AND e.expiry_date >= CURDATE()`,
        [session.course_id],
      );
      const userIds = (uids ?? []).map((u) => Number(u.user_id)).filter((n) => Number.isFinite(n) && n > 0);
      enqueuePushForUsers({
        userIds,
        title: 'Recording available',
        body: `Recording is ready for ${session.course_title}.`,
        url: session.course_slug ? `/live-sessions/${encodeURIComponent(session.course_slug)}` : '/live-sessions',
        tag: `live_session:${id}:recording_ready`,
        data: { live_session_id: id, course_id: session.course_id },
      }).catch(() => null);
      await pool.query(
        'INSERT IGNORE INTO live_session_notification_log (live_session_id, notification_type) VALUES (?, ?)',
        [id, 'recording'],
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
