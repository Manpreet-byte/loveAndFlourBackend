import { pool } from '../config/db.js';
import { z } from 'zod';
import { findOrderByIdForUser, listOrderItems } from '../models/orderModel.js';
import { listPaymentsForOrder } from '../models/paymentModel.js';

const orderIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function formatMoney(cents, currency) {
  const amount = Number(cents ?? 0) / 100;
  return `${amount.toFixed(2)} ${currency ?? 'INR'}`;
}

function buildInvoiceHtml({ order, items, user }) {
  return `<!doctype html>
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
    ${order.billing_name ?? user?.name ?? ''}<br/>
    ${order.billing_email ?? user?.email ?? ''}<br/>
    ${order.billing_phone ?? ''}<br/>
    ${order.billing_gst_number ? `GST: ${order.billing_gst_number}<br/>` : ''}
  </div>
  <table>
    <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Total</th></tr></thead>
    <tbody>
      ${items
        .map(
          (it) =>
            `<tr><td>${it.title}</td><td class="right">${it.quantity}</td><td class="right">${formatMoney(
              it.line_total_cents,
              order.currency,
            )}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <div class="box">
    <div class="right">Subtotal: ${formatMoney(order.subtotal_cents, order.currency)}</div>
    <div class="right">Discount: ${formatMoney(order.discount_cents, order.currency)}</div>
    <div class="right">Tax: ${formatMoney(order.tax_cents, order.currency)}</div>
    <div class="right"><strong>Total: ${formatMoney(order.total_cents, order.currency)}</strong></div>
  </div>
</body>
</html>`;
}

export async function listMyOrders(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT id, status, currency, total_cents, created_at
         FROM orders
        WHERE user_id = ?
     ORDER BY created_at DESC
        LIMIT 500`,
      [userId],
    );
    return res.json({ orders: rows });
  } catch (err) {
    return next(err);
  }
}

export async function getMyOrder(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = orderIdSchema.parse(req.params);
    const order = await findOrderByIdForUser({ orderId: id, userId });
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
    const items = await listOrderItems({ orderId: id });
    const payments = await listPaymentsForOrder({ orderId: id });
    return res.json({ order, items, payments });
  } catch (err) {
    return next(err);
  }
}

export async function downloadMyInvoice(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = orderIdSchema.parse(req.params);
    const [rows] = await pool.query(
      `SELECT o.id, o.user_id, o.currency, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.status, o.created_at,
              o.billing_name, o.billing_email, o.billing_phone, o.billing_gst_number,
              u.email AS user_email, u.name AS user_name
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.id = ? AND o.user_id = ?
        LIMIT 1`,
      [id, userId],
    );
    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
    const items = await listOrderItems({ orderId: id });
    const html = buildInvoiceHtml({ order, items, user: { name: order.user_name, email: order.user_email } });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="invoice-${order.id}.html"`);
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

