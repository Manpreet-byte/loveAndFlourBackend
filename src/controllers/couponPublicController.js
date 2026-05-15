import { z } from 'zod';
import { findActiveCouponByCode } from '../models/couponModel.js';

const codeSchema = z.object({
  code: z.string().trim().min(1).max(60),
});

export async function getCouponByCode(req, res, next) {
  try {
    const { code } = codeSchema.parse(req.params);
    const normalized = String(code).trim().toUpperCase();
    const coupon = await findActiveCouponByCode(normalized);
    if (!coupon) return res.status(404).json({ error: { message: 'Coupon not found' } });
    return res.json({
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value_cents: coupon.discount_value_cents,
        discount_percent: coupon.discount_percent,
        currency: coupon.currency,
        min_order_total_cents: coupon.min_order_total_cents,
        starts_at: coupon.starts_at,
        ends_at: coupon.ends_at,
        is_active: coupon.is_active,
      },
    });
  } catch (err) {
    return next(err);
  }
}

