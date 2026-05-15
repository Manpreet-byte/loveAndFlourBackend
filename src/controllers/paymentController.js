import { z } from 'zod';
import { pool } from '../config/db.js';
import { hmacSha256Hex, safeEqual } from '../utils/crypto.js';
import { createCheckoutOrder } from './orderController.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';
import { getRazorpayRuntimeConfig } from '../services/payments/razorpayConfigService.js';

const verifySchema = z.object({
  orderId: z.coerce.number().int().positive(),
  razorpay_order_id: z.string().trim().min(1).max(64),
  razorpay_payment_id: z.string().trim().min(1).max(64),
  razorpay_signature: z.string().trim().min(1).max(256),
});

export async function checkout(req, res, next) {
  // Alias to existing orders checkout controller (non-breaking).
  return createCheckoutOrder(req, res, next);
}

export async function verify(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = verifySchema.parse(req.body ?? {});

    const cfg = await getRazorpayRuntimeConfig();
    if (!cfg.keySecret) {
      return res.status(500).json({ error: { message: 'Razorpay is not configured' } });
    }

    // Ensure the order belongs to the requesting user.
    const [orderRows] = await pool.query('SELECT id, user_id, status FROM orders WHERE id = ? LIMIT 1', [payload.orderId]);
    const order = orderRows?.[0];
    if (!order || Number(order.user_id) !== Number(userId)) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    // Get the latest payment for this order and verify provider order id matches.
    const [payRows] = await pool.query(
      `SELECT id, provider, status, provider_order_id
         FROM payments
        WHERE order_id = ?
     ORDER BY id DESC
        LIMIT 1`,
      [payload.orderId],
    );
    const payment = payRows?.[0];
    if (!payment || payment.provider !== 'razorpay') {
      return res.status(400).json({ error: { message: 'Payment not found for order' } });
    }
    if (String(payment.provider_order_id ?? '') !== String(payload.razorpay_order_id)) {
      return res.status(400).json({ error: { message: 'Provider order mismatch' } });
    }

    // Razorpay signature: sha256(order_id|payment_id, key_secret)
    const expected = hmacSha256Hex(cfg.keySecret, `${payload.razorpay_order_id}|${payload.razorpay_payment_id}`);
    const ok = safeEqual(expected, payload.razorpay_signature);
    if (!ok) return res.status(401).json({ error: { message: 'Invalid signature' } });

    // Store provider payment reference and signature; do NOT mark paid here.
    try {
      await pool.query(
        `UPDATE payments
            SET provider_payment_id = COALESCE(?, provider_payment_id),
                provider_signature = COALESCE(?, provider_signature),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [payload.razorpay_payment_id, payload.razorpay_signature, payment.id],
      );
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
      await pool.query(
        `UPDATE payments
            SET provider_payment_id = COALESCE(?, provider_payment_id),
                metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()),
                                        '$.razorpay_signature', COALESCE(?, JSON_EXTRACT(COALESCE(metadata_json, JSON_OBJECT()), '$.razorpay_signature')))
          WHERE id = ?`,
        [payload.razorpay_payment_id, payload.razorpay_signature, payment.id],
      );
    }

    return res.json({ ok: true, orderId: payload.orderId, status: order.status });
  } catch (err) {
    return next(err);
  }
}
