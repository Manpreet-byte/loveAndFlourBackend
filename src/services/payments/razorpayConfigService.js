import { env } from '../../utils/env.js';
import { decryptSecret } from '../../utils/secretBox.js';
import { getPaymentProviderConfig } from '../../models/paymentProviderConfigModel.js';

const PROVIDER = 'razorpay';

let cacheValue = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateRazorpayConfigCache() {
  cacheValue = null;
  cacheAt = 0;
}

function maskKeyId(id) {
  const s = String(id ?? '').trim();
  if (!s) return '';
  if (s.length <= 6) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

export async function getRazorpayRuntimeConfig({ allowCache = true } = {}) {
  const now = Date.now();
  if (allowCache && cacheValue && now - cacheAt < CACHE_TTL_MS) return cacheValue;

  let row = null;
  try {
    row = await getPaymentProviderConfig({ provider: PROVIDER });
  } catch {
    row = null;
  }

  const mode = row?.mode === 'live' ? 'live' : row?.mode === 'test' ? 'test' : null;
  const effectiveMode = mode ?? (env.NODE_ENV === 'production' ? 'live' : 'test');

  const cfgFromDb = {
    mode: effectiveMode,
    keyId: effectiveMode === 'live' ? row?.live_key_id : row?.test_key_id,
    keySecret: effectiveMode === 'live' ? decryptSecret(row?.live_key_secret_enc) : decryptSecret(row?.test_key_secret_enc),
    webhookSecrets: [
      decryptSecret(effectiveMode === 'live' ? row?.live_webhook_secret_enc : row?.test_webhook_secret_enc),
      // Accept both secrets to avoid downtime during mode switches.
      decryptSecret(row?.test_webhook_secret_enc),
      decryptSecret(row?.live_webhook_secret_enc),
    ].filter(Boolean),
    status: {
      dbConfigured: !!row,
      mode: effectiveMode,
      test_key_id_masked: maskKeyId(row?.test_key_id),
      live_key_id_masked: maskKeyId(row?.live_key_id),
      has_test_secret: Boolean(decryptSecret(row?.test_key_secret_enc)),
      has_live_secret: Boolean(decryptSecret(row?.live_key_secret_enc)),
      has_test_webhook_secret: Boolean(decryptSecret(row?.test_webhook_secret_enc)),
      has_live_webhook_secret: Boolean(decryptSecret(row?.live_webhook_secret_enc)),
      updated_at: row?.updated_at ?? null,
    },
  };

  // Fallback to environment secrets if DB is not configured (back-compat).
  const keyId = cfgFromDb.keyId || env.RAZORPAY_KEY_ID || null;
  const keySecret = cfgFromDb.keySecret || env.RAZORPAY_KEY_SECRET || null;
  const webhookSecrets = cfgFromDb.webhookSecrets.length
    ? cfgFromDb.webhookSecrets
    : [String(env.RAZORPAY_WEBHOOK_SECRET ?? '').trim()].filter(Boolean);

  cacheValue = {
    mode: effectiveMode,
    keyId,
    keySecret,
    webhookSecrets,
    status: cfgFromDb.status,
  };
  cacheAt = now;
  return cacheValue;
}

