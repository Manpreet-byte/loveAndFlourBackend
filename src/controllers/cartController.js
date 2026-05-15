import { z } from 'zod';
import { pool } from '../config/db.js';

const upsertSchema = z.object({
  items: z
    .array(
      z.object({
        course_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(10).default(1),
      }),
    )
    .max(50)
    .default([]),
});

async function ensureCartId({ userId }) {
  const [rows] = await pool.query('SELECT id FROM carts WHERE user_id = ? LIMIT 1', [userId]);
  if (rows?.[0]?.id) return Number(rows[0].id);
  const [result] = await pool.query('INSERT INTO carts (user_id) VALUES (?)', [userId]);
  return Number(result.insertId);
}

export async function getCart(req, res, next) {
  try {
    const userId = req.user.id;
    const cartId = await ensureCartId({ userId });
    const [rows] = await pool.query(
      `SELECT ci.id, ci.course_id, ci.quantity,
              c.title, c.slug, c.featured_image_url,
              cp.currency, cp.amount_cents
         FROM cart_items ci
         JOIN courses c ON c.id = ci.course_id
    LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
        WHERE ci.cart_id = ?
     ORDER BY ci.updated_at DESC`,
      [cartId],
    );
    return res.json({ cart: { id: cartId, items: rows } });
  } catch (err) {
    return next(err);
  }
}

export async function upsertCart(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = upsertSchema.parse(req.body ?? {});
    const cartId = await ensureCartId({ userId });

    // Replace cart contents (simple foundation).
    await pool.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
    const items = (payload.items ?? []).map((it) => [cartId, it.course_id, it.quantity]);
    if (items.length) {
      await pool.query('INSERT INTO cart_items (cart_id, course_id, quantity) VALUES ?', [items]);
    }
    return getCart(req, res, next);
  } catch (err) {
    return next(err);
  }
}

export async function deleteCartItem(req, res, next) {
  try {
    const userId = req.user.id;
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: { message: 'Invalid cart item id' } });
    const cartId = await ensureCartId({ userId });
    await pool.query('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', [itemId, cartId]);
    return getCart(req, res, next);
  } catch (err) {
    return next(err);
  }
}

