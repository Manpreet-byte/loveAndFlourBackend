import { z } from 'zod';
import { computeCheckout } from '../services/checkoutService.js';

const validateSchema = z.object({
  coupon_code: z.string().trim().min(1).max(60),
  items: z
    .array(
      z.object({
        course_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(10).default(1),
      }),
    )
    .min(1)
    .max(20),
});

export async function validateCoupon(req, res, next) {
  try {
    const userId = req.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const payload = validateSchema.parse(req.body ?? {});

    try {
      const quote = await computeCheckout({ userId, items: payload.items, couponCode: payload.coupon_code });
      return res.json({
        valid: true,
        discount_amount: Number(quote.discountCents ?? 0),
        final_total: Number(quote.totalCents ?? 0),
        currency: quote.currency,
        breakdown: {
          subtotal: Number(quote.subtotalCents ?? 0),
          bulk_discount: Number(quote.bulkDiscountCents ?? 0),
          coupon_discount: Number(quote.couponDiscountCents ?? 0),
          tax: Number(quote.taxCents ?? 0),
        },
        message: quote.coupon ? `Coupon ${quote.coupon.code} applied.` : 'Discount applied.',
      });
    } catch (err) {
      if (err?.status === 400 || err?.status === 404 || err?.status === 409) {
        return res.json({
          valid: false,
          discount_amount: 0,
          final_total: null,
          message: err?.message ?? 'Invalid coupon',
        });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
}

