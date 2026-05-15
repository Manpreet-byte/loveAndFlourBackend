import { z } from 'zod';
import { pool } from '../config/db.js';

const patchSchema = z.object({
  marketing_emails: z.boolean().optional(),
  product_updates: z.boolean().optional(),
  workshop_reminders: z.boolean().optional(),
  whatsapp_opt_in: z.boolean().optional(),
});

export async function getMyPreferences(req, res, next) {
  try {
    const userId = req.user.id;
    const [[row]] = await pool.query(
      `SELECT marketing_emails, product_updates, workshop_reminders, whatsapp_opt_in, updated_at
         FROM user_preferences
        WHERE user_id = ?
        LIMIT 1`,
      [userId],
    );
    const prefs = row ?? {
      marketing_emails: 1,
      product_updates: 1,
      workshop_reminders: 1,
      whatsapp_opt_in: 0,
      updated_at: null,
    };
    return res.json({
      preferences: {
        marketing_emails: Boolean(prefs.marketing_emails),
        product_updates: Boolean(prefs.product_updates),
        workshop_reminders: Boolean(prefs.workshop_reminders),
        whatsapp_opt_in: Boolean(prefs.whatsapp_opt_in),
        updated_at: prefs.updated_at,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function patchMyPreferences(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = patchSchema.parse(req.body ?? {});

    const next = {
      marketing_emails: payload.marketing_emails,
      product_updates: payload.product_updates,
      workshop_reminders: payload.workshop_reminders,
      whatsapp_opt_in: payload.whatsapp_opt_in,
    };

    await pool.query(
      `INSERT INTO user_preferences (user_id, marketing_emails, product_updates, workshop_reminders, whatsapp_opt_in)
       VALUES (?, COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 0))
       ON DUPLICATE KEY UPDATE
         marketing_emails = COALESCE(VALUES(marketing_emails), marketing_emails),
         product_updates = COALESCE(VALUES(product_updates), product_updates),
         workshop_reminders = COALESCE(VALUES(workshop_reminders), workshop_reminders),
         whatsapp_opt_in = COALESCE(VALUES(whatsapp_opt_in), whatsapp_opt_in)`,
      [userId, next.marketing_emails, next.product_updates, next.workshop_reminders, next.whatsapp_opt_in],
    );

    return getMyPreferences(req, res, next);
  } catch (err) {
    return next(err);
  }
}

