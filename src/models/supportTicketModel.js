import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createTicket(
  { userId, category, subject, messageText },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO support_tickets (user_id, category, subject, status, priority)
     VALUES (?, ?, ?, 'open', 'normal')`,
    [userId, category, subject],
  );
  const ticketId = result.insertId;
  await db.query(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message_text)
     VALUES (?, 'user', ?, ?)`,
    [ticketId, userId, messageText],
  );
  return ticketId;
}

export async function listTicketsForUser({ userId, limit = 30, cursor = null }, { conn } = {}) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const cursorId = cursor ? Number(cursor) : null;
  const [rows] = await db.query(
    `SELECT t.id, t.category, t.subject, t.status, t.priority, t.assigned_admin_id, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count,
            (SELECT MAX(m2.created_at) FROM support_messages m2 WHERE m2.ticket_id = t.id) AS last_message_at
       FROM support_tickets t
      WHERE t.user_id = ?
        ${cursorId ? 'AND t.id < ?' : ''}
   ORDER BY t.id DESC
      LIMIT ?`,
    cursorId ? [userId, cursorId, safeLimit] : [userId, safeLimit],
  );
  const nextCursor = rows.length === safeLimit ? rows[rows.length - 1]?.id : null;
  return { tickets: rows, next_cursor: nextCursor };
}

export async function getTicketForUser({ userId, ticketId }, { conn } = {}) {
  const db = pickConn(conn);
  const [[ticket]] = await db.query(
    `SELECT id, user_id, category, subject, status, priority, assigned_admin_id, created_at, updated_at
       FROM support_tickets
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [ticketId, userId],
  );
  if (!ticket) return null;
  const [messages] = await db.query(
    `SELECT id, ticket_id, sender_type, sender_id, message_text, attachment_url, created_at
       FROM support_messages
      WHERE ticket_id = ?
   ORDER BY id ASC
      LIMIT 2000`,
    [ticketId],
  );
  return { ticket, messages };
}

export async function addUserMessage({ userId, ticketId, messageText }, { conn } = {}) {
  const db = pickConn(conn);
  const [[ticket]] = await db.query(
    `SELECT id, status
       FROM support_tickets
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [ticketId, userId],
  );
  if (!ticket) return { ok: false, status: 404, message: 'Ticket not found' };
  if (ticket.status === 'closed') return { ok: false, status: 400, message: 'Ticket is closed' };
  const [result] = await db.query(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message_text)
     VALUES (?, 'user', ?, ?)`,
    [ticketId, userId, messageText],
  );
  return { ok: true, messageId: result.insertId };
}

export async function listTicketsAdmin(
  { status = null, category = null, q = null, page = 1, limit = 25 },
  { conn } = {},
) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  const where = [];
  const values = [];
  if (status) {
    where.push('t.status = ?');
    values.push(status);
  }
  if (category) {
    where.push('t.category = ?');
    values.push(category);
  }
  if (q) {
    where.push('(t.subject LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR CAST(t.id AS CHAR) = ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, String(q));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ${whereSql}`,
    values,
  );

  const [rows] = await db.query(
    `SELECT t.id, t.user_id, u.name AS user_name, u.email AS user_email,
            t.category, t.subject, t.status, t.priority, t.assigned_admin_id,
            t.created_at, t.updated_at,
            (SELECT MAX(m.created_at) FROM support_messages m WHERE m.ticket_id = t.id) AS last_message_at
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ${whereSql}
   ORDER BY FIELD(t.priority,'urgent','high','normal','low') ASC, t.updated_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...values, safeLimit, offset],
  );

  return { tickets: rows, total: Number(countRow?.total ?? 0), page: safePage, limit: safeLimit };
}

export async function getTicketAdmin({ ticketId }, { conn } = {}) {
  const db = pickConn(conn);
  const [[ticket]] = await db.query(
    `SELECT t.id, t.user_id, u.name AS user_name, u.email AS user_email,
            t.category, t.subject, t.status, t.priority, t.assigned_admin_id, t.created_at, t.updated_at
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
      LIMIT 1`,
    [ticketId],
  );
  if (!ticket) return null;
  const [messages] = await db.query(
    `SELECT id, ticket_id, sender_type, sender_id, message_text, attachment_url, created_at
       FROM support_messages
      WHERE ticket_id = ?
   ORDER BY id ASC
      LIMIT 4000`,
    [ticketId],
  );
  return { ticket, messages };
}

export async function addAdminMessage({ adminId, ticketId, messageText }, { conn } = {}) {
  const db = pickConn(conn);
  const [[ticket]] = await db.query(`SELECT id, status, user_id FROM support_tickets WHERE id = ? LIMIT 1`, [ticketId]);
  if (!ticket) return { ok: false, status: 404, message: 'Ticket not found' };
  if (ticket.status === 'closed') return { ok: false, status: 400, message: 'Ticket is closed' };
  const [result] = await db.query(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message_text)
     VALUES (?, 'admin', ?, ?)`,
    [ticketId, adminId, messageText],
  );
  // If open, move to pending (waiting for user) after admin reply.
  if (ticket.status === 'open') {
    await db.query(`UPDATE support_tickets SET status = 'pending' WHERE id = ?`, [ticketId]);
  }
  return { ok: true, messageId: result.insertId, userId: Number(ticket.user_id) };
}

