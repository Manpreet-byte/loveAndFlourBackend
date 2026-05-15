import { z } from 'zod';
import { pool } from '../config/db.js';

const listSchema = z.object({
  status: z.enum(['pending', 'sent', 'failed']).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export async function adminEmailOutboxStats(_req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT
        SUM(status = 'pending') AS pending,
        SUM(status = 'failed') AS failed,
        SUM(status = 'sent') AS sent,
        MAX(CASE WHEN status IN ('pending','failed') THEN created_at ELSE NULL END) AS newest_queued_at,
        MIN(CASE WHEN status IN ('pending','failed') THEN created_at ELSE NULL END) AS oldest_queued_at
      FROM email_outbox`,
    );
    return res.json({
      stats: {
        pending: Number(row?.pending ?? 0),
        failed: Number(row?.failed ?? 0),
        sent: Number(row?.sent ?? 0),
        newest_queued_at: row?.newest_queued_at ?? null,
        oldest_queued_at: row?.oldest_queued_at ?? null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function adminListEmailOutbox(req, res, next) {
  try {
    const query = listSchema.parse(req.query ?? {});
    const where = [];
    const values = [];

    if (query.status) {
      where.push('status = ?');
      values.push(query.status);
    }
    if (query.q) {
      where.push('(to_email LIKE ? OR subject LIKE ?)');
      values.push(`%${query.q}%`, `%${query.q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, to_email, subject, status, attempts, last_error, scheduled_at, next_attempt_at, sent_at, created_at, updated_at
         FROM email_outbox
         ${whereSql}
     ORDER BY id DESC
        LIMIT ?
       OFFSET ?`,
      [...values, query.limit, query.offset],
    );
    return res.json({ outbox: rows ?? [], limit: query.limit, offset: query.offset });
  } catch (err) {
    return next(err);
  }
}

export async function adminResendEmailOutbox(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid id' } });

    const [[row]] = await pool.query('SELECT id, status FROM email_outbox WHERE id = ? LIMIT 1', [id]);
    if (!row) return res.status(404).json({ error: { message: 'Not found' } });

    await pool.query(
      `UPDATE email_outbox
          SET status = 'pending',
              attempts = 0,
              last_error = NULL,
              scheduled_at = NULL,
              next_attempt_at = NOW(),
              sent_at = NULL,
              provider_message_id = NULL,
              provider_response = NULL
        WHERE id = ?`,
      [id],
    );

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

