import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createUserNotification(
  { userId, notificationType, title, message, linkUrl = null, metadataJson = null },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO user_notifications
      (user_id, notification_type, title, message, link_url, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, notificationType, title, message, linkUrl, metadataJson],
  );
  return result.insertId;
}

export async function listUserNotifications({ userId, limit = 50, cursor = null, notificationType = null }, { conn } = {}) {
  const db = pickConn(conn);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const cursorId = cursor ? Number(cursor) : null;
  const type = notificationType ? String(notificationType) : null;
  const [rows] = await db.query(
    `SELECT id, notification_type, title, message, link_url, metadata_json, created_at, read_at
       FROM user_notifications
      WHERE user_id = ?
        ${type ? 'AND notification_type = ?' : ''}
        ${cursorId ? 'AND id < ?' : ''}
   ORDER BY id DESC
      LIMIT ?`,
    type
      ? cursorId
        ? [userId, type, cursorId, safeLimit]
        : [userId, type, safeLimit]
      : cursorId
        ? [userId, cursorId, safeLimit]
        : [userId, safeLimit],
  );
  const nextCursor = rows.length === safeLimit ? rows[rows.length - 1]?.id : null;
  return { notifications: rows, next_cursor: nextCursor };
}

export async function getUnreadCount({ userId, notificationType = null }, { conn } = {}) {
  const db = pickConn(conn);
  const type = notificationType ? String(notificationType) : null;
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM user_notifications
      WHERE user_id = ?
        AND read_at IS NULL
        ${type ? 'AND notification_type = ?' : ''}`,
    type ? [userId, type] : [userId],
  );
  return Number(row?.cnt ?? 0);
}

export async function markNotificationRead({ userId, id }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE user_notifications
        SET read_at = COALESCE(read_at, NOW())
      WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
}

export async function markAllRead({ userId, notificationType = null }, { conn } = {}) {
  const db = pickConn(conn);
  const type = notificationType ? String(notificationType) : null;
  await db.query(
    `UPDATE user_notifications
        SET read_at = NOW()
      WHERE user_id = ?
        AND read_at IS NULL
        ${type ? 'AND notification_type = ?' : ''}`,
    type ? [userId, type] : [userId],
  );
}
