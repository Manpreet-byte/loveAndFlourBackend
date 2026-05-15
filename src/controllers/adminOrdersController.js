import { z } from 'zod';
import { pool } from '../config/db.js';
import { withTransaction } from '../utils/dbTx.js';
import { listOrderItems, markOrderPaid } from '../models/orderModel.js';
import { createPayment, listPaymentsForOrder, markPaymentCaptured } from '../models/paymentModel.js';
import { fulfillPaidOrder } from '../services/payments/orderFulfillment.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { createRazorpayRefund } from '../services/payments/razorpayRefundClient.js';

const listSchema = z.object({
  status: z.string().optional().nullable(),
  q: z.string().optional().nullable(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const updateSchema = z.object({
  status: z.enum(['payment_pending', 'paid', 'failed', 'refunded', 'cancelled']).optional(),
  reconciliation_status: z.enum(['unreconciled', 'reconciled', 'needs_review']).optional().nullable(),
  reconciliation_notes: z.string().max(5000).optional().nullable(),
});

const refundSchema = z.object({
  amount_cents: z.coerce.number().int().positive(),
  reason: z.string().max(255).optional().nullable(),
});

function clampLike(s) {
  const v = String(s ?? '').trim();
  if (!v) return null;
  return `%${v.slice(0, 120)}%`;
}

export async function adminListOrders(req, res, next) {
  try {
    const { status, q, page, limit } = listSchema.parse(req.query);
    const offset = (page - 1) * limit;
    const where = [];
    const params = [];
    if (status) {
      where.push('o.status = ?');
      params.push(String(status));
    }
    const like = clampLike(q);
    if (like) {
      where.push('(CAST(o.id AS CHAR) LIKE ? OR u.email LIKE ? OR u.name LIKE ?)');
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM orders o
         JOIN users u ON u.id = o.user_id
        ${whereSql}`,
      params,
    );

    const [rows] = await pool.query(
      `SELECT o.id, o.user_id, u.email, u.name, o.status, o.currency, o.total_cents, o.created_at, o.updated_at
         FROM orders o
         JOIN users u ON u.id = o.user_id
        ${whereSql}
     ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.json({
      page,
      limit,
      total: Number(countRow?.total ?? 0),
      orders: rows,
    });
  } catch (err) {
    return next(err);
  }
}

export async function adminGetOrder(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid order id' } });
    const [rows] = await pool.query(
      `SELECT o.*, u.email, u.name
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.id = ?
        LIMIT 1`,
      [id],
    );
    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
    const [items, payments] = await Promise.all([listOrderItems({ orderId: id }), listPaymentsForOrder({ orderId: id })]);
    const [reconRows] = await pool.query(
      'SELECT status, notes, created_at, updated_at FROM payment_reconciliation WHERE order_id = ? LIMIT 1',
      [id],
    );
    const reconciliation = reconRows?.[0] ?? null;
    return res.json({ order, items, payments, reconciliation });
  } catch (err) {
    return next(err);
  }
}

export async function adminUpdateOrder(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid order id' } });
    const payload = updateSchema.parse(req.body ?? {});

    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
      const order = rows?.[0];
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      if (payload.reconciliation_status !== undefined || payload.reconciliation_notes !== undefined) {
        const reconStatus = payload.reconciliation_status ?? 'unreconciled';
        const reconNotes = payload.reconciliation_notes ?? null;
        await conn.query(
          `INSERT INTO payment_reconciliation (order_id, status, notes)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
          [id, reconStatus, reconNotes],
        );
      }

      if (payload.status === 'paid' && order.status !== 'paid') {
        // Manual "mark paid" flow: create/mark a manual captured payment and fulfill the order.
        const paymentId = await createPayment(
          {
            orderId: id,
            userId: order.user_id,
            provider: 'manual',
            currency: order.currency,
            amountCents: order.total_cents,
            status: 'pending',
          },
          { conn },
        );
        await markPaymentCaptured({ paymentId, providerPaymentId: `manual_${id}`, rawPayloadJson: null }, { conn });
        await markOrderPaid({ orderId: id }, { conn });
        const [itemRows] = await conn.query(
          'SELECT item_type, course_id FROM order_items WHERE order_id = ? ORDER BY id ASC',
          [id],
        );
        await fulfillPaidOrder({ conn, order: { id, user_id: order.user_id }, orderItems: itemRows });
        logAuditEvent({
          actorType: 'admin',
          actorId: req.user.id,
          actionType: 'ORDER_MARK_PAID',
          entityType: 'order',
          entityId: id,
          ...getRequestAuditContext(req),
          statusCode: 200,
        });
      } else if (payload.status && payload.status !== order.status) {
        await conn.query('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [payload.status, id]);
        logAuditEvent({
          actorType: 'admin',
          actorId: req.user.id,
          actionType: 'ORDER_STATUS_UPDATE',
          entityType: 'order',
          entityId: id,
          ...getRequestAuditContext(req),
          statusCode: 200,
          metadata: { from: order.status, to: payload.status },
        });
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminRefundOrder(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid order id' } });
    const payload = refundSchema.parse(req.body ?? {});

    let providerRefund = null;
    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT id, user_id, status, currency, total_cents FROM orders WHERE id = ? FOR UPDATE', [id]);
      const order = rows?.[0];
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }
      const amount = Math.min(Number(payload.amount_cents), Number(order.total_cents));

      const [pRows] = await conn.query(
        `SELECT id, provider, provider_payment_id
           FROM payments
          WHERE order_id = ?
            AND status = 'captured'
       ORDER BY id DESC
          LIMIT 1
          FOR UPDATE`,
        [id],
      );
      const payment = pRows?.[0] ?? null;
      if (!payment) {
        const err = new Error('No captured payment found for this order');
        err.status = 400;
        throw err;
      }
      if (String(payment.provider) !== 'razorpay') {
        const err = new Error(`Refund not supported for provider: ${payment.provider}`);
        err.status = 400;
        throw err;
      }
      if (!payment.provider_payment_id) {
        const err = new Error('Missing Razorpay payment id (provider_payment_id). Refund cannot be created.');
        err.status = 400;
        throw err;
      }

      const [ins] = await conn.query(
        `INSERT INTO refunds (order_id, payment_id, amount_cents, currency, reason, status)
         VALUES (?, ?, ?, ?, ?, 'requested')`,
        [id, payment.id, amount, order.currency, payload.reason ?? null],
      );
      const refundId = ins?.insertId ?? null;

      providerRefund = await createRazorpayRefund({
        providerPaymentId: payment.provider_payment_id,
        amountPaise: amount > 0 ? amount : null,
        notes: { internal_order_id: String(id), internal_refund_id: refundId ? String(refundId) : undefined },
      });

      await conn.query(
        `UPDATE refunds
            SET status = 'processed',
                provider_refund_id = ?,
                processed_at = NOW(),
                metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.provider_status', ?, '$.provider_payload', CAST(? AS JSON))
          WHERE id = ?`,
        [String(providerRefund?.id ?? ''), String(providerRefund?.status ?? ''), JSON.stringify(providerRefund ?? {}), refundId],
      );

      await conn.query("UPDATE orders SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
      await conn.query("UPDATE payments SET status = 'refunded', refunded_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [payment.id]);

      logAuditEvent({
        actorType: 'admin',
        actorId: req.user.id,
        actionType: 'ORDER_REFUND',
        entityType: 'order',
        entityId: id,
        ...getRequestAuditContext(req),
        statusCode: 200,
        metadata: { amount_cents: amount, reason: payload.reason ?? null, provider: 'razorpay', provider_refund_id: providerRefund?.id ?? null },
      });
    });

    return res.json({ ok: true, provider_refund: providerRefund ? { id: providerRefund.id, status: providerRefund.status } : null });
  } catch (err) {
    return next(err);
  }
}

export async function adminDownloadInvoice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid order id' } });
    const [rows] = await pool.query(
      `SELECT o.id, o.currency, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.status, o.created_at,
              o.billing_name, o.billing_email, o.billing_phone, o.billing_gst_number,
              u.email AS user_email, u.name AS user_name
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.id = ?
        LIMIT 1`,
      [id],
    );
    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
    const items = await listOrderItems({ orderId: id });

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice #${order.id}</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; padding:24px; color:#2e241b;}
    h1{margin:0 0 6px 0;}
    .muted{color:rgba(46,36,27,.68)}
    table{width:100%; border-collapse:collapse; margin-top:14px}
    th,td{border-bottom:1px solid rgba(99,77,55,.14); padding:10px 8px; text-align:left}
    th{background:rgba(0,0,0,.03)}
    .right{text-align:right}
    .box{border:1px solid rgba(99,77,55,.14); border-radius:14px; padding:14px; margin-top:14px}
  </style>
</head>
<body>
  <h1>Invoice</h1>
  <div class="muted">Order #${order.id} • ${String(order.created_at)} • Status: ${order.status}</div>
  <div class="box">
    <strong>Billed to</strong><br/>
    ${order.billing_name ?? order.user_name ?? ''}<br/>
    ${order.billing_email ?? order.user_email ?? ''}<br/>
    ${order.billing_phone ?? ''}<br/>
    ${order.billing_gst_number ? `GST: ${order.billing_gst_number}<br/>` : ''}
  </div>
  <table>
    <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Total</th></tr></thead>
    <tbody>
      ${items
        .map(
          (it) =>
            `<tr><td>${it.title}</td><td class="right">${it.quantity}</td><td class="right">${(
              Number(it.line_total_cents) / 100
            ).toFixed(2)} ${order.currency}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <div class="box">
    <div class="right">Subtotal: ${(Number(order.subtotal_cents) / 100).toFixed(2)} ${order.currency}</div>
    <div class="right">Discount: ${(Number(order.discount_cents) / 100).toFixed(2)} ${order.currency}</div>
    <div class="right">Tax: ${(Number(order.tax_cents) / 100).toFixed(2)} ${order.currency}</div>
    <div class="right"><strong>Total: ${(Number(order.total_cents) / 100).toFixed(2)} ${order.currency}</strong></div>
  </div>
</body>
</html>`;

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="invoice-${order.id}.html"`);
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}
