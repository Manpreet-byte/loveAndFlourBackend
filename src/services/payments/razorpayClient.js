import { externalIntegrationTotal } from '../metricsService.js';
import { getRazorpayRuntimeConfig } from './razorpayConfigService.js';

function basicAuthHeader(keyId, keySecret) {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return `Basic ${token}`;
}

export async function createRazorpayOrder({ amountPaise, currency, receipt, notes = {} }) {
  const cfg = await getRazorpayRuntimeConfig();
  if (!cfg.keyId || !cfg.keySecret) {
    const err = new Error('Razorpay is not configured on server');
    err.status = 500;
    throw err;
  }

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(cfg.keyId, cfg.keySecret),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: Number(amountPaise),
      currency,
      receipt,
      notes,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    externalIntegrationTotal.inc({ integration: 'razorpay_orders', result: 'error' });
    const msg = json?.error?.description || json?.error?.message || 'Failed to create Razorpay order';
    const err = new Error(msg);
    err.status = 502;
    err.details = { provider: 'razorpay', response: json };
    throw err;
  }

  externalIntegrationTotal.inc({ integration: 'razorpay_orders', result: 'ok' });
  return json; // contains id, amount, currency, receipt, status, created_at, etc.
}