export async function adminUpdateTicket(
  { ticketId, status, priority, assignedAdminId },
  { conn } = {},
) {
  const db = pickConn(conn);
  const fields = [];
  const values = [];
  if (status !== undefined) {
    fields.push('status = ?');
    values.push(status);
  }
  if (priority !== undefined) {
    fields.push('priority = ?');
    values.push(priority);
  }
  if (assignedAdminId !== undefined) {
    fields.push('assigned_admin_id = ?');
    values.push(assignedAdminId);
  }
  if (!fields.length) return;
  values.push(ticketId);
  await db.query(`UPDATE support_tickets SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function supportAnalytics({ days = 30 } = {}) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const [[counts]] = await pool.query(
    `SELECT
        SUM(status = 'open') AS open_tickets,
        SUM(status = 'pending') AS pending_tickets,
        SUM(status = 'resolved') AS resolved_tickets,
        SUM(status = 'closed') AS closed_tickets
       FROM support_tickets
      WHERE created_at >= (NOW() - INTERVAL ? DAY)`,
    [safeDays],
  );

  const [cats] = await pool.query(
    `SELECT category, COUNT(*) AS cnt
       FROM support_tickets
      WHERE created_at >= (NOW() - INTERVAL ? DAY)
   GROUP BY category
   ORDER BY cnt DESC`,
    [safeDays],
  );

  // Average first response time (admin message - first user message), in minutes.
  const [[sla]] = await pool.query(
    `SELECT AVG(TIMESTAMPDIFF(MINUTE, first_user.created_at, first_admin.created_at)) AS avg_first_response_min
       FROM support_tickets t
       JOIN (
         SELECT ticket_id, MIN(created_at) AS created_at
           FROM support_messages
          WHERE sender_type = 'user'
       GROUP BY ticket_id
       ) first_user ON first_user.ticket_id = t.id
       JOIN (
         SELECT ticket_id, MIN(created_at) AS created_at
           FROM support_messages
          WHERE sender_type = 'admin'
       GROUP BY ticket_id
       ) first_admin ON first_admin.ticket_id = t.id
      WHERE t.created_at >= (NOW() - INTERVAL ? DAY)`,
    [safeDays],
  );

  return {
    counts: {
      open: Number(counts?.open_tickets ?? 0),
      pending: Number(counts?.pending_tickets ?? 0),
      resolved: Number(counts?.resolved_tickets ?? 0),
      closed: Number(counts?.closed_tickets ?? 0),
    },
    top_categories: cats.map((r) => ({ category: r.category, count: Number(r.cnt ?? 0) })),
    avg_first_response_minutes: sla?.avg_first_response_min == null ? null : Number(sla.avg_first_response_min),
    window_days: safeDays,
  };
}

