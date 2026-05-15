import { z } from 'zod';
import { pool } from '../config/db.js';
import { enqueueBulkEmail } from '../services/emailOutbox.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const broadcastSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  body_text: z.string().trim().min(1).max(20000),
  body_html: z.string().optional().nullable(),
  // for now: only newsletter subscribers
  audience: z.enum(['newsletter']).optional().default('newsletter'),
});

export async function adminBroadcastEmail(req, res, next) {
  try {
    const payload = broadcastSchema.parse(req.body ?? {});

    const [subs] = await pool.query(
      `SELECT email
         FROM newsletter_subscribers
        WHERE status = 'subscribed'
     ORDER BY id DESC
        LIMIT 20000`,
    );
    const toEmails = (subs ?? []).map((r) => String(r.email ?? '').trim()).filter(Boolean);
    if (!toEmails.length) return res.status(400).json({ error: { message: 'No newsletter subscribers found' } });

    await pool.query(
      `INSERT INTO notification_jobs (job_type, channel, subject, body_text, body_html, audience_json, status, created_by_admin_id)
       VALUES ('broadcast', 'email', ?, ?, ?, ?, 'processing', ?)`,
      [payload.subject, payload.body_text, payload.body_html ?? null, JSON.stringify({ audience: payload.audience, count: toEmails.length }), req.user.id],
    );

    await enqueueBulkEmail({
      toEmails,
      subject: payload.subject,
      bodyText: payload.body_text,
      bodyHtml: payload.body_html ?? null,
    });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'BROADCAST_EMAIL_ENQUEUE',
      entityType: 'notification_job',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { audience: payload.audience, recipients: toEmails.length },
    });

    return res.json({ ok: true, queued: toEmails.length });
  } catch (err) {
    return next(err);
  }
}

