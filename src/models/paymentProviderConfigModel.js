import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function getPaymentProviderConfig({ provider = 'razorpay' } = {}, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT provider, mode, test_key_id, test_key_secret_enc, live_key_id, live_key_secret_enc,
            test_webhook_secret_enc, live_webhook_secret_enc, updated_by_admin_id, updated_at
       FROM payment_provider_configs
      WHERE provider = ?
      LIMIT 1`,
    [provider],
  );
  return rows?.[0] ?? null;
}

export async function upsertPaymentProviderConfig(
  {
    provider = 'razorpay',
    mode = 'test',
    testKeyId = null,
    testKeySecretEnc = null,
    liveKeyId = null,
    liveKeySecretEnc = null,
    testWebhookSecretEnc = null,
    liveWebhookSecretEnc = null,
    updatedByAdminId = null,
  } = {},
  { conn } = {},
) {
  const db = pickConn(conn);
  await db.query(
    `INSERT INTO payment_provider_configs
      (provider, mode, test_key_id, test_key_secret_enc, live_key_id, live_key_secret_enc, test_webhook_secret_enc, live_webhook_secret_enc, updated_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mode = VALUES(mode),
       test_key_id = VALUES(test_key_id),
       test_key_secret_enc = VALUES(test_key_secret_enc),
       live_key_id = VALUES(live_key_id),
       live_key_secret_enc = VALUES(live_key_secret_enc),
       test_webhook_secret_enc = VALUES(test_webhook_secret_enc),
       live_webhook_secret_enc = VALUES(live_webhook_secret_enc),
       updated_by_admin_id = VALUES(updated_by_admin_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      provider,
      mode,
      testKeyId,
      testKeySecretEnc,
      liveKeyId,
      liveKeySecretEnc,
      testWebhookSecretEnc,
      liveWebhookSecretEnc,
      updatedByAdminId,
    ],
  );
}

