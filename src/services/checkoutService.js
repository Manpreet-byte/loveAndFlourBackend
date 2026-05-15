import { z } from 'zod';
import { pool } from '../config/db.js';
import { findActiveCouponByCode, countCouponUsages, countCouponUsagesForUser } from '../models/couponModel.js';
import { findBulkDiscountRuleForQty } from '../models/discountRuleModel.js';

const checkoutSchema = z.object({
  provider: z.enum(['razorpay']).default('razorpay'),
  items: z
    .array(
      z.object({
        course_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(10).default(1),
      }),
    )
    .min(1)
    .max(20),
  coupon_code: z.string().trim().min(1).max(60).optional().nullable(),
  billing: z
    .object({
      name: z.string().trim().min(1).max(160).optional().nullable(),
      email: z.string().trim().email().max(254).optional().nullable(),
      phone: z.string().trim().min(7).max(40).optional().nullable(),
      gst_number: z.string().trim().min(5).max(32).optional().nullable(),
      address: z.any().optional().nullable(),
    })
    .optional()
    .nullable(),
});

function normalizeCoupon(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase();
}

export function parseCheckoutRequest(body) {
  return checkoutSchema.parse(body);
}

export async function computeCheckout({ userId, items, couponCode }) {
  const courseIds = [...new Set(items.map((i) => i.course_id))];
  const [rows] = await pool.query(
    `SELECT c.id, c.title, c.is_published,
            cp.currency, cp.amount_cents
       FROM courses c
  LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
      WHERE c.id IN (?)`,
    [courseIds],
  );

  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const missing = courseIds.filter((id) => !byId.has(Number(id)));
  if (missing.length) {
    const err = new Error('One or more courses not found');
    err.status = 404;
    err.details = { missing_course_ids: missing };
    throw err;
  }

  const lineItems = [];
  for (const item of items) {
    const course = byId.get(Number(item.course_id));
    if (!course.is_published) {
      const err = new Error('One or more courses are not available for purchase');
      err.status = 400;
      err.details = { course_id: item.course_id };
      throw err;
    }
    if (!course.amount_cents || !course.currency) {
      const err = new Error('One or more courses have no active price');
      err.status = 400;
      err.details = { course_id: item.course_id };
      throw err;
    }
    const quantity = Number(item.quantity ?? 1);
    const unitPriceCents = Number(course.amount_cents);
    const lineSubtotalCents = unitPriceCents * quantity;
    lineItems.push({
      courseId: Number(course.id),
      title: course.title,
      currency: course.currency,
      unitPriceCents,
      quantity,
      lineSubtotalCents,
    });
  }

  const currency = lineItems[0].currency;
  if (lineItems.some((li) => li.currency !== currency)) {
    const err = new Error('Mixed-currency checkout is not supported');
    err.status = 400;
    throw err;
  }

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.lineSubtotalCents, 0);
  let bulkDiscountCents = 0;
  let couponDiscountCents = 0;
  let discountCents = 0;
  let coupon = null;

  const totalQty = lineItems.reduce((sum, li) => sum + Number(li.quantity ?? 1), 0);
  // Bulk discount engine:
  // - Uses DB-configured rules if present.
  // - Falls back to legacy defaults if no rule matches (keeps existing behavior).
  try {
    const rule = await findBulkDiscountRuleForQty({ qty: totalQty });
    if (rule && rule.discount_percent != null) {
      const pct = Math.min(100, Math.max(0, Number(rule.discount_percent)));
      bulkDiscountCents = Math.floor((subtotalCents * pct) / 100);
    } else {
      // Legacy defaults:
      // 3–5 courses → 15%, 6+ → 20%
      if (totalQty >= 3 && totalQty <= 5) bulkDiscountCents = Math.floor((subtotalCents * 15) / 100);
      else if (totalQty >= 6) bulkDiscountCents = Math.floor((subtotalCents * 20) / 100);
    }
  } catch {
    // Do not fail checkout if discounts table is missing or DB compat hasn't run yet.
    if (totalQty >= 3 && totalQty <= 5) bulkDiscountCents = Math.floor((subtotalCents * 15) / 100);
    else if (totalQty >= 6) bulkDiscountCents = Math.floor((subtotalCents * 20) / 100);
  }

  if (couponCode) {
    const code = normalizeCoupon(couponCode);
    coupon = await findActiveCouponByCode(code);
    if (!coupon) {
      const err = new Error('Invalid coupon');
      err.status = 400;
      throw err;
    }
    if (coupon.currency && coupon.currency !== currency) {
      const err = new Error('Coupon currency mismatch');
      err.status = 400;
      throw err;
    }
    if (coupon.starts_at && new Date(coupon.starts_at).getTime() > Date.now()) {
      const err = new Error('Coupon not active yet');
      err.status = 400;
      throw err;
    }
    if (coupon.ends_at && new Date(coupon.ends_at).getTime() < Date.now()) {
      const err = new Error('Coupon expired');
      err.status = 400;
      throw err;
    }
    if (coupon.min_order_total_cents != null && subtotalCents < Number(coupon.min_order_total_cents)) {
      const err = new Error('Order total does not meet coupon minimum');
      err.status = 400;
      throw err;
    }
    if (coupon.max_redemptions != null) {
      const used = await countCouponUsages({ couponId: coupon.id });
      if (used >= Number(coupon.max_redemptions)) {
        const err = new Error('Coupon redemption limit reached');
        err.status = 400;
        throw err;
      }
    }
    if (coupon.max_redemptions_per_user != null) {
      const usedByUser = await countCouponUsagesForUser({ couponId: coupon.id, userId });
      if (usedByUser >= Number(coupon.max_redemptions_per_user)) {
        const err = new Error('Coupon usage limit reached for this account');
        err.status = 400;
        throw err;
      }
    }

    const discountedBase = Math.max(0, subtotalCents - bulkDiscountCents);
    if (coupon.discount_type === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(coupon.discount_percent ?? 0)));
      couponDiscountCents = Math.floor((discountedBase * pct) / 100);
    } else {
      couponDiscountCents = Math.min(discountedBase, Number(coupon.discount_value_cents ?? 0));
    }
  }

  discountCents = Math.min(subtotalCents, bulkDiscountCents + couponDiscountCents);
  const taxCents = 0; // GST-ready: compute later based on GST rules + place of supply.
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents);

  const finalizedItems = lineItems.map((li) => ({
    ...li,
    lineDiscountCents: 0,
    lineTaxCents: 0,
    lineTotalCents: li.lineSubtotalCents, // item-level discount allocation can be added later
  }));

  return {
    currency,
    items: finalizedItems,
    subtotalCents,
    discountCents,
    bulkDiscountCents,
    couponDiscountCents,
    taxCents,
    totalCents,
    coupon,
  };
}
