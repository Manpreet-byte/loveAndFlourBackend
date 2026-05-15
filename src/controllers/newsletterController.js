import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const subscribeSchema = z.object({
  email: z.string().trim().email().max(254),
});

export async function subscribe(req, res, next) {
  try {
    const { email } = subscribeSchema.parse(req.body ?? {});
    const normalized = String(email).trim().toLowerCase();
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, status)
       VALUES (?, 'subscribed')
       ON DUPLICATE KEY UPDATE status = 'subscribed', subscribed_at = CURRENT_TIMESTAMP`,
      [normalized],
    );
    logAuditEvent({
      actorType: 'system',
      actorId: null,
      actionType: 'NEWSLETTER_SUBSCRIBE',
      entityType: 'newsletter',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 201,
      metadata: { email: normalized },
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

