import { z } from 'zod';
import { getSiteSettings, upsertSiteSettings } from '../models/siteSettingsModel.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const settingsSchema = z.object({
  site_name: z.string().trim().min(1).max(120).optional(),
  logo_url: z.string().trim().max(1024).optional().nullable(),
  favicon_url: z.string().trim().max(1024).optional().nullable(),
  gst_number: z.string().trim().max(64).optional().nullable(),
  currency: z.string().trim().min(3).max(6).optional(),
  maintenance_mode: z.coerce.boolean().optional(),
});

export async function adminGetSettings(_req, res, next) {
  try {
    const existing = (await getSiteSettings({ key: 'global' })) ?? {};
    return res.json({ settings: existing });
  } catch (err) {
    return next(err);
  }
}

export async function adminPatchSettings(req, res, next) {
  try {
    const patch = settingsSchema.parse(req.body ?? {});
    const existing = (await getSiteSettings({ key: 'global' })) ?? {};
    const merged = { ...existing, ...patch };
    await upsertSiteSettings({ key: 'global', value: merged, updatedByAdminId: req.user.id });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'SETTINGS_UPDATE',
      entityType: 'site_settings',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true, settings: merged });
  } catch (err) {
    return next(err);
  }
}

