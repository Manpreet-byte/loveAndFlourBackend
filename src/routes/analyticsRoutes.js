import { Router } from 'express';
import { z } from 'zod';
import { trackEvent } from '../services/analyticsEventService.js';

const router = Router();

const trackSchema = z.object({
  event_type: z.string().trim().min(1).max(80),
  entity_type: z.string().trim().min(1).max(40).optional().nullable(),
  entity_id: z.coerce.number().int().positive().optional().nullable(),
  metadata: z.any().optional().nullable(),
});

const ALLOWED = new Set(['page_view', 'cart_add', 'cart_remove', 'checkout_started', 'purchase_verified']);

router.post('/track', async (req, res, next) => {
  try {
    const payload = trackSchema.parse(req.body ?? {});
    const eventType = String(payload.event_type).toLowerCase();
    if (!ALLOWED.has(eventType)) return res.status(400).json({ error: { message: 'Invalid event type' } });

    await trackEvent({
      userId: null,
      eventType,
      entityType: payload.entity_type ?? null,
      entityId: payload.entity_id ?? null,
      metadata: payload.metadata ?? null,
    });

    return res.status(202).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;

