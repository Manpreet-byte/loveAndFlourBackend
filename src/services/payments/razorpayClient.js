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
    err.code = 'RAZORPAY_NOT_CONFIGURED';
    throw err;
  }

  let res;
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
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
  } catch (cause) {
    externalIntegrationTotal.inc({ integration: 'razorpay_orders', result: 'error' });
    const err = new Error('Unable to reach Razorpay');
    err.status = 502;
    err.code = 'RAZORPAY_UNREACHABLE';
    err.cause = cause;
    throw err;
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    externalIntegrationTotal.inc({ integration: 'razorpay_orders', result: 'error' });
    const msg = json?.error?.description || json?.error?.message || 'Failed to create Razorpay order';
    const err = new Error(msg);
    // Auth/permission issues are almost always misconfiguration (wrong key/secret or wrong mode).
    if (res.status === 401 || res.status === 403) {
      err.status = 502;
      err.code = 'RAZORPAY_AUTH_FAILED';
    } else {
      err.status = 502;
      err.code = 'RAZORPAY_ORDER_CREATE_FAILED';
    }
    err.details = { provider: 'razorpay', providerStatus: res.status, response: json };
    throw err;
  }

  externalIntegrationTotal.inc({ integration: 'razorpay_orders', result: 'ok' });
  return json; // contains id, amount, currency, receipt, status, created_at, etc.
}
