import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function getSiteSettings({ key = 'global' } = {}, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT setting_value_json
       FROM site_settings
      WHERE setting_key = ?
      LIMIT 1`,
    [key],
  );
  const row = rows?.[0];
  if (!row) return null;
  try {
    return row.setting_value_json ? JSON.parse(row.setting_value_json) : null;
  } catch {
    return null;
  }
}

export async function upsertSiteSettings({ key = 'global', value, updatedByAdminId = null } = {}, { conn } = {}) {
  const db = pickConn(conn);
  const json = value == null ? null : JSON.stringify(value);
  await db.query(
    `INSERT INTO site_settings (setting_key, setting_value_json, updated_by_admin_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       setting_value_json = VALUES(setting_value_json),
       updated_by_admin_id = VALUES(updated_by_admin_id),
       updated_at = CURRENT_TIMESTAMP`,
    [key, json, updatedByAdminId],
  );
}

