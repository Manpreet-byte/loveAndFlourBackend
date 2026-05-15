import { hmacSha256Hex, safeEqual } from '../../utils/crypto.js';
import { getRazorpayRuntimeConfig } from './razorpayConfigService.js';

export async function verifyRazorpayWebhookSignature({ rawBody, signatureHeader }) {
  const cfg = await getRazorpayRuntimeConfig();
  const sig = String(signatureHeader ?? '');
  for (const secret of cfg.webhookSecrets ?? []) {
    if (!secret) continue;
    const computed = hmacSha256Hex(secret, rawBody);
    if (safeEqual(computed, sig)) return true;
  }
  return false;
}
