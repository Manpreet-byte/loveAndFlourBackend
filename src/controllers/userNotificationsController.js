import { z } from 'zod';
import { getUnreadCount, listUserNotifications, markAllRead, markNotificationRead } from '../models/userNotificationModel.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.coerce.number().int().positive().optional().nullable(),
  notification_type: z.string().trim().min(1).max(80).optional().nullable(),
});

export async function listNotifications(req, res, next) {
  try {
    const userId = req.user.id;
    const { limit, cursor, notification_type: notificationType } = listSchema.parse(req.query);
    const [list, unread] = await Promise.all([
      listUserNotifications({ userId, limit: limit ?? 50, cursor: cursor ?? null, notificationType: notificationType ?? null }),
      getUnreadCount({ userId, notificationType: notificationType ?? null }),
    ]);
    return res.json({ ...list, unread_count: unread });
  } catch (err) {
    if (isSchemaMismatchError(err)) {
      return res.json({ notifications: [], next_cursor: null, unread_count: 0 });
    }
    return next(err);
  }
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function readNotification(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = idSchema.parse(req.params);
    await markNotificationRead({ userId, id });
    const unread = await getUnreadCount({ userId });
    return res.json({ ok: true, unread_count: unread });
  } catch (err) {
    if (isSchemaMismatchError(err)) {
      return res.json({ ok: true, unread_count: 0 });
    }
    return next(err);
  }
}

export async function readAll(req, res, next) {
  try {
    const userId = req.user.id;
    const { notification_type: notificationType } = listSchema.pick({ notification_type: true }).parse(req.query ?? {});
    await markAllRead({ userId, notificationType: notificationType ?? null });
    const unread = await getUnreadCount({ userId, notificationType: notificationType ?? null });
    return res.json({ ok: true, unread_count: unread });
  } catch (err) {
    if (isSchemaMismatchError(err)) {
      return res.json({ ok: true, unread_count: 0 });
    }
    return next(err);
  }
}
