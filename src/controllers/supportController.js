import { z } from 'zod';
import { pool } from '../config/db.js';
import { logAuditEvent, getRequestAuditContext } from '../services/auditLogService.js';
import { notifyUser } from '../services/notificationService.js';
import { textToHtml } from '../utils/textToHtml.js';
import {
  addUserMessage,
  createTicket,
  getTicketForUser,
  listTicketsForUser,
} from '../models/supportTicketModel.js';

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce.number().int().positive().optional().nullable(),
});

export async function listMyTickets(req, res, next) {
  try {
    const userId = req.user.id;
    const { limit, cursor } = listSchema.parse(req.query);
    const data = await listTicketsForUser({ userId, limit: limit ?? 30, cursor: cursor ?? null });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

const createSchema = z.object({
  category: z.enum(['payment', 'access', 'technical', 'certificate', 'live_workshop', 'refund', 'other']).default('other'),
  subject: z.string().trim().min(3).max(255),
  message_text: z.string().trim().min(3).max(8000),
});

export async function createMyTicket(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const payload = createSchema.parse(req.body ?? {});
    await conn.beginTransaction();

    const ticketId = await createTicket(
      { userId, category: payload.category, subject: payload.subject, messageText: payload.message_text },
      { conn },
    );

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'user',
      actorId: userId,
      actionType: 'support_ticket.create',
      entityType: 'support_ticket',
      entityId: ticketId,
      metadata: { category: payload.category },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      method: ctx.method,
      path: ctx.path,
      statusCode: 201,
    });

    await conn.commit();
    const thread = await getTicketForUser({ userId, ticketId });
    return res.status(201).json(thread ?? { ticket_id: ticketId });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return next(err);
  } finally {
    conn.release();
  }
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function getMyTicket(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = idSchema.parse(req.params);
    const thread = await getTicketForUser({ userId, ticketId: id });
    if (!thread) return res.status(404).json({ error: { message: 'Ticket not found' } });
    return res.json(thread);
  } catch (err) {
    return next(err);
  }
}

const messageSchema = z.object({ message_text: z.string().trim().min(2).max(8000) });

export async function postMyTicketMessage(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = idSchema.parse(req.params);
    const payload = messageSchema.parse(req.body ?? {});
    const result = await addUserMessage({ userId, ticketId: id, messageText: payload.message_text });
    if (!result.ok) return res.status(result.status).json({ error: { message: result.message } });

    // Optional: add a lightweight in-app notification to self as "ticket updated" (history breadcrumb).
    notifyUser({
      userId,
      notificationType: 'support_ticket_updated',
      title: 'Support ticket updated',
      message: `We received your message on ticket #${id}.`,
      linkUrl: `/support/${id}`,
      metadata: { ticket_id: id },
    }).catch(() => null);

    const thread = await getTicketForUser({ userId, ticketId: id });
    return res.status(201).json(thread ?? { ok: true });
  } catch (err) {
    return next(err);
  }
}

