import { z } from 'zod';
import { encryptSecret } from '../utils/secretBox.js';
import { getPaymentProviderConfig, upsertPaymentProviderConfig } from '../models/paymentProviderConfigModel.js';
import { getRazorpayRuntimeConfig, invalidateRazorpayConfigCache } from '../services/payments/razorpayConfigService.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const provider = 'razorpay';

const patchSchema = z.object({
  mode: z.enum(['test', 'live']).optional(),
  test_key_id: z.string().trim().max(64).optional().nullable(),
  test_key_secret: z.string().trim().max(200).optional().nullable(),
  live_key_id: z.string().trim().max(64).optional().nullable(),
  live_key_secret: z.string().trim().max(200).optional().nullable(),
  test_webhook_secret: z.string().trim().max(200).optional().nullable(),
  live_webhook_secret: z.string().trim().max(200).optional().nullable(),
});

export async function adminGetRazorpayConfig(_req, res, next) {
  try {
    // Use runtime view (includes env fallback), but only return safe status.
    const cfg = await getRazorpayRuntimeConfig({ allowCache: false });
    return res.json({ provider, config: cfg.status });
  } catch (err) {
    return next(err);
  }
}

export async function adminPatchRazorpayConfig(req, res, next) {
  try {
    const patch = patchSchema.parse(req.body ?? {});
    const existing = (await getPaymentProviderConfig({ provider })) ?? {
      provider,
      mode: 'test',
      test_key_id: null,
      test_key_secret_enc: null,
      live_key_id: null,
      live_key_secret_enc: null,
      test_webhook_secret_enc: null,
      live_webhook_secret_enc: null,
    };

    const nextRow = {
      provider,
      mode: patch.mode ?? existing.mode ?? 'test',
      testKeyId: patch.test_key_id === undefined ? existing.test_key_id : patch.test_key_id,
      testKeySecretEnc:
        patch.test_key_secret === undefined
          ? existing.test_key_secret_enc
          : patch.test_key_secret
            ? encryptSecret(patch.test_key_secret)
            : null,
      liveKeyId: patch.live_key_id === undefined ? existing.live_key_id : patch.live_key_id,
      liveKeySecretEnc:
        patch.live_key_secret === undefined
          ? existing.live_key_secret_enc
          : patch.live_key_secret
            ? encryptSecret(patch.live_key_secret)
            : null,
      testWebhookSecretEnc:
        patch.test_webhook_secret === undefined
          ? existing.test_webhook_secret_enc
          : patch.test_webhook_secret
            ? encryptSecret(patch.test_webhook_secret)
            : null,
      liveWebhookSecretEnc:
        patch.live_webhook_secret === undefined
          ? existing.live_webhook_secret_enc
          : patch.live_webhook_secret
            ? encryptSecret(patch.live_webhook_secret)
            : null,
      updatedByAdminId: req.user.id,
    };

    await upsertPaymentProviderConfig(nextRow);
    invalidateRazorpayConfigCache();

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'PAYMENT_PROVIDER_CONFIG_UPDATE',
      entityType: 'payment_provider_configs',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { provider, mode: nextRow.mode },
    });

    const cfg = await getRazorpayRuntimeConfig({ allowCache: false });
    return res.json({ ok: true, provider, config: cfg.status });
  } catch (err) {
    return next(err);
  }
}

