import { z } from 'zod';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { notifyUser } from '../services/notificationService.js';
import {
  addAdminMessage,
  adminUpdateTicket,
  getTicketAdmin,
  listTicketsAdmin,
  supportAnalytics,
} from '../models/supportTicketModel.js';

const listSchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function adminListTickets(req, res, next) {
  try {
    const q = listSchema.parse(req.query);
    const data = await listTicketsAdmin({
      status: q.status ?? null,
      category: q.category ?? null,
      q: q.q ?? null,
      page: q.page ?? 1,
      limit: q.limit ?? 25,
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function adminGetTicket(req, res, next) {
  try {
    const { id } = idSchema.parse(req.params);
    const thread = await getTicketAdmin({ ticketId: id });
    if (!thread) return res.status(404).json({ error: { message: 'Ticket not found' } });
    return res.json(thread);
  } catch (err) {
    return next(err);
  }
}

const patchSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigned_admin_id: z.coerce.number().int().positive().nullable().optional(),
});

export async function adminPatchTicket(req, res, next) {
  try {
    const adminId = req.user.id;
    const { id } = idSchema.parse(req.params);
    const payload = patchSchema.parse(req.body ?? {});
    await adminUpdateTicket({
      ticketId: id,
      status: payload.status,
      priority: payload.priority,
      assignedAdminId: payload.assigned_admin_id,
    });

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'support_ticket.update',
      entityType: 'support_ticket',
      entityId: id,
      metadata: payload,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      method: ctx.method,
      path: ctx.path,
      statusCode: 200,
    });

    const thread = await getTicketAdmin({ ticketId: id });
    if (thread?.ticket?.user_id && payload.status) {
      notifyUser({
        userId: Number(thread.ticket.user_id),
        notificationType: 'support_ticket_status',
        title: 'Support ticket updated',
        message: `Your ticket #${id} is now ${payload.status}.`,
        linkUrl: `/support/${id}`,
        metadata: { ticket_id: id, status: payload.status },
      }).catch(() => null);
    }

    return res.json(thread ?? { ok: true });
  } catch (err) {
    return next(err);
  }
}

const messageSchema = z.object({ message_text: z.string().trim().min(2).max(8000) });

export async function adminPostMessage(req, res, next) {
  try {
    const adminId = req.user.id;
    const { id } = idSchema.parse(req.params);
    const payload = messageSchema.parse(req.body ?? {});
    const result = await addAdminMessage({ adminId, ticketId: id, messageText: payload.message_text });
    if (!result.ok) return res.status(result.status).json({ error: { message: result.message } });

    notifyUser({
      userId: result.userId,
      notificationType: 'support_ticket_replied',
      title: 'Support replied',
      message: `We replied to your ticket #${id}.`,
      linkUrl: `/support/${id}`,
      metadata: { ticket_id: id },
    }).catch(() => null);

    const thread = await getTicketAdmin({ ticketId: id });
    return res.status(201).json(thread ?? { ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminSupportAnalytics(req, res, next) {
  try {
    const days = Number(req.query.days ?? 30);
    const data = await supportAnalytics({ days });
    return res.json({ analytics: data });
  } catch (err) {
    return next(err);
  }
}

