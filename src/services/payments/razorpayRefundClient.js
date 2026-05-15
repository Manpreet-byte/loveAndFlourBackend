import { env } from '../../utils/env.js';
import { externalIntegrationTotal } from '../metricsService.js';

function basicAuthHeader(keyId, keySecret) {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return `Basic ${token}`;
}

export async function createRazorpayRefund({ providerPaymentId, amountPaise = null, notes = {} }) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    const err = new Error('Razorpay is not configured on server');
    err.status = 500;
    throw err;
  }
  if (!providerPaymentId) {
    const err = new Error('Missing provider payment id for refund');
    err.status = 400;
    throw err;
  }

  const body = {
    notes: notes ?? {},
  };
  if (amountPaise != null) body.amount = Number(amountPaise);

  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    externalIntegrationTotal.inc({ integration: 'razorpay_refunds', result: 'error' });
    const msg = json?.error?.description || json?.error?.message || 'Failed to create Razorpay refund';
    const err = new Error(msg);
    err.status = 502;
    err.details = { provider: 'razorpay', response: json };
    throw err;
  }

  externalIntegrationTotal.inc({ integration: 'razorpay_refunds', result: 'ok' });
  return json; // contains id, payment_id, amount, currency, status, created_at, etc.
}

