import { z } from 'zod';
import { listAuditLogs } from '../models/auditLogModel.js';

const querySchema = z.object({
  actor_id: z.coerce.number().int().positive().optional().nullable(),
  actor_type: z.enum(['user', 'admin', 'system']).optional().nullable(),
  action_type: z.string().trim().min(1).max(40).optional().nullable(),
  entity_type: z.string().trim().min(1).max(40).optional().nullable(),
  from: z.string().trim().min(1).max(20).optional().nullable(), // YYYY-MM-DD
  to: z.string().trim().min(1).max(20).optional().nullable(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function adminListAuditLogs(req, res, next) {
  try {
    const q = querySchema.parse(req.query);
    const data = await listAuditLogs({
      actorId: q.actor_id ?? null,
      actorType: q.actor_type ?? null,
      actionType: q.action_type ?? null,
      entityType: q.entity_type ?? null,
      from: q.from ?? null,
      to: q.to ?? null,
      page: q.page,
      limit: q.limit,
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

