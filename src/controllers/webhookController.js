import { env } from '../utils/env.js';
import { withTransaction } from '../utils/dbTx.js';
import { sha256 } from '../utils/crypto.js';
import { verifyRazorpayWebhookSignature } from '../services/payments/razorpayWebhook.js';
import { insertWebhookEvent, markWebhookProcessed } from '../models/webhookEventModel.js';
import { findPaymentByProviderOrder, markPaymentCaptured, markPaymentFailed } from '../models/paymentModel.js';
import { findOrderById, markOrderFailed, markOrderPaid } from '../models/orderModel.js';
import { fulfillPaidOrder } from '../services/payments/orderFulfillment.js';
import { recordCouponUsage } from '../models/couponModel.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { notifyUser } from '../services/notificationService.js';
import { enqueuePushForUser } from '../services/push/pushOutboxService.js';
import { enqueueEmail } from '../services/emailOutbox.js';
import { buildBrandedEmailHtml } from '../services/emailTemplates.js';

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

function getRazorpayPaymentEntity(body) {
  return body?.payload?.payment?.entity ?? null;
}

export async function razorpayWebhook(req, res, next) {
  try {
    const rawBody = req.body; // Buffer via express.raw
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: { message: 'Invalid webhook body' } });
    }

    const signature = req.headers['x-razorpay-signature'];
    const ok = await verifyRazorpayWebhookSignature({ rawBody, signatureHeader: signature });
    if (!ok) return res.status(401).json({ error: { message: 'Invalid signature' } });

    const body = parseJsonBody(rawBody);
    if (!body) return res.status(400).json({ error: { message: 'Invalid JSON' } });

    const eventType = String(body.event ?? '').trim();
    const eventId = body.id ? String(body.id) : null;
    const eventHash = sha256(rawBody);
    const payloadJson = rawBody.toString('utf8');

    const inserted = await insertWebhookEvent({
      provider: 'razorpay',
      eventId,
      eventHash,
      eventType,
      payloadJson,
    });

    // Idempotency: already received this exact event payload.
    if (!inserted) return res.json({ ok: true });

    // Process inside a DB tx to ensure order+payment+enrollment consistency.
    await withTransaction(async (conn) => {
      const entity = getRazorpayPaymentEntity(body);
      const providerOrderId = entity?.order_id ? String(entity.order_id) : null;
      const providerPaymentId = entity?.id ? String(entity.id) : null;
      const providerStatus = entity?.status ? String(entity.status) : null;
      const amountPaise = Number(entity?.amount ?? 0);
      const currency = entity?.currency ? String(entity.currency) : null;

      if (!providerOrderId) {
        await markWebhookProcessed(
          { provider: 'razorpay', eventHash, status: 'failed', errorMessage: 'Missing provider order_id' },
          { conn },
        );
        return;
      }

      const payment = await findPaymentByProviderOrder(
        { provider: 'razorpay', providerOrderId },
        { conn, forUpdate: true },
      );
      if (!payment) {
        await markWebhookProcessed(
          { provider: 'razorpay', eventHash, status: 'failed', errorMessage: 'Payment not found for provider order' },
          { conn },
        );
        return;
      }

      const order = await findOrderById({ orderId: payment.order_id }, { conn, forUpdate: true });
      if (!order) {
        await markWebhookProcessed(
          { provider: 'razorpay', eventHash, status: 'failed', errorMessage: 'Order not found for payment' },
          { conn },
        );
        return;
      }

      const rawPayloadJson = payloadJson;

      // Amount validation (Razorpay amounts are in smallest unit).
      if (currency && String(currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
        await markWebhookProcessed(
          { provider: 'razorpay', eventHash, status: 'failed', errorMessage: 'Currency mismatch' },
          { conn },
        );
        return;
      }
      if (Number(amountPaise) !== Number(payment.amount_cents)) {
        await markWebhookProcessed(
          { provider: 'razorpay', eventHash, status: 'failed', errorMessage: 'Amount mismatch' },
          { conn },
        );
        return;
      }

      if (eventType === 'payment.captured' || providerStatus === 'captured') {
        await markPaymentCaptured(
          { paymentId: payment.id, providerPaymentId, providerSignature: null, rawPayloadJson },
          { conn },
        );
        await markOrderPaid({ orderId: order.id }, { conn });

        const [itemRows] = await conn.query(
          'SELECT item_type, course_id FROM order_items WHERE order_id = ? ORDER BY id ASC',
          [order.id],
        );
        await fulfillPaidOrder({ conn, order, orderItems: itemRows });

        // Email: order confirmation (idempotent via order_notification_log).
        try {
          const [ins] = await conn.query(
            `INSERT IGNORE INTO order_notification_log (order_id, notification_type)
             VALUES (?, 'order_confirmation_email')`,
            [order.id],
          );
          if (ins?.affectedRows) {
            const [[userRow]] = await conn.query('SELECT email, name FROM users WHERE id = ? LIMIT 1', [order.user_id]);
            const toEmail = String(userRow?.email ?? '').trim();
            if (toEmail) {
              const [itemsFull] = await conn.query(
                `SELECT oi.title, oi.quantity, oi.line_total_cents, oi.currency
                   FROM order_items oi
                  WHERE oi.order_id = ?
               ORDER BY oi.id ASC`,
                [order.id],
              );
              const currency = order.currency ?? itemsFull?.[0]?.currency ?? 'INR';
              const totalCents = Number(order.total_cents ?? payment.amount_cents ?? 0);
              const itemsHtml = (itemsFull ?? [])
                .map(
                  (it) =>
                    `<tr>
                      <td style="padding:8px 0;">${String(it.title ?? '')}</td>
                      <td style="padding:8px 0;text-align:center;">${Number(it.quantity ?? 1)}</td>
                      <td style="padding:8px 0;text-align:right;">${(Number(it.line_total_cents ?? 0) / 100).toFixed(2)} ${currency}</td>
                    </tr>`,
                )
                .join('');

              const dashboardUrl = `/orders/${order.id}`;
              const bodyHtml = buildBrandedEmailHtml({
                title: `Order confirmed (#${order.id})`,
                preheader: 'Your payment was successful. Access is now unlocked.',
                contentHtml: `<p>Hi ${String(userRow?.name ?? 'there')},</p>
<p>Your payment was successful and your order is confirmed.</p>
<p><strong>Order ID:</strong> #${order.id}</p>
<table style="width:100%;border-collapse:collapse;margin-top:10px;">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.08);">Item</th>
      <th style="text-align:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.08);">Qty</th>
      <th style="text-align:right;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.08);">Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemsHtml || ''}
    <tr>
      <td colspan="2" style="padding:10px 0;text-align:right;border-top:1px solid rgba(0,0,0,0.08);"><strong>Grand total</strong></td>
      <td style="padding:10px 0;text-align:right;border-top:1px solid rgba(0,0,0,0.08);"><strong>${(totalCents / 100).toFixed(2)} ${currency}</strong></td>
    </tr>
  </tbody>
</table>
<p style="margin-top:14px;">You can view your order and access details in your dashboard.</p>`,
                ctaLabel: 'View order',
                ctaUrl: `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}${dashboardUrl}`,
                footerText: 'If you did not make this purchase, please contact support immediately.',
              });

              await enqueueEmail({
                toEmail,
                subject: `Order confirmed (#${order.id})`,
                bodyText: `Order #${order.id} confirmed. Total: ${(totalCents / 100).toFixed(2)} ${currency}. View: ${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}${dashboardUrl}`,
                bodyHtml,
              });
            }
          }
        } catch {
          // Best-effort: do not fail webhook processing if email enqueue fails.
        }

        if (order.coupon_id) {
          await recordCouponUsage({ couponId: order.coupon_id, userId: order.user_id, orderId: order.id }, { conn });
        }

        // In-app notification: payment success.
        notifyUser(
          {
            userId: order.user_id,
            notificationType: 'payment_confirmed',
            title: 'Payment confirmed',
            message: `Your order #${order.id} was confirmed. Your access is now unlocked.`,
            linkUrl: `/orders/${order.id}`,
            metadata: { order_id: order.id, provider: 'razorpay' },
          },
          { conn },
        ).catch(() => null);

        enqueuePushForUser({
          userId: order.user_id,
          title: 'Payment confirmed',
          body: `Order #${order.id} confirmed. Access unlocked.`,
          url: `/orders/${order.id}`,
          tag: `order:${order.id}`,
        }).catch(() => null);

        await markWebhookProcessed({ provider: 'razorpay', eventHash, status: 'processed' }, { conn });
        logAuditEvent({
          actorType: 'system',
          actorId: null,
          actionType: 'PAYMENT_CAPTURED',
          entityType: 'order',
          entityId: order.id,
          ...getRequestAuditContext(req),
          statusCode: 200,
          metadata: { provider: 'razorpay', provider_order_id: providerOrderId, provider_payment_id: providerPaymentId },
        });
        return;
      }

      if (eventType === 'payment.failed' || providerStatus === 'failed') {
        await markPaymentFailed({ paymentId: payment.id, rawPayloadJson }, { conn });
        await markOrderFailed({ orderId: order.id }, { conn });
        await markWebhookProcessed({ provider: 'razorpay', eventHash, status: 'processed' }, { conn });
        notifyUser(
          {
            userId: order.user_id,
            notificationType: 'payment_failed',
            title: 'Payment failed',
            message: `Your order #${order.id} payment failed. You can retry from your orders page.`,
            linkUrl: `/orders/${order.id}`,
            metadata: { order_id: order.id, provider: 'razorpay' },
          },
          { conn },
        ).catch(() => null);
        logAuditEvent({
          actorType: 'system',
          actorId: null,
          actionType: 'PAYMENT_FAILED',
          entityType: 'order',
          entityId: order.id,
          ...getRequestAuditContext(req),
          statusCode: 200,
          metadata: { provider: 'razorpay', provider_order_id: providerOrderId, provider_payment_id: providerPaymentId },
        });
        return;
      }

      // Unhandled event types: keep audit trail, but skip processing.
      await markWebhookProcessed({ provider: 'razorpay', eventHash, status: 'skipped' }, { conn });
    });

    // Unreachable (we always return above), but keep for clarity.
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
