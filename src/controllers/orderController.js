import { z } from 'zod';
import { pool } from '../config/db.js';
import { env } from '../utils/env.js';
import { withTransaction } from '../utils/dbTx.js';
import { createOrder, findOrderByIdForUser, listOrderItems } from '../models/orderModel.js';
import { createPayment, listPaymentsForOrder, updatePaymentProviderOrder } from '../models/paymentModel.js';
import { parseCheckoutRequest, computeCheckout } from '../services/checkoutService.js';
import { createRazorpayOrder } from '../services/payments/razorpayClient.js';
import { notifyAdmins } from '../services/notificationService.js';
import { getRazorpayRuntimeConfig } from '../services/payments/razorpayConfigService.js';

const orderIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

async function assertNotAlreadyEnrolled({ userId, courseIds }) {
  const [rows] = await pool.query(
    `SELECT course_id
       FROM enrollments
      WHERE user_id = ?
        AND status = 'active'
        AND expiry_date >= CURDATE()
        AND course_id IN (?)`,
    [userId, courseIds],
  );
  if (rows?.length) {
    const err = new Error('Already enrolled in one or more selected courses');
    err.status = 409;
    err.details = { already_enrolled_course_ids: rows.map((r) => Number(r.course_id)) };
    throw err;
  }
}

export async function createCheckoutOrder(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = parseCheckoutRequest(req.body);

    const courseIds = [...new Set(payload.items.map((i) => Number(i.course_id)))];
    await assertNotAlreadyEnrolled({ userId, courseIds });

    const couponCode = payload.coupon_code ? String(payload.coupon_code).trim().toUpperCase() : null;
    const quote = await computeCheckout({ userId, items: payload.items, couponCode });

    const billing = payload.billing ?? null;
    const orderId = await withTransaction(async (conn) => {
      const id = await createOrder(
        {
          userId,
          currency: quote.currency,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          taxCents: quote.taxCents,
          totalCents: quote.totalCents,
          couponId: quote.coupon?.id ?? null,
          couponCode: quote.coupon?.code ?? null,
          billing: {
            name: billing?.name ?? null,
            email: billing?.email ?? null,
            phone: billing?.phone ?? null,
            gstNumber: billing?.gst_number ?? null,
            addressJson: billing?.address ? JSON.stringify(billing.address) : null,
          },
        },
        { conn },
      );

      // Order items (snapshots).
      const values = quote.items.map((it) => ({
        courseId: it.courseId,
        title: it.title,
        currency: it.currency,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
        lineSubtotalCents: it.lineSubtotalCents,
        lineDiscountCents: it.lineDiscountCents,
        lineTaxCents: it.lineTaxCents,
        lineTotalCents: it.lineTotalCents,
      }));
      // Inline insert to avoid pulling extra model function for now.
      if (values.length) {
        const insertValues = values.map((it) => [
          id,
          'course',
          it.courseId,
          it.title,
          it.currency,
          it.unitPriceCents,
          it.quantity,
          it.lineSubtotalCents,
          it.lineDiscountCents,
          it.lineTaxCents,
          it.lineTotalCents,
          null,
        ]);
        await conn.query(
          `INSERT INTO order_items
            (order_id, item_type, course_id, title, currency, unit_price_cents, quantity,
             line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents, metadata_json)
           VALUES ?`,
          [insertValues],
        );
      }

      // Payment record (provider-agnostic)
      const paymentId = await createPayment(
        {
          orderId: id,
          userId,
          provider: payload.provider,
          currency: quote.currency,
          amountCents: quote.totalCents,
          status: 'initiated',
        },
        { conn },
      );

      return { orderId: id, paymentId };
    });

    // Admin realtime notifications: order started/created
    notifyAdmins({
      notificationType: 'admin_new_order',
      title: `New order #${orderId.orderId}`,
      message: `Checkout started by user #${userId}. Total: ${quote.currency} ${(quote.totalCents / 100).toFixed(2)}.`,
      linkUrl: '/admin/dashboard',
      metadata: { order_id: orderId.orderId, user_id: userId, total_cents: quote.totalCents, currency: quote.currency },
    }).catch(() => {});

    // Create provider-side order AFTER committing internal order (avoids holding DB tx during external call).
    const amountPaise = quote.totalCents;
    const receipt = `order_${orderId.orderId}`;
    const rp = await createRazorpayOrder({
      amountPaise,
      currency: quote.currency,
      receipt,
      notes: {
        internal_order_id: String(orderId.orderId),
        user_id: String(userId),
      },
    });

    await updatePaymentProviderOrder({ paymentId: orderId.paymentId, providerOrderId: rp.id });
    const rpCfg = await getRazorpayRuntimeConfig();

    return res.status(201).json({
      order: {
        id: orderId.orderId,
        currency: quote.currency,
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
        status: 'payment_pending',
      },
      items: quote.items.map((it) => ({
        courseId: it.courseId,
        title: it.title,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
      })),
      payment: {
        id: orderId.paymentId,
        provider: 'razorpay',
        currency: quote.currency,
        amountCents: quote.totalCents,
        razorpayKeyId: rpCfg.keyId,
        razorpayOrderId: rp.id,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function getMyOrder(req, res, next) {
  try {
    const { id } = orderIdSchema.parse(req.params);
    const userId = req.user.id;
    const order = await findOrderByIdForUser({ orderId: id, userId });
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
    const items = await listOrderItems({ orderId: id });
    const payments = await listPaymentsForOrder({ orderId: id });
    return res.json({ order, items, payments });
  } catch (err) {
    return next(err);
  }
}
