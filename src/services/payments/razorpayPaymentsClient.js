import { getRazorpayRuntimeConfig } from './razorpayConfigService.js';
import { externalIntegrationTotal } from '../metricsService.js';

function basicAuthHeader(keyId, keySecret) {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return `Basic ${token}`;
}

export async function fetchRazorpayPayment({ providerPaymentId }) {
  const cfg = await getRazorpayRuntimeConfig();
  if (!cfg.keyId || !cfg.keySecret) {
    const err = new Error('Razorpay is not configured on server');
    err.status = 500;
    throw err;
  }
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
    headers: { authorization: basicAuthHeader(cfg.keyId, cfg.keySecret) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    externalIntegrationTotal.inc({ integration: 'razorpay_payment_fetch', result: 'error' });
    const err = new Error(json?.error?.description || json?.error?.message || 'Failed to fetch Razorpay payment');
    err.status = 502;
    err.details = { provider: 'razorpay', response: json };
    throw err;
  }
  externalIntegrationTotal.inc({ integration: 'razorpay_payment_fetch', result: 'ok' });
  return json;
}
