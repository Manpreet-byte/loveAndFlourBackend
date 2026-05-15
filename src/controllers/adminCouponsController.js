import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { toMysqlDatetime } from '../utils/datetime.js';

const listSchema = z.object({
  q: z.string().optional().nullable(),
  active: z.coerce.boolean().optional().nullable(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const createSchema = z.object({
  code: z.string().trim().min(2).max(64),
  description: z.string().max(255).optional().nullable(),
  discount_type: z.enum(['amount', 'percent']).default('amount'),
  discount_value_cents: z.coerce.number().int().nonnegative().optional().nullable(),
  discount_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  currency: z.string().trim().min(3).max(3).default('INR'),
  max_redemptions: z.coerce.number().int().positive().optional().nullable(),
  max_redemptions_per_user: z.coerce.number().int().positive().optional().nullable(),
  min_order_total_cents: z.coerce.number().int().nonnegative().optional().nullable(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  is_active: z.coerce.boolean().default(true),
});

const updateSchema = createSchema.partial().omit({ code: true }).extend({
  code: z.string().trim().min(2).max(64).optional(),
});

function normalizeCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase();
}

export async function adminListCoupons(req, res, next) {
  try {
    const { q, active, limit } = listSchema.parse(req.query);
    const where = [];
    const params = [];
    if (active != null) {
      where.push('is_active = ?');
      params.push(active ? 1 : 0);
    }
    if (q) {
      where.push('(code LIKE ? OR description LIKE ?)');
      const like = `%${String(q).trim().slice(0, 120)}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, code, description, discount_type, discount_value_cents, discount_percent, currency,
              max_redemptions, max_redemptions_per_user, min_order_total_cents,
              starts_at, ends_at, is_active, created_at, updated_at
         FROM coupons
        ${whereSql}
     ORDER BY created_at DESC
        LIMIT ?`,
      [...params, limit],
    );
    return res.json({ coupons: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateCoupon(req, res, next) {
  try {
    const payload = createSchema.parse(req.body ?? {});
    const code = normalizeCode(payload.code);
    const startsAt = payload.starts_at ? toMysqlDatetime(payload.starts_at) : null;
    const endsAt = payload.ends_at ? toMysqlDatetime(payload.ends_at) : null;
    if (payload.discount_type === 'amount' && (payload.discount_value_cents == null || payload.discount_value_cents <= 0)) {
      return res.status(400).json({ error: { message: 'discount_value_cents required for amount coupons' } });
    }
    if (payload.discount_type === 'percent' && (payload.discount_percent == null || payload.discount_percent <= 0)) {
      return res.status(400).json({ error: { message: 'discount_percent required for percent coupons' } });
    }

    const [result] = await pool.query(
      `INSERT INTO coupons
        (code, description, discount_type, discount_value_cents, discount_percent, currency,
         max_redemptions, max_redemptions_per_user, min_order_total_cents,
         starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        payload.description ?? null,
        payload.discount_type,
        payload.discount_value_cents ?? null,
        payload.discount_percent ?? null,
        payload.currency,
        payload.max_redemptions ?? null,
        payload.max_redemptions_per_user ?? null,
        payload.min_order_total_cents ?? null,
        startsAt,
        endsAt,
        payload.is_active ? 1 : 0,
      ],
    );

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'COUPON_CREATE',
      entityType: 'coupon',
      entityId: result.insertId,
      ...getRequestAuditContext(req),
      statusCode: 201,
      metadata: { code },
    });

    return res.status(201).json({ coupon_id: result.insertId });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: { message: 'Coupon code already exists' } });
    return next(err);
  }
}

export async function adminUpdateCoupon(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid coupon id' } });
    const payload = updateSchema.parse(req.body ?? {});

    const fields = [];
    const values = [];
    const push = (col, val) => {
      fields.push(`${col} = ?`);
      values.push(val);
    };

    if (payload.code !== undefined) push('code', normalizeCode(payload.code));
    if (payload.description !== undefined) push('description', payload.description ?? null);
    if (payload.discount_type !== undefined) push('discount_type', payload.discount_type);
    if (payload.discount_value_cents !== undefined) push('discount_value_cents', payload.discount_value_cents ?? null);
    if (payload.discount_percent !== undefined) push('discount_percent', payload.discount_percent ?? null);
    if (payload.currency !== undefined) push('currency', payload.currency);
    if (payload.max_redemptions !== undefined) push('max_redemptions', payload.max_redemptions ?? null);
    if (payload.max_redemptions_per_user !== undefined) push('max_redemptions_per_user', payload.max_redemptions_per_user ?? null);
    if (payload.min_order_total_cents !== undefined) push('min_order_total_cents', payload.min_order_total_cents ?? null);
    if (payload.starts_at !== undefined) push('starts_at', payload.starts_at ? toMysqlDatetime(payload.starts_at) : null);
    if (payload.ends_at !== undefined) push('ends_at', payload.ends_at ? toMysqlDatetime(payload.ends_at) : null);
    if (payload.is_active !== undefined) push('is_active', payload.is_active ? 1 : 0);

    if (!fields.length) return res.json({ ok: true });

    values.push(id);
    const [result] = await pool.query(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`, values);
    if (!result.affectedRows) return res.status(404).json({ error: { message: 'Coupon not found' } });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'COUPON_UPDATE',
      entityType: 'coupon',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: { message: 'Coupon code already exists' } });
    return next(err);
  }
}

export async function adminDeleteCoupon(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid coupon id' } });
    const [result] = await pool.query('DELETE FROM coupons WHERE id = ? LIMIT 1', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: { message: 'Coupon not found' } });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'COUPON_DELETE',
      entityType: 'coupon',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

