import { pool } from '../config/db.js';
import { enqueueBulkEmail } from './emailOutbox.js';
import { buildBrandedEmailHtml } from './emailTemplates.js';
import { env } from '../utils/env.js';
import { enqueuePushForUsers } from './push/pushOutboxService.js';

const REMINDER_TYPES = {
  REMINDER_24H: 'reminder_24h',
  REMINDER_1H: 'reminder_1h',
};

function getReminderWindowMinutes(reminderType) {
  if (reminderType === REMINDER_TYPES.REMINDER_24H) return { min: 23 * 60, max: 24 * 60 };
  if (reminderType === REMINDER_TYPES.REMINDER_1H) return { min: 0, max: 60 };
  throw new Error(`Unknown reminder type: ${reminderType}`);
}

async function listEligibleSessions(reminderType) {
  const { min, max } = getReminderWindowMinutes(reminderType);
  const [rows] = await pool.query(
    `SELECT s.id AS live_session_id,
            s.course_id,
            s.title AS session_title,
            s.zoom_join_url,
            s.scheduled_at,
            c.title AS course_title
       FROM live_sessions s
       JOIN courses c ON c.id = s.course_id
      WHERE s.status = 'upcoming'
        AND s.scheduled_at > NOW()
        AND TIMESTAMPDIFF(MINUTE, NOW(), s.scheduled_at) BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1
            FROM live_session_notification_log l
           WHERE l.live_session_id = s.id AND l.notification_type = ?
        )
      ORDER BY s.scheduled_at ASC
      LIMIT 50`,
    [min, max, reminderType],
  );
  return rows;
}

async function listEnrolledUserEmails(courseId) {
  const [rows] = await pool.query(
    `SELECT u.email
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
      WHERE e.course_id = ?
        AND e.status = 'active'
        AND e.expiry_date >= CURDATE()`,
    [courseId],
  );
  return rows.map((r) => r.email).filter(Boolean);
}

async function listEnrolledUserIds(courseId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT e.user_id
       FROM enrollments e
      WHERE e.course_id = ?
        AND e.status = 'active'
        AND e.expiry_date >= CURDATE()`,
    [courseId],
  );
  return (rows ?? []).map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n) && n > 0);
}

function buildReminderEmail({ reminderType, courseTitle, sessionTitle, scheduledAt, zoomJoinUrl }) {
  const is24h = reminderType === REMINDER_TYPES.REMINDER_24H;
  const whenText = is24h ? 'in ~24 hours' : 'in ~1 hour';
  const subject = `Reminder: ${courseTitle}${sessionTitle ? ` — ${sessionTitle}` : ''} (${whenText})`;

  const bodyText = [
    `Course: ${courseTitle}`,
    sessionTitle ? `Session: ${sessionTitle}` : null,
    `Scheduled at: ${new Date(scheduledAt).toISOString()}`,
    zoomJoinUrl ? `Zoom link: ${zoomJoinUrl}` : null,
    '',
    'If you can’t access the link, please login to your dashboard and check your enrollment validity.',
  ]
    .filter(Boolean)
    .join('\n');

  const rawHtml = `
    <p><strong>Course:</strong> ${courseTitle}</p>
    ${sessionTitle ? `<p><strong>Session:</strong> ${sessionTitle}</p>` : ''}
    <p><strong>Scheduled at:</strong> ${new Date(scheduledAt).toISOString()}</p>
    ${zoomJoinUrl ? `<p><strong>Zoom link:</strong> <a href="${zoomJoinUrl}">${zoomJoinUrl}</a></p>` : ''}
    <p>If you can’t access the link, please login to your dashboard and check your enrollment validity.</p>
  `.trim();

  const dashboardUrl = `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/dashboard`;
  const bodyHtml = buildBrandedEmailHtml({
    title: subject,
    preheader: bodyText.split('\n').find((l) => l.trim()) ?? '',
    contentHtml: rawHtml,
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl,
  });

  return { subject, bodyText, bodyHtml };
}

export async function processLiveSessionReminders({ reminderType }) {
  const sessions = await listEligibleSessions(reminderType);
  for (const session of sessions) {
    const [result] = await pool.query(
      'INSERT IGNORE INTO live_session_notification_log (live_session_id, notification_type) VALUES (?, ?)',
      [session.live_session_id, reminderType],
    );
    if (!result?.affectedRows) continue;

    const toEmails = await listEnrolledUserEmails(session.course_id);
    if (!toEmails.length) continue;

    const { subject, bodyText, bodyHtml } = buildReminderEmail({
      reminderType,
      courseTitle: session.course_title,
      sessionTitle: session.session_title,
      scheduledAt: session.scheduled_at,
      zoomJoinUrl: session.zoom_join_url,
    });

    await enqueueBulkEmail({ toEmails, subject, bodyText, bodyHtml });

    const userIds = await listEnrolledUserIds(session.course_id);
    await enqueuePushForUsers({
      userIds,
      title: subject,
      body: zoomJoinUrl ? `Tap to open the Zoom link.` : `Your session starts soon.`,
      url: '/live-sessions',
      tag: `live_session:${session.live_session_id}:${reminderType}`,
      data: { live_session_id: session.live_session_id, course_id: session.course_id },
    });
  }
}

export { REMINDER_TYPES };
