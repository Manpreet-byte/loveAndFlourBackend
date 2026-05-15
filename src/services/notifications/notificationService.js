import { enqueueEmail } from '../emailOutbox.js';
import { renderTemplate, EMAIL_TEMPLATES } from './templates.js';
import { createNotification } from '../../models/notificationModel.js';

function safeJson(obj) {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return '{}';
  }
}

export async function handleEventToNotifications({ eventId, eventType, payload }, { conn } = {}) {
  // Minimal set of event handlers; extend incrementally.
  if (eventType === 'user_registered') {
    if (!payload?.user_id || !payload?.email || !payload?.verify_url) return;
    const rendered = renderTemplate(EMAIL_TEMPLATES.user_registered_verify_email, { verify_url: payload.verify_url });
    await createNotification(
      {
        userId: payload.user_id,
        type: 'email',
        eventType,
        eventId,
        title: rendered.subject,
        message: rendered.text ?? rendered.subject,
        metadataJson: safeJson({ to: payload.email, subject: rendered.subject, text: rendered.text, html: rendered.html }),
      },
      { conn },
    );
    return;
  }

  if (eventType === 'course_enrolled') {
    if (!payload?.user_id || !payload?.email || !payload?.course_id) return;
    const rendered = renderTemplate(EMAIL_TEMPLATES.course_enrolled_zoom_access, {
      user_name: payload.user_name ?? 'there',
      session_lines: payload.session_lines ?? '',
      expiry_date: payload.expiry_date ?? '',
    });
    await createNotification(
      {
        userId: payload.user_id,
        type: 'email',
        eventType,
        eventId,
        title: rendered.subject,
        message: rendered.text ?? rendered.subject,
        metadataJson: safeJson({ to: payload.email, subject: rendered.subject, text: rendered.text, html: rendered.html }),
      },
      { conn },
    );
    return;
  }

  if (eventType === 'certificate_issued') {
    if (!payload?.user_id || !payload?.email || !payload?.course_title || !payload?.verification_code) return;
    const rendered = renderTemplate(EMAIL_TEMPLATES.certificate_issued, {
      user_name: payload.user_name ?? 'there',
      course_title: payload.course_title,
      verification_code: payload.verification_code,
    });
    await createNotification(
      {
        userId: payload.user_id,
        type: 'email',
        eventType,
        eventId,
        title: rendered.subject,
        message: rendered.text ?? rendered.subject,
        metadataJson: safeJson({ to: payload.email, subject: rendered.subject, text: rendered.text, html: rendered.html }),
      },
      { conn },
    );
    return;
  }
}

export async function deliverEmailNotificationRow(row) {
  let meta = {};
  try {
    meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
  } catch {
    meta = {};
  }
  const toEmail = meta.to;
  const subject = meta.subject ?? row.title;
  const bodyText = meta.text ?? row.message;
  const bodyHtml = meta.html ?? null;

  if (!toEmail) {
    const err = new Error('Missing recipient');
    err.status = 500;
    throw err;
  }

  // Bridge: use existing email outbox queue.
  await enqueueEmail({ toEmail, subject, bodyText, bodyHtml });
}
