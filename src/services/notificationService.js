import { createUserNotification } from '../models/userNotificationModel.js';
import { listAdminUsers } from '../models/userModel.js';

export async function notifyUser(
  { userId, notificationType, title, message, linkUrl = null, metadata = null },
  { conn } = {},
) {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  return createUserNotification(
    { userId, notificationType, title, message, linkUrl, metadataJson },
    { conn },
  );
}

export async function notifyAdmins(
  { notificationType, title, message, linkUrl = null, metadata = null },
  { conn } = {},
) {
  const admins = await listAdminUsers({ limit: 200 });
  if (!admins.length) return { ok: true, delivered: 0 };
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  await Promise.allSettled(
    admins.map((a) =>
      createUserNotification(
        { userId: a.id, notificationType, title, message, linkUrl, metadataJson },
        { conn },
      ),
    ),
  );
  return { ok: true, delivered: admins.length };
}
