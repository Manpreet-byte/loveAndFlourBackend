import { z } from 'zod';
import { pool } from '../config/db.js';
import { enqueuePushForUsers } from '../services/push/pushOutboxService.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const schema = z.object({
  audience: z.enum(['all_users', 'course_enrolled']).default('all_users'),
  course_id: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(280),
  url: z.string().trim().max(255).optional().nullable(),
});

export async function adminSendPush(req, res, next) {
  try {
    const payload = schema.parse(req.body ?? {});

    let userIds = [];
    if (payload.audience === 'all_users') {
      const [rows] = await pool.query(`SELECT id FROM users LIMIT 50000`);
      userIds = (rows ?? []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    } else if (payload.audience === 'course_enrolled') {
      if (!payload.course_id) return res.status(400).json({ error: { message: 'course_id is required for this audience' } });
      const [rows] = await pool.query(
        `SELECT DISTINCT e.user_id
           FROM enrollments e
          WHERE e.course_id = ?
            AND e.status = 'active'
            AND e.expiry_date >= CURDATE()`,
        [payload.course_id],
      );
      userIds = (rows ?? []).map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n) && n > 0);
    }

    const result = await enqueuePushForUsers({
      userIds,
      title: payload.title,
      body: payload.body,
      url: payload.url ?? '/',
      tag: `admin_push:${Date.now()}`,
      data: { audience: payload.audience, course_id: payload.course_id ?? null },
    });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'PUSH_BROADCAST_ENQUEUE',
      entityType: 'push_outbox',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { audience: payload.audience, course_id: payload.course_id ?? null, queued: result.queued ?? 0 },
    });

    return res.json({ ok: true, queued: result.queued ?? 0 });
  } catch (err) {
    return next(err);
  }
}

